// Demand model + balance builder. Direct port of demand.py.
import {
  BIH_SHARE,
  CURVE_DISTORTION_DEFAULT,
  CURVE_SHIFT_DEFAULT,
  DEMAND_FLOOR_MCM,
  DOMESTIC_PRODUCTION_MCM,
  LINEAR_COEFFS,
  MAX_STORAGE_INJECTION,
  MAX_STORAGE_WITHDRAWAL,
  POLY_COEFFS,
} from "./config";
import type { BalanceRow, FlowRow, TempRow } from "./types";

// numpy.polyval: highest power first.
export function polyval(coeffs: readonly number[], x: number): number {
  let acc = 0;
  for (const c of coeffs) acc = acc * x + c;
  return acc;
}

export function forecastDemand(
  avgTempC: number | null,
  opts: {
    usePolynomial?: boolean;
    curveShift?: number;
    curveDistortion?: number;
  } = {},
): number {
  if (avgTempC == null || Number.isNaN(avgTempC)) return DEMAND_FLOOR_MCM;
  const usePoly = opts.usePolynomial ?? true;
  const shift = opts.curveShift ?? CURVE_SHIFT_DEFAULT;
  const distortion =
    !opts.curveDistortion || opts.curveDistortion === 0
      ? CURVE_DISTORTION_DEFAULT
      : opts.curveDistortion;
  const coeffs = usePoly ? POLY_COEFFS : LINEAR_COEFFS;
  return polyval(coeffs, avgTempC) * distortion + shift;
}

const isoDay = (d: Date) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

export function dateRangeIso(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endMs = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cur.getTime() <= endMs) {
    out.push(isoDay(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function todayIso(): string {
  const d = new Date();
  return isoDay(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}

const clip = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const clipLow = (v: number, lo: number) => (v < lo ? lo : v);

export interface BuildBalanceArgs {
  dates: string[]; // ISO daily
  todayIso: string;
  flows: FlowRow[];
  temps: TempRow[];
  usePolynomial?: boolean;
  curveShift?: number;
  curveDistortion?: number;
  bihShare?: number;
  domesticProduction?: number;
  maxStorageInjection?: number;
  maxStorageWithdrawal?: number;
}

export function buildBalance(args: BuildBalanceArgs): BalanceRow[] {
  const {
    dates,
    todayIso,
    flows,
    temps,
    usePolynomial = true,
    curveShift = 0,
    curveDistortion = 1,
    bihShare = BIH_SHARE,
    domesticProduction = DOMESTIC_PRODUCTION_MCM,
    maxStorageInjection = MAX_STORAGE_INJECTION,
    maxStorageWithdrawal = MAX_STORAGE_WITHDRAWAL,
  } = args;

  const tempByDate = new Map<string, number | null>();
  for (const r of temps) tempByDate.set(r.date, r.temperature_c);

  const flowByDate = new Map<string, FlowRow>();
  for (const r of flows) flowByDate.set(r.date, r);

  // Build temperature series with 2-day rolling avg.
  const tempSeries: (number | null)[] = dates.map((d) => {
    const v = tempByDate.get(d);
    return v == null ? null : v;
  });
  const avgTemp: (number | null)[] = tempSeries.map((_, i) => {
    const a = tempSeries[i];
    const b = i > 0 ? tempSeries[i - 1] : null;
    const vals = [a, b].filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  });

  // --- Flow selection per day ---
  // Rule: trust actual ENTSOG values when present; never sum them with
  // estimates. If a day has no usable actual data, carry forward the most
  // recent historical day. If no historical exists, use the nearest future
  // day as a last-resort fallback. Track source type per day for the UI.
  const flowDaily: Record<string, FlowRow | undefined> = {};
  const estimatedFrom: Record<string, string | undefined> = {};
  const sourceType: Record<string, "actual" | "historical_fallback" | "future_fallback" | "none"> = {};
  for (const d of dates) flowDaily[d] = flowByDate.get(d);

  // "Usable" = at least one of the import points has a positive value.
  // A row of all zeros is treated as missing (ENTSOG hasn't published yet).
  const hasUsableFlow = (r: FlowRow | undefined) =>
    !!r && (r.kireevo > 0 || r.kalotina > 0 || r.kiskundorozsma_hu > 0);

  const todayIdx = dates.indexOf(todayIso);
  const lastHistoricalIdx = todayIdx >= 0 ? todayIdx : dates.length - 1;

  for (let i = 0; i <= lastHistoricalIdx; i++) {
    const dKey = dates[i];
    if (hasUsableFlow(flowDaily[dKey])) {
      sourceType[dKey] = "actual";
      continue;
    }
    // Walk back for the most recent historical day with real data.
    let filled = false;
    for (let back = 1; back <= i; back++) {
      const srcKey = dates[i - back];
      const srcRow = flowDaily[srcKey];
      if (!hasUsableFlow(srcRow)) continue;
      flowDaily[dKey] = { ...(srcRow as FlowRow), date: dKey };
      estimatedFrom[dKey] = srcKey;
      sourceType[dKey] = "historical_fallback";
      filled = true;
      break;
    }
    if (filled) continue;
    // Last-resort: walk forward for the nearest future day with real data.
    for (let fwd = i + 1; fwd < dates.length; fwd++) {
      const srcKey = dates[fwd];
      const srcRow = flowDaily[srcKey];
      if (!hasUsableFlow(srcRow)) continue;
      flowDaily[dKey] = { ...(srcRow as FlowRow), date: dKey };
      estimatedFrom[dKey] = srcKey;
      sourceType[dKey] = "future_fallback";
      filled = true;
      break;
    }
    if (!filled) sourceType[dKey] = "none";
  }

  // Debug log: one line per historical day showing what was selected and why.
  if (typeof console !== "undefined") {
    for (let i = 0; i <= lastHistoricalIdx; i++) {
      const dKey = dates[i];
      const r = flowDaily[dKey];
      console.debug(
        `[balance] ${dKey} src=${sourceType[dKey] ?? "none"}` +
          (estimatedFrom[dKey] ? ` from=${estimatedFrom[dKey]}` : "") +
          ` kireevo=${r?.kireevo ?? 0} kkd2=${r?.kiskundorozsma_2 ?? 0}` +
          ` kkdHu=${r?.kiskundorozsma_hu ?? 0} kal=${r?.kalotina ?? 0}`,
      );
    }
  }

  return dates.map((date, i): BalanceRow => {
    const ts = Date.parse(`${date}T00:00:00Z`);
    const is_forecast = date > todayIso;
    const temp = tempSeries[i];
    const avg = avgTemp[i];

    const demandRaw = forecastDemand(avg, {
      usePolynomial,
      curveShift,
      curveDistortion,
    });
    const demand = clipLow(demandRaw, 0);

    const f = flowDaily[date] ?? {
      date,
      kiskundorozsma_hu: 0,
      kireevo: 0,
      kiskundorozsma_2: 0,
      kalotina: 0,
    };
    const kkdHu = clipLow(f.kiskundorozsma_hu || 0, 0);
    const kire = clipLow(f.kireevo || 0, 0);
    const kkd2 = clipLow(f.kiskundorozsma_2 || 0, 0);
    const kal = clipLow(f.kalotina || 0, 0);

    // Gastrans Serbia component = Kireevo exit BG - KKD-2 entry HU, floored at 0.
    // This isolates the gas physically entering Serbia, not regional transit.
    const imports_from_bulgaria_mcm = clipLow(kire - kkd2, 0);
    const bosnia_consumption_mcm = clipLow(imports_from_bulgaria_mcm * bihShare, 0);
    const imports_from_bulgaria_available_mcm = clipLow(
      imports_from_bulgaria_mcm - bosnia_consumption_mcm,
      0,
    );

    // Total Supply formula:
    //   max(Kireevo - KKD-2, 0) + KKD HU + Kalotina + production - Bosnia export
    // Bosnia export is deducted exactly once here.
    const serbian_available_supply_mcm =
      imports_from_bulgaria_mcm + kal + kkdHu + domesticProduction - bosnia_consumption_mcm;

    const storage_imbalance_raw_mcm = serbian_available_supply_mcm - demand;
    const storage_imbalance_mcm = clip(
      storage_imbalance_raw_mcm,
      -maxStorageWithdrawal,
      maxStorageInjection,
    );
    const storage_injection_mcm = Math.max(storage_imbalance_mcm, 0);
    const storage_withdrawal_mcm = -Math.min(storage_imbalance_mcm, 0);

    const src = is_forecast ? "actual" : sourceType[date] ?? "none";
    return {
      date,
      ts,
      is_forecast,
      is_estimated: !is_forecast && src !== "actual" && src !== "none",
      estimated_from: estimatedFrom[date],
      source_type: src,
      temperature_c: temp,
      avg_temperature_c: avg,
      temperature_actual_c: is_forecast ? null : temp,
      temperature_forecast_c: is_forecast ? temp : null,
      demand_mcm: demand,
      required_actual_mcm: is_forecast ? null : demand,
      required_forecast_mcm: is_forecast ? demand : null,
      kalotina_entry_mcm: kal,
      kiskundorozsma_entry_mcm: kkdHu,
      imports_from_bulgaria_mcm,
      imports_from_bulgaria_available_mcm,
      bosnia_consumption_mcm,
      domestic_production_mcm: domesticProduction,
      serbian_available_supply_mcm,
      storage_imbalance_raw_mcm,
      storage_imbalance_mcm,
      storage_injection_mcm,
      storage_withdrawal_mcm,
    };
  });
}

