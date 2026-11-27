// Month-ahead / seasonal outlook for the CEEGEX − BGH spread.
// Today's deviation from the seasonal norm decays month by month (AR(1) persistence over
// ~21 trading days) towards that norm. Month-ahead hub prices, when imported, give the
// market-implied spread alongside. Pure.

import { fitAr1 } from "./forecast";
import type { SpreadRow } from "./history";
import { mean, std, Z80 } from "./series";

export interface MonthOutlook {
  month: string; // YYYY-MM
  p50: number;
  lo: number;
  hi: number;
  /** Mean spread in this calendar month over the training years. */
  seasonal: number | null;
  /** Years of history behind the seasonal figure. */
  years: number;
  /** Share of days the BG → HU window was open in this calendar month historically. */
  histShareBgHu: number | null;
  /** Month-ahead CEEGEX − BGH from imported forward prices. */
  forwardSpread: number | null;
}

export function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String((((m % 12) + 12) % 12) + 1).padStart(2, "0")}`;
}

export function monthlyOutlook(
  rows: SpreadRow[],
  opts: {
    months?: number;
    excludeCrisis?: boolean;
    forward?: { BGH?: Map<string, number>; CEEGEX?: Map<string, number> };
  } = {},
): { outlook: MonthOutlook[]; note: string } {
  const months = opts.months ?? 6;
  const train = rows.filter((r) => !(opts.excludeCrisis ?? true) || !r.crisis);
  if (train.length < 40)
    return { outlook: [], note: `Needs 40 days of history, has ${train.length}.` };

  // Monthly means → seasonal profile by calendar month.
  const byMonth = new Map<string, number[]>();
  for (const r of train)
    byMonth.set(r.date.slice(0, 7), [...(byMonth.get(r.date.slice(0, 7)) ?? []), r.spread]);
  const monthMeans = [...byMonth.entries()].map(([k, v]) => ({
    ym: k,
    cal: Number(k.slice(5, 7)),
    v: mean(v),
    n: v.length,
  }));
  const overall = mean(monthMeans.map((m) => m.v));
  const cal = (c: number) => monthMeans.filter((m) => m.cal === c && m.n >= 10);
  const seasonal = (c: number) => (cal(c).length ? mean(cal(c).map((m) => m.v)) : null);
  const allSd = std(monthMeans.map((m) => m.v));

  const last = rows[rows.length - 1];
  const level = mean(rows.slice(-20).map((r) => r.spread));
  const curCal = Number(last.date.slice(5, 7));
  const curNorm = seasonal(curCal) ?? overall;
  const phiDay = fitAr1(train.map((r) => r.spread)).phi;
  const phiMonth = Math.max(0, phiDay) ** 21;
  const deviation = level - curNorm;

  const outlook: MonthOutlook[] = [];
  for (let k = 1; k <= months; k++) {
    const ym = addMonths(last.date.slice(0, 7), k);
    const c = Number(ym.slice(5, 7));
    const norm = seasonal(c) ?? overall;
    const p50 = norm + deviation * phiMonth ** k;
    const sds = cal(c).map((m) => m.v);
    const sd = (sds.length >= 3 ? std(sds) : allSd) || std(train.map((r) => r.spread));
    const hist = train.filter((r) => Number(r.date.slice(5, 7)) === c);
    const fwdB = opts.forward?.BGH?.get(ym);
    const fwdC = opts.forward?.CEEGEX?.get(ym);
    outlook.push({
      month: ym,
      p50,
      lo: p50 - Z80 * sd,
      hi: p50 + Z80 * sd,
      seasonal: seasonal(c),
      years: cal(c).length,
      histShareBgHu: hist.length
        ? hist.filter((r) => (r.netBgHu ?? -1) > 0).length / hist.length
        : null,
      forwardSpread: fwdB !== undefined && fwdC !== undefined ? fwdC - fwdB : null,
    });
  }
  const years = new Set(train.map((r) => r.date.slice(0, 4))).size;
  return {
    outlook,
    note:
      `Seasonal norm from ${years} calendar year(s)${(opts.excludeCrisis ?? true) ? " excluding the Sep 2021 – Mar 2023 crisis" : ""}; ` +
      `today's ${deviation >= 0 ? "+" : ""}${deviation.toFixed(2)} €/MWh deviation keeps ${(phiMonth * 100).toFixed(0)}% of its size each month.`,
  };
}
