import type { SpreadRow } from "@/lib/gas/arb/history";
import { addDays } from "@/lib/gas/arb/series";

export const n2 = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(2);
export const sgn = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`;
export const pct = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : `${(Math.abs(v * 100) < 0.5 * 10 ** -d ? 0 : v * 100).toFixed(d)}%`;
export const toneOf = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : v > 0 ? "text-emerald-600" : v < 0 ? "text-rose-600" : "";

export const RANGES = [
  { id: "3m", label: "3M", days: 92 },
  { id: "1y", label: "1Y", days: 366 },
  { id: "3y", label: "3Y", days: 3 * 366 },
  { id: "all", label: "All", days: Infinity },
] as const;

export function inRange(rows: SpreadRow[], range: string) {
  const r = RANGES.find((x) => x.id === range) ?? RANGES[1];
  if (!rows.length || !Number.isFinite(r.days)) return rows;
  const from = addDays(rows[rows.length - 1].date, -r.days);
  return rows.filter((x) => x.date >= from);
}
