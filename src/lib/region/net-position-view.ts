// Assembles the per-country net position table for the Balkan map:
// ENTSOG aggregates for EU countries, and the dashboard's own data for Serbia,
// North Macedonia and Bosnia (no ENTSOG aggregates exist for them).

import type { BalanceRow } from "../gas/types";
import type { LinkValue } from "./map-model";
import { averageComponents, COVERAGE_NOTES, fromParts, type NetComponents } from "./net-position";
import { CORRIDOR_BY_ID } from "./registry";

export interface NetRow {
  code: string;
  /** Country name as used by the map's label layer. */
  mapName: string;
  label: string;
  c: NetComponents | null;
  source: "ENTSOG aggregates" | "ENTSOG points + dashboard balance" | "ENTSOG points" | "model";
  note?: string;
}

export const NET_COUNTRIES: Array<{ code: string; mapName: string; label: string }> = [
  { code: "RS", mapName: "Serbia", label: "Serbia" },
  { code: "BG", mapName: "Bulgaria", label: "Bulgaria" },
  { code: "HU", mapName: "Hungary", label: "Hungary" },
  { code: "RO", mapName: "Romania", label: "Romania" },
  { code: "GR", mapName: "Greece", label: "Greece" },
  { code: "HR", mapName: "Croatia", label: "Croatia" },
  { code: "SI", mapName: "Slovenia", label: "Slovenia" },
  { code: "MK", mapName: "Macedonia", label: "N. Macedonia" },
  { code: "BA", mapName: "Bosnia and Herz.", label: "BiH" },
  { code: "AT", mapName: "Austria", label: "Austria" },
];

/**
 * Signed corridor contributions for one country: + into the country, − out of it.
 * A negative link value means the flow ran against the drawn direction.
 */
function corridorFlows(
  country: string,
  ids: string[],
  values: Record<string, LinkValue>,
): { imports: number; exports: number; byNeighbour: Record<string, number>; complete: boolean } {
  let imports = 0;
  let exports = 0;
  let complete = true;
  const byNeighbour: Record<string, number> = {};
  for (const id of ids) {
    const corridor = CORRIDOR_BY_ID[id];
    const v = values[id]?.value;
    if (!corridor || v == null) {
      complete = false;
      continue;
    }
    const intoCountry = corridor.to === country ? v : corridor.from === country ? -v : 0;
    const other = (corridor.to === country ? corridor.from : corridor.to) ?? "?";
    if (intoCountry >= 0) imports += intoCountry;
    else exports += -intoCountry;
    byNeighbour[other] = (byNeighbour[other] ?? 0) + intoCountry;
  }
  return { imports, exports, byNeighbour, complete };
}

export function buildNetRows(args: {
  mode: "day" | "average";
  date: string | null;
  days: string[];
  entsog: Record<string, Record<string, NetComponents>> | null;
  values: Record<string, LinkValue>;
  balance: BalanceRow[];
}): NetRow[] {
  const { mode, date, days, entsog, values, balance } = args;
  const pickEntsog = (code: string): NetComponents | null => {
    const byDay = entsog?.[code];
    if (!byDay) return null;
    if (mode === "day") return date ? (byDay[date] ?? null) : null;
    return averageComponents(days.map((d) => byDay[d]).filter((x): x is NetComponents => !!x));
  };
  const balRows =
    mode === "day"
      ? balance.filter((b) => b.date === date)
      : balance.filter((b) => days.includes(b.date));
  const avg = (f: (b: BalanceRow) => number | null) => {
    const v = balRows.map(f).filter((n): n is number => n !== null && Number.isFinite(n));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  return NET_COUNTRIES.map(({ code, mapName, label }) => {
    const base = { code, mapName, label, note: COVERAGE_NOTES[code] };
    if (code === "RS") {
      const f = corridorFlows(
        "RS",
        ["hu_rs_1", "rs_hu_2", "bg_rs_kz", "bg_rs_kal", "rs_ba_zv"],
        values,
      );
      if (!f.complete || !balRows.length)
        return { ...base, c: null, source: "ENTSOG points + dashboard balance" };
      return {
        ...base,
        source: "ENTSOG points + dashboard balance",
        c: fromParts({
          imports: f.imports,
          exports: f.exports,
          byNeighbour: f.byNeighbour,
          production: avg((b) => b.domestic_production_mcm) ?? 0,
          storage: avg((b) => b.storage_withdrawal_mcm - b.storage_injection_mcm) ?? 0,
          consumption: avg((b) => (b.is_forecast ? null : b.demand_mcm)),
        }),
      };
    }
    if (code === "MK" || code === "BA") {
      const id = code === "MK" ? "bg_mk_zid" : "rs_ba_zv";
      const f = corridorFlows(code, [id], values);
      if (!f.complete)
        return { ...base, c: null, source: code === "BA" ? "model" : "ENTSOG points" };
      return {
        ...base,
        source: code === "BA" ? "model" : "ENTSOG points",
        c: fromParts({ imports: f.imports, exports: f.exports, byNeighbour: f.byNeighbour }),
      };
    }
    return { ...base, c: pickEntsog(code), source: "ENTSOG aggregates" };
  });
}

/** Net minus reported consumption; null when consumption is not published. */
export function balanceGap(c: NetComponents | null): number | null {
  if (!c || c.consumption === null) return null;
  return +(c.net - c.consumption).toFixed(3);
}
