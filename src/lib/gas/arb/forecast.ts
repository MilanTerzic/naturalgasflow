// Forecast engine for a daily series (BGH, CEEGEX or the CEEGEX − BGH spread).
// Four transparent models, a rolling-origin backtest and an inverse-error ensemble whose
// 80% band comes from the ensemble's own backtest errors when there are enough of them.
// Pure; relative imports only (unit-tested).

import { addDays, mean, normCdf, quantile, std, Z80 } from "./series";

export interface PathPoint {
  date: string;
  p50: number;
  lo: number;
  hi: number;
}

export type ModelId = "naive" | "meanrev" | "trend" | "fundamental";

export interface ModelForecast {
  id: ModelId;
  label: string;
  status: "ok" | "insufficient";
  note: string;
  path: PathPoint[];
  params: Record<string, number>;
}

export interface Drivers {
  names: string[];
  /** One row per observation of y (same order), one column per driver. */
  X: number[][];
  /** One row per forecast step. */
  future: number[][];
  /**
   * Columns with no real forecast (TTF, storage): the live forecast holds them at their
   * last value, so the backtest must too. Other columns (weather) use realised values.
   */
  persist?: boolean[];
}

export interface ForecastInput {
  dates: string[];
  y: number[];
  horizon: number;
  drivers?: Drivers | null;
}

export const MODEL_LABEL: Record<ModelId, string> = {
  naive: "Random walk",
  meanrev: "Mean reversion AR(1)",
  trend: "Damped trend (Holt)",
  fundamental: "Fundamentals (ridge)",
};

const MIN_OBS: Record<ModelId, number> = { naive: 10, meanrev: 30, trend: 30, fundamental: 60 };

function futureDates(last: string, h: number): string[] {
  return Array.from({ length: h }, (_, i) => addDays(last, i + 1));
}

const band = (p50: number, sd: number): Pick<PathPoint, "lo" | "hi"> => ({
  lo: p50 - Z80 * sd,
  hi: p50 + Z80 * sd,
});

// --- point models: return p50 path and per-step sd -------------------------------------

interface Core {
  p50: number[];
  sd: number[];
  params: Record<string, number>;
  note: string;
}

function naiveCore(y: number[], h: number): Core {
  const x = y[y.length - 1];
  const p50 = Array(h).fill(x);
  const sd = Array.from({ length: h }, (_, i) => {
    const k = i + 1;
    const d: number[] = [];
    for (let t = Math.max(0, y.length - 250); t + k < y.length; t++) d.push(y[t + k] - y[t]);
    return d.length > 5 ? std(d) : std(y.slice(-60));
  });
  return {
    p50,
    sd,
    params: {},
    note: "Tomorrow looks like today; the benchmark every model must beat.",
  };
}

/** AR(1) around a rolling mean: x − μ decays by φ per step; half-life = ln ½ / ln φ. */
export function fitAr1(y: number[], window = 250) {
  const w = y.slice(-window);
  const mu = mean(w);
  let num = 0;
  let den = 0;
  for (let t = 1; t < w.length; t++) {
    num += (w[t] - mu) * (w[t - 1] - mu);
    den += (w[t - 1] - mu) ** 2;
  }
  const phi = Math.min(0.995, Math.max(-0.5, den > 0 ? num / den : 0));
  const resid: number[] = [];
  for (let t = 1; t < w.length; t++) resid.push(w[t] - mu - phi * (w[t - 1] - mu));
  return { mu, phi, sigma: std(resid) };
}

function meanrevCore(y: number[], h: number): Core {
  const { mu, phi, sigma } = fitAr1(y);
  const x = y[y.length - 1] - mu;
  const p50: number[] = [];
  const sd: number[] = [];
  for (let k = 1; k <= h; k++) {
    p50.push(mu + phi ** k * x);
    const v = phi === 1 ? k : (1 - phi ** (2 * k)) / (1 - phi * phi);
    sd.push(sigma * Math.sqrt(v));
  }
  const halfLife = phi > 0 && phi < 1 ? Math.log(0.5) / Math.log(phi) : Infinity;
  return {
    p50,
    sd,
    params: { mean: mu, phi, halfLifeDays: halfLife },
    note: `Pulled towards the 250-day mean ${mu.toFixed(2)} with a half-life of ${Number.isFinite(halfLife) ? halfLife.toFixed(1) : "∞"} days.`,
  };
}

/** Holt's linear trend with damping 0.9; α, β by one-step grid search. */
function trendCore(y: number[], h: number): Core {
  const w = y.slice(-250);
  const damp = 0.9;
  let best = { sse: Infinity, a: 0.5, b: 0.1 };
  for (const a of [0.1, 0.2, 0.3, 0.5, 0.7, 0.9])
    for (const b of [0.01, 0.05, 0.1, 0.2]) {
      let l = w[0];
      let tr = w[1] - w[0];
      let sse = 0;
      for (let t = 1; t < w.length; t++) {
        const f = l + damp * tr;
        sse += (w[t] - f) ** 2;
        const nl = a * w[t] + (1 - a) * f;
        tr = b * (nl - l) + (1 - b) * damp * tr;
        l = nl;
      }
      if (sse < best.sse) best = { sse, a, b };
    }
  let l = w[0];
  let tr = w[1] - w[0];
  for (let t = 1; t < w.length; t++) {
    const f = l + damp * tr;
    const nl = best.a * w[t] + (1 - best.a) * f;
    tr = best.b * (nl - l) + (1 - best.b) * damp * tr;
    l = nl;
  }
  const s1 = Math.sqrt(best.sse / Math.max(1, w.length - 1));
  const p50: number[] = [];
  const sd: number[] = [];
  let cum = 0;
  for (let k = 1; k <= h; k++) {
    cum += damp ** k;
    p50.push(l + cum * tr);
    sd.push(s1 * Math.sqrt(1 + (k - 1) * best.a * best.a * (1 + k * best.b)));
  }
  return {
    p50,
    sd,
    params: { alpha: best.a, beta: best.b, trendPerDay: tr },
    note: `Extrapolates the recent trend (${tr >= 0 ? "+" : ""}${tr.toFixed(3)}/day), damped so it fades out.`,
  };
}

/** Ridge solve of (XᵀX + λI) b = Xᵀy on centred data; returns intercept + coefficients. */
export function ridge(X: number[][], y: number[], lambda = 1) {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  const mx = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j])));
  const sx = Array.from({ length: p }, (_, j) => std(X.map((r) => r[j])) || 1);
  const my = mean(y);
  const Z = X.map((r) => r.map((v, j) => (v - mx[j]) / sx[j]));
  const A = Array.from({ length: p }, (_, i) =>
    Array.from(
      { length: p },
      (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? lambda : 0),
    ),
  );
  const rhs = Array.from({ length: p }, (_, i) => Z.reduce((s, r, t) => s + r[i] * (y[t] - my), 0));
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [rhs[c], rhs[piv]] = [rhs[piv], rhs[c]];
    for (let r = c + 1; r < p; r++) {
      const f = A[r][c] / (A[c][c] || 1e-12);
      for (let k = c; k < p; k++) A[r][k] -= f * A[c][k];
      rhs[r] -= f * rhs[c];
    }
  }
  const bz = Array(p).fill(0);
  for (let c = p - 1; c >= 0; c--) {
    let s = rhs[c];
    for (let k = c + 1; k < p; k++) s -= A[c][k] * bz[k];
    bz[c] = s / (A[c][c] || 1e-12);
  }
  const coef = bz.map((b, j) => b / sx[j]);
  const intercept = my - coef.reduce((s, b, j) => s + b * mx[j], 0);
  const fitted = X.map((r) => intercept + r.reduce((s, v, j) => s + v * coef[j], 0));
  const resid = y.map((v, t) => v - fitted[t]);
  return { intercept, coef, std: bz, mx, sx, sigma: std(resid), n };
}

export interface DriverContribution {
  name: string;
  coef: number;
  /** Latest standardised value × standardised coefficient, in units of y. */
  contribution: number;
  latest: number;
}

/** y_t = a + b·y_{t−1} + Σ c_j·driver_j,t ; iterated forward on future driver values. */
function fundamentalCore(
  y: number[],
  d: Drivers,
  h: number,
): Core & { contrib: DriverContribution[] } {
  const start = Math.max(1, y.length - 500);
  const X: number[][] = [];
  const Y: number[] = [];
  for (let t = start; t < y.length; t++) {
    X.push([y[t - 1], ...d.X[t]]);
    Y.push(y[t]);
  }
  const fit = ridge(X, Y, 2);
  const lagB = fit.coef[0];
  let prev = y[y.length - 1];
  const p50: number[] = [];
  const sd: number[] = [];
  let v = 0;
  for (let k = 0; k < h; k++) {
    const row = [prev, ...(d.future[k] ?? d.X[d.X.length - 1])];
    const f = fit.intercept + row.reduce((s, x, j) => s + x * fit.coef[j], 0);
    p50.push(f);
    v = v * lagB * lagB + 1;
    sd.push(fit.sigma * Math.sqrt(v));
    prev = f;
  }
  const latest = [y[y.length - 1], ...d.X[d.X.length - 1]];
  const names = ["Yesterday's value", ...d.names];
  const contrib = names.map((name, j) => ({
    name,
    coef: fit.coef[j],
    latest: latest[j],
    contribution: fit.coef[j] * (latest[j] - fit.mx[j]),
  }));
  const params: Record<string, number> = { persistence: lagB, residualSd: fit.sigma };
  d.names.forEach((n, j) => (params[n] = fit.coef[j + 1]));
  return {
    p50,
    sd,
    params,
    contrib,
    note: `Persistence ${lagB.toFixed(2)} plus ${d.names.length} drivers (${d.names.join(", ")}), ridge-regularised.`,
  };
}

function core(id: ModelId, y: number[], h: number, d: Drivers | null | undefined) {
  switch (id) {
    case "naive":
      return naiveCore(y, h);
    case "meanrev":
      return meanrevCore(y, h);
    case "trend":
      return trendCore(y, h);
    case "fundamental":
      return d && d.names.length ? fundamentalCore(y, d, h) : null;
  }
}

export function runModel(
  id: ModelId,
  input: ForecastInput,
): ModelForecast & { contrib?: DriverContribution[] } {
  const { y, horizon: h, dates } = input;
  const dates_ = futureDates(dates[dates.length - 1], h);
  const fail = (note: string): ModelForecast => ({
    id,
    label: MODEL_LABEL[id],
    status: "insufficient",
    note,
    path: [],
    params: {},
  });
  if (y.length < MIN_OBS[id]) return fail(`Needs ${MIN_OBS[id]} observations, has ${y.length}.`);
  const c = core(id, y, h, input.drivers);
  if (!c) return fail("No driver data available.");
  return {
    id,
    label: MODEL_LABEL[id],
    status: "ok",
    note: c.note,
    params: c.params,
    path: c.p50.map((p, i) => ({ date: dates_[i], p50: p, ...band(p, c.sd[i]) })),
    ...("contrib" in c ? { contrib: (c as { contrib: DriverContribution[] }).contrib } : {}),
  };
}

// --- backtest + ensemble -----------------------------------------------------------------

export interface ModelScore {
  id: ModelId | "ensemble";
  label: string;
  /** Mean absolute error by horizon step (index 0 = 1 day ahead). */
  mae: number[];
  /** 1 − MAE / naive MAE at the same step; > 0 beats the random walk. */
  skill: number[];
  /** Share of origins where the predicted direction of change was right (h = 1). */
  hitRate: number | null;
  origins: number;
}

const ALL: ModelId[] = ["naive", "meanrev", "trend", "fundamental"];

function sliceDrivers(d: Drivers | null | undefined, t: number, h: number): Drivers | null {
  if (!d) return null;
  // Weather: realised values stand in for the forecast available at the time.
  // Persisted drivers: held at the last known value, exactly as the live forecast does.
  const last = d.X[t - 1];
  const future = d.X.slice(t, t + h).map((row) =>
    row.map((v, j) => (d.persist?.[j] ? last[j] : v)),
  );
  return { names: d.names, X: d.X.slice(0, t), future, persist: d.persist };
}

/** Rolling-origin backtest over the last `origins` points. */
export function backtest(input: ForecastInput, origins = 60) {
  const { y, horizon: h } = input;
  const errs: Record<ModelId, number[][]> = {
    naive: [],
    meanrev: [],
    trend: [],
    fundamental: [],
  };
  const preds: Record<ModelId, number[][]> = { naive: [], meanrev: [], trend: [], fundamental: [] };
  const actuals: number[][] = [];
  const first = Math.max(MIN_OBS.naive, y.length - origins - h);
  const starts: number[] = [];
  for (let t = first; t + 1 < y.length; t++) starts.push(t);
  for (const t of starts) {
    const hist = y.slice(0, t);
    const act = y.slice(t, t + h);
    actuals.push(act);
    for (const id of ALL) {
      if (hist.length < MIN_OBS[id]) {
        preds[id].push([]);
        errs[id].push([]);
        continue;
      }
      const c = core(id, hist, h, sliceDrivers(input.drivers, t, h));
      const p = c ? c.p50 : [];
      preds[id].push(p);
      errs[id].push(act.map((a, k) => (p[k] === undefined ? Number.NaN : Math.abs(a - p[k]))));
    }
  }
  return { errs, preds, actuals, starts };
}

function maeBy(errs: number[][], h: number): number[] {
  return Array.from({ length: h }, (_, k) => {
    const v = errs.map((e) => e[k]).filter((x) => Number.isFinite(x));
    return v.length >= 5 ? mean(v) : Number.NaN;
  });
}

export interface EnsembleResult {
  models: (ModelForecast & { contrib?: DriverContribution[] })[];
  ensemble: PathPoint[];
  weights: Record<ModelId, number[]>;
  scores: ModelScore[];
  /** "empirical" when the band comes from ≥ 20 backtest errors per step. */
  bandSource: "empirical" | "model";
}

export function forecastEnsemble(input: ForecastInput, origins = 60): EnsembleResult {
  const h = input.horizon;
  const models = ALL.map((id) => runModel(id, input));
  const ok = models.filter((m) => m.status === "ok");
  const bt = backtest(input, origins);
  const mae: Record<ModelId, number[]> = {
    naive: maeBy(bt.errs.naive, h),
    meanrev: maeBy(bt.errs.meanrev, h),
    trend: maeBy(bt.errs.trend, h),
    fundamental: maeBy(bt.errs.fundamental, h),
  };
  const weights: Record<ModelId, number[]> = { naive: [], meanrev: [], trend: [], fundamental: [] };
  for (let k = 0; k < h; k++) {
    const inv = ok.map((m) =>
      Number.isFinite(mae[m.id][k]) ? 1 / Math.max(mae[m.id][k], 1e-6) : 0,
    );
    const tot = inv.reduce((s, x) => s + x, 0);
    for (const id of ALL) weights[id][k] = 0;
    ok.forEach((m, i) => (weights[m.id][k] = tot > 0 ? inv[i] / tot : 1 / ok.length));
  }

  // Ensemble backtest errors (signed) for an empirical band.
  const ensErr: number[][] = Array.from({ length: h }, () => []);
  const ensAbs: number[][] = [];
  bt.actuals.forEach((act, o) => {
    const row: number[] = [];
    act.forEach((a, k) => {
      let p = 0;
      let wsum = 0;
      for (const m of ok) {
        const v = bt.preds[m.id][o]?.[k];
        if (v === undefined || !Number.isFinite(v)) continue;
        p += weights[m.id][k] * v;
        wsum += weights[m.id][k];
      }
      if (wsum > 0) {
        ensErr[k].push(a - p / wsum);
        row.push(Math.abs(a - p / wsum));
      } else row.push(Number.NaN);
    });
    ensAbs.push(row);
  });

  const empirical = ensErr.every((e) => e.length >= 20);
  const ensemble: PathPoint[] = ok.length
    ? ok[0].path.map((pt, k) => {
        const p50 = ok.reduce((s, m) => s + weights[m.id][k] * m.path[k].p50, 0);
        if (empirical) {
          // Symmetric: 80th percentile of absolute backtest errors. Signed quantiles from
          // ~60 overlapping origins skew with the latest move and can leave p50 outside.
          const q = quantile(
            ensErr[k].map((e) => Math.abs(e)),
            0.8,
          );
          return { date: pt.date, p50, lo: p50 - q, hi: p50 + q };
        }
        const sd = ok.reduce(
          (s, m) => s + weights[m.id][k] * ((m.path[k].hi - m.path[k].lo) / (2 * Z80)),
          0,
        );
        return { date: pt.date, p50, ...band(p50, sd) };
      })
    : [];

  const naiveMae = mae.naive;
  const hit = (predRows: number[][]) => {
    let n = 0;
    let right = 0;
    bt.starts.forEach((t, o) => {
      const p = predRows[o]?.[0];
      const a = bt.actuals[o][0];
      if (p === undefined || a === undefined) return;
      const base = input.y[t - 1];
      if (a === base) return;
      n++;
      if (Math.sign(p - base) === Math.sign(a - base)) right++;
    });
    return n >= 10 ? right / n : null;
  };
  const scores: ModelScore[] = ok.map((m) => ({
    id: m.id,
    label: m.label,
    mae: mae[m.id],
    skill: mae[m.id].map((v, k) => 1 - v / naiveMae[k]),
    hitRate: m.id === "naive" ? null : hit(bt.preds[m.id]),
    origins: bt.errs[m.id].filter((e) => e.length).length,
  }));
  if (ok.length) {
    const em = maeBy(ensAbs, h);
    const ensPreds = bt.actuals.map((_, o) => [
      ok.reduce((s, m) => s + weights[m.id][0] * (bt.preds[m.id][o]?.[0] ?? Number.NaN), 0),
    ]);
    scores.push({
      id: "ensemble",
      label: "Ensemble",
      mae: em,
      skill: em.map((v, k) => 1 - v / naiveMae[k]),
      hitRate: hit(ensPreds),
      origins: ensAbs.length,
    });
  }
  return { models, ensemble, weights, scores, bandSource: empirical ? "empirical" : "model" };
}

/** P(value > threshold) from an 80% band, assuming normal errors. */
export function probAbove(pt: PathPoint, threshold: number): number {
  const sd = Math.max(1e-9, (pt.hi - pt.lo) / (2 * Z80));
  return 1 - normCdf((threshold - pt.p50) / sd);
}
