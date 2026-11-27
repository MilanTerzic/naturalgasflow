// Newsletter digest of the HU ↔ BG (via Serbia) arbitrage analytics: where today's
// CEEGEX − BGH spread sits against history and against break-even, how often each direction
// was open recently and in the same month of earlier years, and the 7-day window outlook from
// the Arbitrage tab's ensemble. Pure; relative imports only (unit-tested). Every figure is
// null when its input is missing — nothing is filled in.

import { windowStats, type SpreadRow, type WindowStats } from "./history";
import { addDays, mean } from "./series";
import type { PathPoint } from "./forecast";
import type { Signal } from "./ta";

export interface OpenProbLike {
  date: string;
  spread: PathPoint;
  costBgHu: number | null;
  costHuBg: number | null;
  pBgHu: number | null;
  pHuBg: number | null;
}

export interface SeasonalStats {
  /** Calendar month, 1–12. */
  month: number;
  years: number;
  days: number;
  shareBgHu: number;
  shareHuBg: number;
  meanSpread: number;
}

export interface ArbDigest {
  day: string;
  spread: number;
  provisional: boolean;
  /** Mean spread over the 7 observations before `day`. */
  spreadAvg7: number | null;
  /** Share of spreads in the 365 calendar days before `day` at or below today's, 0–1. */
  percentile365: number | null;
  costBgHu: number | null;
  costHuBg: number | null;
  /** Net margin at reserve prices; positive = open. */
  netBgHu: number | null;
  netHuBg: number | null;
  last30: WindowStats;
  monthToDate: WindowStats;
  /** Same calendar month in earlier years (crisis months excluded). */
  seasonal: SeasonalStats | null;
  outlook: OpenProbLike[];
  peakBgHu: { date: string; p: number } | null;
  peakHuBg: { date: string; p: number } | null;
  /** Technical read on the spread: −1 … +1 (+ widens BG → HU). */
  taScore: number | null;
  signals: Signal[];
  /** Ensemble skill vs random walk (1 − MAE/MAE_rw) at 1 and 7 days. */
  skill1: number | null;
  skill7: number | null;
}

const fin = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

function peak(outlook: OpenProbLike[], key: "pBgHu" | "pHuBg") {
  let best: { date: string; p: number } | null = null;
  for (const o of outlook) {
    const p = o[key];
    if (fin(p) && (!best || p > best.p)) best = { date: o.date, p };
  }
  return best;
}

export function seasonalStats(rows: SpreadRow[], day: string): SeasonalStats | null {
  const m = day.slice(5, 7);
  const cur = day.slice(0, 7);
  const same = rows.filter(
    (r) => r.date.slice(5, 7) === m && r.date.slice(0, 7) < cur && !r.crisis,
  );
  if (same.length < 10) return null;
  const s = windowStats(same);
  return {
    month: Number(m),
    years: new Set(same.map((r) => r.date.slice(0, 4))).size,
    days: same.length,
    shareBgHu: s.shareBgHu,
    shareHuBg: s.shareHuBg,
    meanSpread: s.meanSpread ?? Number.NaN,
  };
}

export function arbDigest(
  rows: SpreadRow[],
  opts: {
    outlook?: OpenProbLike[];
    horizon?: number;
    signals?: Signal[];
    taScore?: number | null;
    skill?: number[] | null;
  } = {},
): ArbDigest | null {
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const before = rows.slice(0, -1);
  const prior7 = before.slice(-7).map((r) => r.spread);
  const yearAgo = addDays(last.date, -365);
  const year = before.filter((r) => r.date >= yearAgo).map((r) => r.spread);
  const from30 = addDays(last.date, -29);
  const outlook = (opts.outlook ?? []).slice(0, opts.horizon ?? 7);
  const skill = opts.skill ?? null;
  return {
    day: last.date,
    spread: last.spread,
    provisional: last.provisional,
    spreadAvg7: prior7.length ? mean(prior7) : null,
    percentile365:
      year.length >= 60 ? year.filter((s) => s <= last.spread).length / year.length : null,
    costBgHu: last.costBgHu,
    costHuBg: last.costHuBg,
    netBgHu: last.netBgHu,
    netHuBg: last.netHuBg,
    last30: windowStats(rows.filter((r) => r.date >= from30)),
    monthToDate: windowStats(rows.filter((r) => r.date.slice(0, 7) === last.date.slice(0, 7))),
    seasonal: seasonalStats(rows, last.date),
    outlook,
    peakBgHu: peak(outlook, "pBgHu"),
    peakHuBg: peak(outlook, "pHuBg"),
    taScore: opts.signals?.length ? (opts.taScore ?? null) : null,
    signals: opts.signals ?? [],
    skill1: fin(skill?.[0]) ? skill![0] : null,
    skill7: fin(skill?.[6]) ? skill![6] : null,
  };
}

const f2 = (v: number) => v.toFixed(2);
const sg = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
const pc = (v: number) => `${Math.round(v * 100)}%`;
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function taLabel(score: number | null): string | null {
  if (score === null) return null;
  return score >= 0.34
    ? "widening (favours BG→HU)"
    : score <= -0.34
      ? "narrowing (favours HU→BG)"
      : "mixed";
}

/** Summary sentences for the newsletter's at-a-glance list. */
export function digestSentences(d: ArbDigest | null): string[] {
  if (!d) return [];
  const out: string[] = [];
  const parts = [`HU–BG spread (CEEGEX − BGH) ${sg(d.spread)} €/MWh for ${d.day}`];
  if (d.percentile365 !== null)
    parts.push(`${ordinal(Math.round(d.percentile365 * 100))} percentile of the last 12 months`);
  if (d.netBgHu !== null && d.netHuBg !== null) {
    const best =
      d.netBgHu >= d.netHuBg ? { dir: "BG→HU", v: d.netBgHu } : { dir: "HU→BG", v: d.netHuBg };
    parts.push(
      best.v > 0
        ? `${best.dir} clears transport by ${f2(best.v)} €/MWh`
        : `both directions below break-even (closest ${best.dir}, ${f2(-best.v)} €/MWh short)`,
    );
  }
  out.push(`${parts.join("; ")}.`);
  if (d.peakBgHu && d.peakHuBg)
    out.push(
      `Arbitrage outlook (next ${d.outlook.length} days): window probability up to ${pc(d.peakBgHu.p)} BG→HU (${d.peakBgHu.date}) and ${pc(d.peakHuBg.p)} HU→BG (${d.peakHuBg.date}).`,
    );
  return out;
}
