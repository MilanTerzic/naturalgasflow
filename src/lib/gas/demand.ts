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

  // Historical fill: for each historical date (≤ today) with missing/zero
  // flow data, carry forward the most recent prior day that has positive
  // values, looking back up to MAX_LOOKBACK days. Mark those rows estimated.
  const MAX_LOOKBACK = 3;
  const flowKeys: (keyof FlowRow)[] = [
    "kiskundorozsma_hu",
    "kireevo",
    "kiskundorozsma_2",
    "kalotina",
  ];
  const flowDaily: Record<string, FlowRow | undefined> = {};
  const estimatedFrom: Record<string, string | undefined> = {};
  for (const d of dates) flowDaily[d] = flowByDate.get(d);

  const hasUsableFlow = (r: FlowRow | undefined) =>
    !!r && (r.kireevo > 0 || r.kalotina > 0 || r.kiskundorozsma_hu > 0);

  const todayIdx = dates.indexOf(todayIso);
  const lastHistoricalIdx = todayIdx >= 0 ? todayIdx : dates.length - 1;
  for (let i = 0; i <= lastHistoricalIdx; i++) {
    const dKey = dates[i];
    if (hasUsableFlow(flowDaily[dKey])) continue;
    // Walk back up to MAX_LOOKBACK days for a usable source row.
    for (let back = 1; back <= MAX_LOOKBACK && i - back >= 0; back++) {
      const srcKey = dates[i - back];
      const srcRow = flowDaily[srcKey];
      if (!hasUsableFlow(srcRow)) continue;
      const fixed: FlowRow = { ...(srcRow as FlowRow), date: dKey };
      // Preserve any positive values that were present on the target day.
      const orig = flowDaily[dKey];
      if (orig) {
        for (const k of flowKeys) {
          const v = orig[k] as number | undefined;
          if (typeof v === "number" && v > 0) (fixed[k] as number) = v;
        }
      }
      flowDaily[dKey] = fixed;
      estimatedFrom[dKey] = srcKey;
      break;
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
    const demand = clipLow(demandRaw, DEMAND_FLOOR_MCM);

    const f = flowDaily[date] ?? {
      date,
      kiskundorozsma_hu: 0,
      kireevo: 0,
      kiskundorozsma_2: 0,
      kalotina: 0,
    };
    const kkdHu = f.kiskundorozsma_hu || 0;
    const kire = f.kireevo || 0;
    const kkd2 = clipLow(f.kiskundorozsma_2 || 0, 0);
    const kal = f.kalotina || 0;

    const imports_from_bulgaria_mcm = clipLow(kire - kkd2, 0);
    const bosnia_consumption_mcm = clipLow(imports_from_bulgaria_mcm * bihShare, 0);
    const imports_from_bulgaria_available_mcm = clipLow(
      imports_from_bulgaria_mcm - bosnia_consumption_mcm,
      0,
    );

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

    return {
      date,
      ts,
      is_forecast,
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
