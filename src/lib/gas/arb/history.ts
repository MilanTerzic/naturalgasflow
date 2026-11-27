// Historical HU ↔ BG transit economics through Serbia, day by day.
// Uses the same route engine as the newsletter. Tariffs exist only for the current gas year,
// so earlier days are costed at the same month of the current gas year and flagged
// "tariffProxy" — an approximation shown as such, never as a historical fact.

import { computeRoute, ROUTES, type RouteDef } from "../arbitrage";
import type { FxRates } from "../tariffs/convert";
import { TARIFF_BY_ID } from "../tariffs/data";
import { asOf, inCrisis, mean, type DailyPrice } from "./series";

export const ROUTE_BG_HU = ROUTES.find((r) => r.id === "bg-rs-hu") as RouteDef;
export const ROUTE_HU_BG = ROUTES.find((r) => r.id === "hu-rs-bg") as RouteDef;

/** Current tariff period (all transit legs share it). */
export function tariffPeriod(): { from: string; to: string } {
  const legs = [...ROUTE_BG_HU.legs, ...ROUTE_HU_BG.legs].filter((l) => l.kind === "capacity");
  const ts = legs.map((l) => TARIFF_BY_ID[(l as { id: string }).id]);
  return {
    from: ts.reduce((m, t) => (t.effectiveFrom > m ? t.effectiveFrom : m), "0000-00-00"),
    to: ts.reduce((m, t) => (t.effectiveTo < m ? t.effectiveTo : m), "9999-12-31"),
  };
}

/** Same calendar day inside the current tariff period (Feb 29 → Feb 28). */
export function proxyDay(day: string, period = tariffPeriod()): string {
  if (day >= period.from && day <= period.to) return day;
  const startYear = Number(period.from.slice(0, 4));
  const gyStartMonth = Number(period.from.slice(5, 7));
  const m = Number(day.slice(5, 7));
  const year = m >= gyStartMonth ? startYear : startYear + 1;
  const d = day.slice(8, 10) === "29" && m === 2 ? "28" : day.slice(8, 10);
  return `${year}-${day.slice(5, 7)}-${d}`;
}

export interface SpreadRow {
  date: string;
  bgh: number;
  ceegex: number;
  ttf: number | null;
  cegh: number | null;
  /** CEEGEX − BGH: positive = Hungary dearer, favours BG → HU. */
  spread: number;
  /** Transport cost (capacity + fees + fuel) of each direction, EUR/MWh. */
  costBgHu: number | null;
  costHuBg: number | null;
  /** Net margin after transport at reserve prices. */
  netBgHu: number | null;
  netHuBg: number | null;
  tariffProxy: boolean;
  crisis: boolean;
  provisional: boolean;
}

/** One row per delivery day on which both BGH and CEEGEX have a price. */
export function spreadHistory(
  prices: Record<"BGH" | "CEEGEX", DailyPrice[]> & Partial<Record<"TTF" | "CEGH", DailyPrice[]>>,
  fx: FxRates | null,
): SpreadRow[] {
  const ceegex = new Map(prices.CEEGEX.map((p) => [p.date, p]));
  const ttf = new Map((prices.TTF ?? []).map((p) => [p.date, p.price]));
  const cegh = new Map((prices.CEGH ?? []).map((p) => [p.date, p.price]));
  const period = tariffPeriod();
  const rows: SpreadRow[] = [];
  for (const b of prices.BGH) {
    const c = ceegex.get(b.date);
    if (!c) continue;
    const pd = proxyDay(b.date, period);
    const at = (p: DailyPrice) => ({ date: pd, price: p.price, final: p.final });
    const bgHu = computeRoute(ROUTE_BG_HU, pd, { origin: at(b), destination: at(c) }, fx);
    const huBg = computeRoute(ROUTE_HU_BG, pd, { origin: at(c), destination: at(b) }, fx);
    rows.push({
      date: b.date,
      bgh: b.price,
      ceegex: c.price,
      ttf: asOf(ttf, b.date, 3),
      cegh: asOf(cegh, b.date, 3),
      spread: c.price - b.price,
      costBgHu: bgHu.transportCost,
      costHuBg: huBg.transportCost,
      netBgHu: bgHu.netMargin,
      netHuBg: huBg.netMargin,
      tariffProxy: pd !== b.date,
      crisis: inCrisis(b.date),
      provisional: !b.final || !c.final,
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface WindowStats {
  days: number;
  openBgHu: number;
  openHuBg: number;
  /** Share of days with a positive net margin, 0–1. */
  shareBgHu: number;
  shareHuBg: number;
  /** Mean net margin on open days. */
  avgOpenBgHu: number | null;
  avgOpenHuBg: number | null;
  meanSpread: number | null;
  /** Consecutive open days ending at the last row (0 if closed today). */
  currentStreakBgHu: number;
  currentStreakHuBg: number;
  longestStreakBgHu: number;
  longestStreakHuBg: number;
}

export function windowStats(rows: SpreadRow[]): WindowStats {
  const dir = (k: "netBgHu" | "netHuBg") => {
    const open = rows.filter((r) => (r[k] ?? -Infinity) > 0);
    let longest = 0;
    let run = 0;
    for (const r of rows) {
      run = (r[k] ?? -Infinity) > 0 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    return {
      open: open.length,
      avg: open.length ? mean(open.map((r) => r[k] as number)) : null,
      longest,
      current: run,
    };
  };
  const a = dir("netBgHu");
  const b = dir("netHuBg");
  const n = rows.length;
  return {
    days: n,
    openBgHu: a.open,
    openHuBg: b.open,
    shareBgHu: n ? a.open / n : 0,
    shareHuBg: n ? b.open / n : 0,
    avgOpenBgHu: a.avg,
    avgOpenHuBg: b.avg,
    meanSpread: n ? mean(rows.map((r) => r.spread)) : null,
    currentStreakBgHu: a.current,
    currentStreakHuBg: b.current,
    longestStreakBgHu: a.longest,
    longestStreakHuBg: b.longest,
  };
}

export interface MonthCell {
  month: string; // YYYY-MM
  days: number;
  meanSpread: number;
  shareBgHu: number;
  shareHuBg: number;
  meanNetBgHu: number | null;
}

/** Month-by-month summary for the year × month heat grid. */
export function monthlyGrid(rows: SpreadRow[]): MonthCell[] {
  const by = new Map<string, SpreadRow[]>();
  for (const r of rows) {
    const k = r.date.slice(0, 7);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, rs]) => {
      const s = windowStats(rs);
      const nets = rs.map((r) => r.netBgHu).filter((x): x is number => x !== null);
      return {
        month,
        days: rs.length,
        meanSpread: s.meanSpread ?? 0,
        shareBgHu: s.shareBgHu,
        shareHuBg: s.shareHuBg,
        meanNetBgHu: nets.length ? mean(nets) : null,
      };
    });
}

/**
 * Transport cost of a transit route on `day` for gas bought at `originPrice` (fuel in kind
 * scales with it). Days outside the tariff period use the proxy day, like the history.
 */
export function transportCost(
  route: RouteDef,
  day: string,
  originPrice: number,
  fx: FxRates | null,
): number | null {
  const pd = proxyDay(day);
  const p = { date: pd, price: originPrice, final: true };
  return computeRoute(route, pd, { origin: p, destination: p }, fx).transportCost;
}
