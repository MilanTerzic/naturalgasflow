// Technical analysis on a daily series (prices or the HU − BG spread). Pure.
// Index-aligned arrays: element i belongs to input i; null until enough history exists.

export type Num = number | null;

export function sma(xs: number[], n: number): Num[] {
  let s = 0;
  return xs.map((x, i) => {
    s += x;
    if (i >= n) s -= xs[i - n];
    return i >= n - 1 ? s / n : null;
  });
}

export function ema(xs: number[], n: number): Num[] {
  const k = 2 / (n + 1);
  let prev: number | null = null;
  return xs.map((x, i) => {
    if (i < n - 1) return null;
    if (prev === null) {
      prev = xs.slice(0, n).reduce((s, v) => s + v, 0) / n;
      return prev;
    }
    prev = x * k + prev * (1 - k);
    return prev;
  });
}

/** Wilder RSI. */
export function rsi(xs: number[], n = 14): Num[] {
  const out: Num[] = xs.map(() => null);
  if (xs.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = xs[i] - xs[i - 1];
    gain += Math.max(0, d);
    loss += Math.max(0, -d);
  }
  gain /= n;
  loss /= n;
  const val = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[n] = val();
  for (let i = n + 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    gain = (gain * (n - 1) + Math.max(0, d)) / n;
    loss = (loss * (n - 1) + Math.max(0, -d)) / n;
    out[i] = val();
  }
  return out;
}

export interface Band {
  mid: Num;
  upper: Num;
  lower: Num;
  /** (x − mid) / σ. */
  z: Num;
}

export function bollinger(xs: number[], n = 20, k = 2): Band[] {
  const mids = sma(xs, n);
  return xs.map((x, i) => {
    const m = mids[i];
    if (m === null) return { mid: null, upper: null, lower: null, z: null };
    const w = xs.slice(i - n + 1, i + 1);
    const sd = Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / n);
    return { mid: m, upper: m + k * sd, lower: m - k * sd, z: sd > 0 ? (x - m) / sd : 0 };
  });
}

export function macd(xs: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(xs, fast);
  const s = ema(xs, slow);
  const line = xs.map((_, i) => (f[i] !== null && s[i] !== null ? f[i]! - s[i]! : null));
  const start = line.findIndex((v) => v !== null);
  const sig: Num[] = xs.map(() => null);
  if (start >= 0) {
    const e = ema(line.slice(start) as number[], signal);
    e.forEach((v, j) => (sig[start + j] = v));
  }
  return line.map((l, i) => ({
    macd: l,
    signal: sig[i],
    hist: l !== null && sig[i] !== null ? l - sig[i]! : null,
  }));
}

export type Bias = "up" | "down" | "neutral";

export interface Signal {
  name: string;
  value: string;
  bias: Bias;
  note: string;
}

const last = <T>(xs: T[]) => xs[xs.length - 1];
const f2 = (v: number) => v.toFixed(2);

/**
 * Indicator read-out for the latest point. "up" means the series is expected to rise —
 * for the CEEGEX − BGH spread, that widens the BG → HU window.
 */
export function technicalSignals(xs: number[]): Signal[] {
  if (xs.length < 30) return [];
  const out: Signal[] = [];
  const x = last(xs);
  const s20 = last(sma(xs, 20));
  const s50 = xs.length >= 50 ? last(sma(xs, 50)) : null;
  if (s20 !== null) {
    const bias: Bias = x > s20 ? "up" : x < s20 ? "down" : "neutral";
    out.push({
      name: "Price vs SMA20",
      value: `${f2(x)} vs ${f2(s20)}`,
      bias,
      note: bias === "up" ? "Above its 20-day average" : "Below its 20-day average",
    });
  }
  if (s20 !== null && s50 !== null) {
    const prev20 = sma(xs, 20)[xs.length - 6];
    const prev50 = sma(xs, 50)[xs.length - 6];
    const cross =
      prev20 !== null && prev50 !== null && Math.sign(prev20 - prev50) !== Math.sign(s20 - s50);
    out.push({
      name: "SMA20 / SMA50",
      value: `${f2(s20)} / ${f2(s50)}`,
      bias: s20 > s50 ? "up" : "down",
      note: `${s20 > s50 ? "Short trend above long" : "Short trend below long"}${cross ? " — crossed in the last week" : ""}`,
    });
  }
  const r = last(rsi(xs));
  if (r !== null) {
    out.push({
      name: "RSI(14)",
      value: r.toFixed(0),
      // Overbought / oversold readings argue for reversal.
      bias: r > 70 ? "down" : r < 30 ? "up" : "neutral",
      note:
        r > 70 ? "Overbought — reversal risk" : r < 30 ? "Oversold — bounce risk" : "Neutral range",
    });
  }
  const b = last(bollinger(xs));
  if (b.z !== null) {
    out.push({
      name: "Bollinger z(20)",
      value: b.z.toFixed(2),
      bias: b.z > 2 ? "down" : b.z < -2 ? "up" : "neutral",
      note:
        b.z > 2
          ? "Stretched above the band — mean-reversion pull down"
          : b.z < -2
            ? "Stretched below the band — mean-reversion pull up"
            : "Inside the bands",
    });
  }
  const m = last(macd(xs));
  if (m.hist !== null) {
    out.push({
      name: "MACD(12,26,9)",
      value: f2(m.hist),
      bias: m.hist > 0 ? "up" : m.hist < 0 ? "down" : "neutral",
      note: m.hist > 0 ? "Momentum building upwards" : "Momentum building downwards",
    });
  }
  if (xs.length > 10) {
    const mom = x - xs[xs.length - 6];
    out.push({
      name: "5-day change",
      value: (mom >= 0 ? "+" : "") + f2(mom),
      bias: mom > 0 ? "up" : mom < 0 ? "down" : "neutral",
      note: "Change over the last five observations",
    });
  }
  return out;
}

/** Net read: +1 per "up", −1 per "down", scaled to −1…+1. */
export function technicalScore(signals: Signal[]): number {
  if (!signals.length) return 0;
  return (
    signals.reduce((s, x) => s + (x.bias === "up" ? 1 : x.bias === "down" ? -1 : 0), 0) /
    signals.length
  );
}
