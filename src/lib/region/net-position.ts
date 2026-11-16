// Country net position: imports + storage withdrawal + production + LNG − exports,
// shown next to reported domestic consumption (exits to distribution and final customers),
// so the gap between the two is visible instead of hidden.
//
// Source: ENTSOG Transparency "aggregatedData" (per country, per adjacent system:
// Transmission<country>, Production, Storage, LNG Terminals, Distribution, Final Consumers),
// verified against the live API on 2026-11-16. Pure module; no framework imports.

import { toMcmPerDay } from "./regional-feed";

/** Countries ENTSOG publishes aggregates for (others come from the dashboard / corridors). */
export const ENTSOG_AGGREGATE_COUNTRIES = ["BG", "HU", "RO", "GR", "HR", "SI", "AT"] as const;

export interface NetComponents {
  imports: number;
  exports: number;
  /** Withdrawal − injection: positive = storage supplies the system. */
  storage: number;
  /** Production entry − production exit (e.g. HU "exit for blending"). */
  production: number;
  lng: number;
  /** imports + storage + production + lng − exports. */
  net: number;
  /** Exits to distribution + final consumers, if published. */
  consumption: number | null;
  /** Signed flow per neighbour (+ import, − export), mcm/d. */
  byNeighbour: Record<string, number>;
  provisional: boolean;
}

export interface Supplement {
  /** lower(operatorKey + pointKey + direction) */
  pointDirection: string;
  category: "imports" | "exports" | "lng" | "storage" | "production";
  neighbour?: string;
  label: string;
}

/**
 * Points ENTSOG leaves out of the country aggregates (checked 2026-11-16):
 * Greece — the Alexandroupolis FSRU (AMFITRITI) and TAP's deliveries into DESFA at
 * Nea Mesimvria (TAP is registered as a Swiss TSO, so it is under no Balkan country).
 */
export const SUPPLEMENTS: Record<string, Supplement[]> = {
  GR: [
    {
      pointDirection: "gr-tso-0001lng-00042entry",
      category: "lng",
      label: "Alexandroupolis FSRU (AMFITRITI)",
    },
    {
      pointDirection: "al-tso-0001itp-00427exit",
      category: "imports",
      neighbour: "TAP",
      label: "TAP → DESFA, Nea Mesimvria",
    },
    {
      pointDirection: "al-tso-0001itp-00427entry",
      category: "exports",
      neighbour: "TAP",
      label: "DESFA → TAP, Nea Mesimvria",
    },
  ],
};

export const COVERAGE_NOTES: Record<string, string> = {
  AT: "ENTSOG aggregates for Austria cover cross-border flows only (no storage, production or consumption), so the net position includes unknown storage injection.",
  GR: "TAP and the Alexandroupolis FSRU are added from point data; they are missing from ENTSOG's Greek aggregate.",
  RS: "Serbia: border flows from ENTSOG points, production and storage from the dashboard balance (storage is the balance model's feasible injection/withdrawal).",
  MK: "North Macedonia: imports at Kyustendil/Zidilovo only; no production or storage.",
  BA: "Bosnia and Herzegovina: modelled share of the Serbian balance at Zvornik, not metered.",
};

const empty = (): NetComponents => ({
  imports: 0,
  exports: 0,
  storage: 0,
  production: 0,
  lng: 0,
  net: 0,
  consumption: null,
  byNeighbour: {},
  provisional: false,
});

function finish(c: NetComponents): NetComponents {
  const r = (v: number) => +v.toFixed(3);
  c.net = r(c.imports + c.storage + c.production + c.lng - c.exports);
  for (const k of ["imports", "exports", "storage", "production", "lng"] as const) c[k] = r(c[k]);
  if (c.consumption !== null) c.consumption = r(c.consumption);
  for (const k of Object.keys(c.byNeighbour)) c.byNeighbour[k] = r(c.byNeighbour[k]);
  return c;
}

/** "TransmissionBG-NGTS----" → "BG"; "Transmission" → "non-EU / other". */
export function neighbourOf(adjacentSystemsKey: string): string {
  const m = adjacentSystemsKey.match(/^Transmission([A-Z]{2})/);
  return m ? m[1] : "non-EU";
}

/**
 * Builds country → gas day → components from ENTSOG aggregatedData rows (one indicator).
 * Missing values ("" / null) are skipped, never zero. Transfers between TSOs of the same
 * country (Transmission<own country>) are internal and excluded.
 */
export function parseAggregated(
  rows: Array<Record<string, unknown>>,
): Map<string, Map<string, NetComponents>> {
  const out = new Map<string, Map<string, NetComponents>>();
  for (const row of rows) {
    const country = String(row.countryKey ?? "");
    const day = typeof row.periodFrom === "string" ? row.periodFrom.slice(0, 10) : "";
    const raw =
      typeof row.value === "number"
        ? row.value
        : row.value == null || String(row.value).trim() === ""
          ? NaN
          : Number(row.value);
    if (!country || !day || !Number.isFinite(raw)) continue;
    const v = toMcmPerDay(raw, row.unit as string | undefined);
    if (v === null) continue;
    const adj = String(row.adjacentSystemsKey ?? "");
    const entry = row.directionKey === "entry";
    const byDay = out.get(country) ?? new Map<string, NetComponents>();
    const c = byDay.get(day) ?? empty();
    if (/provision/i.test(String(row.flowStatus ?? ""))) c.provisional = true;
    if (adj === "Production") c.production += entry ? v : -v;
    else if (adj === "Storage") c.storage += entry ? v : -v;
    else if (/^LNG/i.test(adj)) c.lng += entry ? v : -v;
    else if (adj === "Distribution" || adj === "Final Consumers") {
      if (!entry) c.consumption = (c.consumption ?? 0) + v;
    } else if (adj.startsWith("Transmission")) {
      const n = neighbourOf(adj);
      if (n !== country) {
        if (entry) c.imports += v;
        else c.exports += v;
        c.byNeighbour[n] = (c.byNeighbour[n] ?? 0) + (entry ? v : -v);
      }
    }
    byDay.set(day, c);
    out.set(country, byDay);
  }
  for (const byDay of out.values()) for (const c of byDay.values()) finish(c);
  return out;
}

/** Adds supplement point flows (pd → day → mcm/d) to the country components, in place. */
export function applySupplements(
  net: Map<string, Map<string, NetComponents>>,
  flows: Map<string, Map<string, number>>,
): void {
  for (const [country, sups] of Object.entries(SUPPLEMENTS)) {
    const byDay = net.get(country);
    if (!byDay) continue;
    for (const [day, c] of byDay) {
      for (const s of sups) {
        const v = flows.get(s.pointDirection)?.get(day);
        if (v === undefined) continue;
        c[s.category] += v;
        if (s.neighbour) {
          const sign = s.category === "exports" ? -1 : 1;
          c.byNeighbour[s.neighbour] = (c.byNeighbour[s.neighbour] ?? 0) + sign * v;
        }
      }
      finish(c);
    }
  }
}

/** Builds components directly (non-ENTSOG countries: Serbia, North Macedonia, Bosnia). */
export function fromParts(
  parts: Partial<NetComponents> & { byNeighbour?: Record<string, number> },
): NetComponents {
  return finish({ ...empty(), ...parts, byNeighbour: { ...(parts.byNeighbour ?? {}) } });
}

/** Average over several days (period mode). Consumption averages only where published. */
export function averageComponents(list: NetComponents[]): NetComponents | null {
  if (!list.length) return null;
  const c = empty();
  let consDays = 0;
  for (const x of list) {
    c.imports += x.imports;
    c.exports += x.exports;
    c.storage += x.storage;
    c.production += x.production;
    c.lng += x.lng;
    if (x.consumption !== null) {
      c.consumption = (c.consumption ?? 0) + x.consumption;
      consDays++;
    }
    for (const [k, v] of Object.entries(x.byNeighbour))
      c.byNeighbour[k] = (c.byNeighbour[k] ?? 0) + v;
    c.provisional ||= x.provisional;
  }
  const n = list.length;
  for (const k of ["imports", "exports", "storage", "production", "lng"] as const) c[k] /= n;
  if (c.consumption !== null) c.consumption /= consDays;
  for (const k of Object.keys(c.byNeighbour)) c.byNeighbour[k] /= n;
  return finish(c);
}
