// Pure helpers for the Balkan regional ENTSOG feed. No network access here, so the
// matching and unit rules are unit-testable (tests/region-feed.test.mjs).

import { CONVERSION_MCM_TO_KWH } from "../gas/config";
import { CORRIDOR_BY_ID, matchCorridors, type CountryCode } from "./registry";

/** Countries whose interconnection points are relevant to the map. */
export const REGION_COUNTRIES = new Set<string>([
  "HU",
  "BG",
  "RO",
  "HR",
  "SI",
  "GR",
  "MK",
  "AL",
  "BA",
  "ME",
  "TR",
  "UA",
  "AT",
  "IT",
  "RS",
]);

export interface RegionalPointRef {
  pointDirection: string;
  label: string;
  /** Country of the TSO publishing this point direction. */
  country: string;
  adjacent: string | null;
  direction: "entry" | "exit";
  operator: string;
}

type Rec = Record<string, unknown>;

function field(rec: Rec, ...names: string[]): string | null {
  const lower = new Map(Object.keys(rec).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const key = lower.get(name.toLowerCase());
    if (key === undefined) continue;
    const value = rec[key];
    if (value === null || value === undefined || value === "") continue;
    return String(value);
  }
  return null;
}

const COUNTRY_NAMES: Record<string, string> = {
  serbia: "RS",
  hungary: "HU",
  bulgaria: "BG",
  romania: "RO",
  croatia: "HR",
  slovenia: "SI",
  greece: "GR",
  "north macedonia": "MK",
  macedonia: "MK",
  albania: "AL",
  "bosnia and herzegovina": "BA",
  montenegro: "ME",
  turkey: "TR",
  turkiye: "TR",
  türkiye: "TR",
  ukraine: "UA",
  austria: "AT",
  italy: "IT",
  moldova: "MD",
  slovakia: "SK",
};

/** ISO-2 code from either a code ("bg") or an English country name ("Bulgaria"); null if unknown. */
export function countryCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/^[a-z]{2}$/i.test(t)) return t.toUpperCase();
  return COUNTRY_NAMES[t.toLowerCase()] ?? null;
}

/**
 * One ENTSOG `operatorpointdirections` record → point reference.
 * Returns null when the record cannot be keyed or is not an entry/exit.
 */
export function parseOperatorPointDirection(rec: Rec): RegionalPointRef | null {
  const label = field(rec, "pointLabel", "pointName", "label");
  const direction = (field(rec, "directionKey", "direction") ?? "").toLowerCase();
  if (!label || (direction !== "entry" && direction !== "exit")) return null;
  const operator = field(rec, "operatorKey") ?? "";
  const pointKey = field(rec, "pointKey") ?? "";
  const explicit = field(rec, "pointDirection", "pointDirectionKey");
  const pointDirection = (
    explicit ?? (operator && pointKey ? `${operator}${pointKey}${direction}` : "")
  )
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!pointDirection) return null;
  const country =
    countryCode(field(rec, "tSOCountry", "tsoCountry", "countryKey", "country")) ??
    countryCode(operator.slice(0, 2)) ??
    "";
  const adjacent = countryCode(field(rec, "adjacentCountry", "adjacentCountryKey"));
  return {
    pointDirection,
    label,
    country,
    adjacent,
    direction,
    operator,
  };
}

export interface CorridorSelection {
  forwardExit: RegionalPointRef[];
  forwardEntry: RegionalPointRef[];
  reverseExit: RegionalPointRef[];
  reverseEntry: RegionalPointRef[];
}

const emptySelection = (): CorridorSelection => ({
  forwardExit: [],
  forwardEntry: [],
  reverseExit: [],
  reverseEntry: [],
});

/**
 * Assign point directions to regional corridors.
 * Forward = gas moving corridor.from → corridor.to. The exit side of the sending TSO is
 * preferred; the entry side of the receiving TSO is a fallback (see combineCorridor).
 * A point is only accepted when its TSO country fits the corridor pair, so a label
 * that mentions two corridors (e.g. Komotini) lands on the right one.
 */
export function selectCorridorPoints(refs: RegionalPointRef[]): Record<string, CorridorSelection> {
  const out: Record<string, CorridorSelection> = {};
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.pointDirection)) continue;
    for (const corridor of matchCorridors(ref.label)) {
      const from = corridor.from;
      const to = corridor.to as CountryCode;
      const sel = (out[corridor.id] ??= emptySelection());
      let placed = true;
      if (corridor.lng) {
        // LNG send-out: entry into the receiving country's transmission system.
        if (ref.direction === "entry" && ref.country === to) sel.forwardEntry.push(ref);
        else placed = false;
      } else if (
        ref.country === from &&
        ref.direction === "exit" &&
        (!ref.adjacent || ref.adjacent === to)
      ) {
        sel.forwardExit.push(ref);
      } else if (
        ref.country === to &&
        ref.direction === "entry" &&
        (!ref.adjacent || ref.adjacent === from)
      ) {
        sel.forwardEntry.push(ref);
      } else if (
        ref.country === to &&
        ref.direction === "exit" &&
        (!ref.adjacent || ref.adjacent === from)
      ) {
        sel.reverseExit.push(ref);
      } else if (
        ref.country === from &&
        ref.direction === "entry" &&
        (!ref.adjacent || ref.adjacent === to)
      ) {
        sel.reverseEntry.push(ref);
      } else {
        placed = false;
      }
      if (placed) {
        seen.add(ref.pointDirection);
        break;
      }
    }
  }
  for (const id of Object.keys(out)) {
    const sel = out[id];
    if (
      !sel.forwardExit.length &&
      !sel.forwardEntry.length &&
      !sel.reverseExit.length &&
      !sel.reverseEntry.length
    ) {
      delete out[id];
    }
  }
  return out;
}

/**
 * Explicit unit normaliser to mcm/day. Unknown units return null and must be
 * dropped by the caller (never guessed — see the Kalotina 1000× incident).
 */
export function toMcmPerDay(value: number, unit: string | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  const u = (unit ?? "").toLowerCase().replace(/\s+/g, "");
  const perDay: Record<string, number> = {
    "kwh/d": 1,
    "kwh/day": 1,
    "mwh/d": 1e3,
    "mwh/day": 1e3,
    "gwh/d": 1e6,
    "gwh/day": 1e6,
    "kwh/h": 24,
    "mwh/h": 24e3,
    "gwh/h": 24e6,
  };
  const factor = perDay[u];
  if (factor === undefined) return null;
  return (value * factor) / CONVERSION_MCM_TO_KWH;
}

export interface RegionalDay {
  date: string;
  /** mcm/day in the corridor's nominal direction; null = nothing published. */
  forward: number | null;
  reverse: number | null;
  /** forward − reverse; null when neither side published. */
  net: number | null;
}

export interface RegionalCorridorSeries {
  id: string;
  days: RegionalDay[];
  points: Array<{
    label: string;
    pointDirection: string;
    side: "forward" | "reverse";
    role: "exit" | "entry";
  }>;
}

/** Sum the chosen points per day: exit side if it published anything, else entry side. */
function sideSeries(
  exits: RegionalPointRef[],
  entries: RegionalPointRef[],
  seriesByPd: Map<string, Map<string, number>>,
): { byDate: Map<string, number>; used: RegionalPointRef[]; role: "exit" | "entry" } | null {
  const pick = (refs: RegionalPointRef[]) =>
    refs.filter((ref) => (seriesByPd.get(ref.pointDirection)?.size ?? 0) > 0);
  const exitRefs = pick(exits);
  const refs = exitRefs.length ? exitRefs : pick(entries);
  if (!refs.length) return null;
  const byDate = new Map<string, number>();
  for (const ref of refs) {
    for (const [date, value] of seriesByPd.get(ref.pointDirection) ?? []) {
      byDate.set(date, (byDate.get(date) ?? 0) + value);
    }
  }
  return { byDate, used: refs, role: exitRefs.length ? "exit" : "entry" };
}

export function combineCorridor(
  id: string,
  sel: CorridorSelection,
  seriesByPd: Map<string, Map<string, number>>,
): RegionalCorridorSeries | null {
  if (!CORRIDOR_BY_ID[id]) return null;
  const forward = sideSeries(sel.forwardExit, sel.forwardEntry, seriesByPd);
  const reverse = sideSeries(sel.reverseExit, sel.reverseEntry, seriesByPd);
  if (!forward && !reverse) return null;
  const dates = new Set<string>([
    ...(forward?.byDate.keys() ?? []),
    ...(reverse?.byDate.keys() ?? []),
  ]);
  const days: RegionalDay[] = [...dates].sort().map((date) => {
    const f = forward?.byDate.get(date) ?? null;
    const r = reverse?.byDate.get(date) ?? null;
    return {
      date,
      forward: f,
      reverse: r,
      net: f === null && r === null ? null : (f ?? 0) - (r ?? 0),
    };
  });
  const points: RegionalCorridorSeries["points"] = [
    ...(forward?.used ?? []).map((ref) => ({
      label: ref.label,
      pointDirection: ref.pointDirection,
      side: "forward" as const,
      role: forward!.role,
    })),
    ...(reverse?.used ?? []).map((ref) => ({
      label: ref.label,
      pointDirection: ref.pointDirection,
      side: "reverse" as const,
      role: reverse!.role,
    })),
  ];
  return { id, days, points };
}

export interface CapacityDay {
  date: string;
  /** Firm technical / firm booked capacity in the corridor's nominal direction, mcm/day. */
  forwardTechnical: number | null;
  forwardBooked: number | null;
  /** Same for the reverse direction (bidirectional points). */
  reverseTechnical: number | null;
  reverseBooked: number | null;
}

export interface CorridorCapacity {
  id: string;
  days: CapacityDay[];
}

/**
 * Pick the points that publish technical capacity for one direction (exit side
 * preferred, entry side as fallback) and sum technical and booked over them.
 * Booked comes from the same points so the two are comparable.
 */
function capacitySide(
  exits: RegionalPointRef[],
  entries: RegionalPointRef[],
  technical: Map<string, Map<string, number>>,
  booked: Map<string, Map<string, number>>,
) {
  const has = (refs: RegionalPointRef[]) =>
    refs.filter((ref) => (technical.get(ref.pointDirection)?.size ?? 0) > 0);
  const exitRefs = has(exits);
  const refs = exitRefs.length ? exitRefs : has(entries);
  if (!refs.length) return null;
  const tech = new Map<string, number>();
  const book = new Map<string, number>();
  for (const ref of refs) {
    for (const [date, v] of technical.get(ref.pointDirection) ?? [])
      tech.set(date, (tech.get(date) ?? 0) + v);
    for (const [date, v] of booked.get(ref.pointDirection) ?? [])
      book.set(date, (book.get(date) ?? 0) + v);
  }
  return { tech, book };
}

export function combineCapacity(
  id: string,
  sel: CorridorSelection,
  technical: Map<string, Map<string, number>>,
  booked: Map<string, Map<string, number>>,
): CorridorCapacity | null {
  const fwd = capacitySide(sel.forwardExit, sel.forwardEntry, technical, booked);
  const rev = capacitySide(sel.reverseExit, sel.reverseEntry, technical, booked);
  if (!fwd && !rev) return null;
  const dates = new Set<string>([...(fwd?.tech.keys() ?? []), ...(rev?.tech.keys() ?? [])]);
  return {
    id,
    days: [...dates].sort().map((date) => ({
      date,
      forwardTechnical: fwd?.tech.get(date) ?? null,
      forwardBooked: fwd ? (fwd.book.get(date) ?? null) : null,
      reverseTechnical: rev?.tech.get(date) ?? null,
      reverseBooked: rev ? (rev.book.get(date) ?? null) : null,
    })),
  };
}

// ------------------------------------------------------------------ operational rows

/**
 * Gas days covered by an ENTSOG row: [periodFrom, periodTo) clipped to [from, to].
 * A daily row (periodTo = next day, or missing) covers just its own day.
 */
export function expandPeriod(
  start: string,
  end: string | null,
  from: string,
  to: string,
): string[] {
  const dayMs = 86_400_000;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = end ? Date.parse(`${end}T00:00:00Z`) : startMs + dayMs;
  if (!(endMs > startMs)) return start >= from && start <= to ? [start] : [];
  const lo = Math.max(startMs, Date.parse(`${from}T00:00:00Z`));
  const hi = Math.min(endMs - dayMs, Date.parse(`${to}T00:00:00Z`));
  const out: string[] = [];
  for (let t = lo; t <= hi && out.length < 400; t += dayMs)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export type IndexedRows = Map<string, Map<string, { value: number; updated: string }>>;

/**
 * Indexes ENTSOG operationaldata rows by point direction → gas day → mcm/d.
 * - The key is rebuilt as lower(operatorKey + pointKey + directionKey).
 * - "" / null values are missing, never zero.
 * - Capacity rows are validity periods (periodFrom → periodTo, e.g. a firm technical value
 *   valid 2026-10-01 → 2041-10-01): every gas day in the period, clipped to [from, to],
 *   gets the value; where periods overlap, the one starting latest wins, then the latest
 *   revision.
 */
export function indexOperationalRows(
  rows: Array<Record<string, unknown>>,
  indicator: string,
  from: string,
  to: string,
  into: IndexedRows,
  droppedUnits: Record<string, number>,
): IndexedRows {
  for (const row of rows) {
    const pd = String(
      row.pointDirection ??
        `${row.operatorKey ?? ""}${row.pointKey ?? ""}${row.directionKey ?? ""}`,
    )
      .toLowerCase()
      .replace(/\s+/g, "");
    const date = typeof row.periodFrom === "string" ? row.periodFrom.slice(0, 10) : null;
    const raw =
      typeof row.value === "number"
        ? row.value
        : row.value == null || String(row.value).trim() === ""
          ? NaN
          : Number(row.value);
    if (!date || !Number.isFinite(raw)) continue;
    const mcm = toMcmPerDay(raw, row.unit as string | undefined);
    if (mcm === null) {
      const unit = `${String(row.unit ?? "(blank)")} (${indicator})`;
      droppedUnits[unit] = (droppedUnits[unit] ?? 0) + 1;
      continue;
    }
    const end = typeof row.periodTo === "string" ? row.periodTo.slice(0, 10) : null;
    const rank = `${date}|${String(row.lastUpdateDateTime ?? "")}`;
    const byDate = into.get(pd) ?? new Map();
    for (const day of expandPeriod(date, end, from, to)) {
      const prev = byDate.get(day);
      if (!prev || rank >= prev.updated) byDate.set(day, { value: mcm, updated: rank });
    }
    into.set(pd, byDate);
  }
  return into;
}
