// Fundamental drivers for the price / spread models, aligned to the observation dates.
// A driver is used only when it covers enough of the history; dropped drivers are reported
// with the reason so the UI can say what the model is (and is not) using. Pure.

import type { Drivers } from "./forecast";
import { asOf, isWeekend, mean } from "./series";

/** Heating degree days, base 15.5 °C (Eurogas/ENTSOG convention). */
export const hdd = (t: number) => Math.max(0, 15.5 - t);

export interface DriverSources {
  /** Daily mean temperature (°C) by city key, history and forecast in one map. */
  temps?: Record<string, Map<string, number>>;
  /** Storage fill (%) by country key. */
  storage?: Record<string, Map<string, number>>;
  ttf?: Map<string, number>;
}

export interface DriverReport {
  name: string;
  used: boolean;
  coverage: number;
  reason?: string;
}

/**
 * Storage fill relative to the same calendar day in earlier years (percentage points).
 * With less than one earlier year the raw fill is returned and `normal` is false.
 */
export function storageGap(fill: Map<string, number>, day: string) {
  const v = asOf(fill, day, 7);
  if (v === null) return { gap: null, normal: false };
  const prior: number[] = [];
  for (let k = 1; k <= 5; k++) {
    const d = `${Number(day.slice(0, 4)) - k}${day.slice(4)}`;
    const p = asOf(fill, d, 7);
    if (p !== null) prior.push(p);
  }
  return prior.length ? { gap: v - mean(prior), normal: true } : { gap: v, normal: false };
}

const CITY_LABEL: Record<string, string> = { budapest: "HDD Budapest", sofia: "HDD Sofia" };
const STORAGE_LABEL: Record<string, string> = {
  hu: "Storage vs normal HU",
  bg: "Storage vs normal BG",
};

export function buildDrivers(
  dates: string[],
  future: string[],
  src: DriverSources,
  minCoverage = 0.85,
): { drivers: Drivers | null; report: DriverReport[] } {
  const cols: {
    name: string;
    hist: (number | null)[];
    fut: (number | null)[];
    persist?: boolean;
  }[] = [];
  for (const [city, m] of Object.entries(src.temps ?? {})) {
    const f = (d: string) => {
      const t = asOf(m, d, 1);
      return t === null ? null : hdd(t);
    };
    cols.push({ name: CITY_LABEL[city] ?? `HDD ${city}`, hist: dates.map(f), fut: future.map(f) });
  }
  for (const [c, m] of Object.entries(src.storage ?? {})) {
    const hist = dates.map((d) => storageGap(m, d).gap);
    // Storage moves slowly: carry the latest gap through the horizon.
    const lastGap = [...hist].reverse().find((v) => v !== null) ?? null;
    cols.push({
      name: STORAGE_LABEL[c] ?? `Storage ${c}`,
      hist,
      fut: future.map(() => lastGap),
      persist: true,
    });
  }
  if (src.ttf) {
    const hist = dates.map((d) => asOf(src.ttf!, d, 4));
    const last = [...hist].reverse().find((v) => v !== null) ?? null;
    cols.push({ name: "TTF level", hist, fut: future.map(() => last), persist: true });
  }
  cols.push({
    name: "Weekend",
    hist: dates.map((d) => (isWeekend(d) ? 1 : 0)),
    fut: future.map((d) => (isWeekend(d) ? 1 : 0)),
  });

  const report: DriverReport[] = [];
  const used: typeof cols = [];
  for (const c of cols) {
    const have = c.hist.filter((v) => v !== null).length;
    const coverage = dates.length ? have / dates.length : 0;
    const varies = new Set(c.hist.filter((v) => v !== null)).size > 1;
    if (coverage < minCoverage) {
      report.push({
        name: c.name,
        used: false,
        coverage,
        reason: `covers ${(coverage * 100).toFixed(0)}% of the history`,
      });
      continue;
    }
    if (!varies) {
      report.push({ name: c.name, used: false, coverage, reason: "no variation in the history" });
      continue;
    }
    report.push({ name: c.name, used: true, coverage });
    used.push(c);
  }
  // Weekend alone is calendar noise, not a fundamental model.
  if (!used.some((c) => c.name !== "Weekend")) return { drivers: null, report };
  // Fill remaining gaps: last observation forward, then the column mean.
  const fill = (xs: (number | null)[], fallback: number) => {
    let last: number | null = null;
    return xs.map((v) => {
      if (v !== null) last = v;
      return v ?? last ?? fallback;
    });
  };
  const means = used.map((c) => mean(c.hist.filter((v): v is number => v !== null)));
  const H = used.map((c, j) => fill(c.hist, means[j]));
  const F = used.map((c, j) => fill(c.fut, H[j][H[j].length - 1] ?? means[j]));
  return {
    drivers: {
      names: used.map((c) => c.name),
      X: dates.map((_, i) => used.map((_, j) => H[j][i])),
      future: future.map((_, i) => used.map((_, j) => F[j][i])),
      persist: used.map((c) => c.persist === true),
    },
    report,
  };
}
