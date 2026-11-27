// Daily series helpers for the arbitrage analytics. Pure; relative imports only (unit-tested).

export type Hub = "BGH" | "CEEGEX" | "TTF" | "CEGH";
export const HUBS: Hub[] = ["BGH", "CEEGEX", "TTF", "CEGH"];

/** One daily observation. `final = false` marks a provisional (still trading) price. */
export interface DailyPrice {
  date: string;
  price: number;
  final: boolean;
}

/** Calendar (not trading) days between two ISO dates, b − a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function dayOfWeek(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export const isWeekend = (day: string) => [0, 6].includes(dayOfWeek(day));

/** Last value on or before `day` within `maxGap` days (gas hubs skip weekends/holidays). */
export function asOf(map: Map<string, number>, day: string, maxGap = 4): number | null {
  for (let i = 0; i <= maxGap; i++) {
    const v = map.get(addDays(day, -i));
    if (v !== undefined) return v;
  }
  return null;
}

export function toMap(points: DailyPrice[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of points) if (Number.isFinite(p.price)) m.set(p.date, p.price);
  return m;
}

/**
 * Merge price sources by delivery day. Later sources win, except that a provisional
 * price never replaces a final one.
 */
export function mergeDaily(...sources: DailyPrice[][]): DailyPrice[] {
  const by = new Map<string, DailyPrice>();
  for (const src of sources)
    for (const p of src) {
      if (!p.date || !Number.isFinite(p.price)) continue;
      const prev = by.get(p.date);
      if (prev?.final && !p.final) continue;
      by.set(p.date, p);
    }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export const mean = (xs: number[]) =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : Number.NaN;

export function std(xs: number[]): number {
  if (xs.length < 2) return Number.NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** z for the two-sided 80% interval. */
export const Z80 = 1.2815515655446004;

/**
 * Crisis regime (Russian supply cuts → TTF spikes): kept in history charts, excluded from
 * model training by default because spreads then were an order of magnitude wider.
 */
export const CRISIS = { from: "2021-09-01", to: "2023-03-31" } as const;
export const inCrisis = (day: string) => day >= CRISIS.from && day <= CRISIS.to;
