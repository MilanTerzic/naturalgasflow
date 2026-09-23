// Demand model + balance builder.
import {
  BIH_SHARE,
  CURVE_DISTORTION_DEFAULT,
  CURVE_SHIFT_DEFAULT,
  DOMESTIC_PRODUCTION_MCM,
  LINEAR_COEFFS,
  MAX_SERBIAN_DAILY_MCM,
  MAX_STORAGE_INJECTION,
  MAX_STORAGE_WITHDRAWAL,
  POLY_COEFFS,
} from "./config";
import type {
  BalanceRow,
  FlowPointName,
  FlowRow,
  FlowSourceType,
  TempRow,
} from "./types";

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
  if (avgTempC == null || Number.isNaN(avgTempC)) return 0;
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
  dates: string[];
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

type ResolvedPoint = {
  value: number;
  available: boolean;
  sourceType: FlowSourceType;
  estimatedFrom?: string;
  provisionalSource?: "renomination" | "nomination";
};

const FLOW_POINTS: FlowPointName[] = [
  "kiskundorozsma_hu",
  "kireevo",
  "kiskundorozsma_2",
  "kalotina",
];

function pointPublished(row: FlowRow | undefined, key: FlowPointName) {
  if (!row) return false;
  // Legacy/static datasets predate point-level provenance and are treated as complete.
  return !row.published_points || row.published_points.includes(key);
}

function pointOperationalSource(row: FlowRow | undefined, key: FlowPointName) {
  if (!row) return undefined;
  const explicit = row.point_source?.[key];
  if (explicit) return explicit;
  return pointPublished(row, key) ? "physical_flow" : undefined;
}

function sourcePriority(sources: FlowSourceType[]): FlowSourceType {
  if (sources.includes("none")) return "none";
  if (sources.includes("future_fallback")) return "future_fallback";
  if (sources.includes("historical_fallback")) return "historical_fallback";
  if (sources.includes("provisional")) return "provisional";
  return "actual";
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

  const resolvePoint = (index: number, key: FlowPointName): ResolvedPoint => {
    const date = dates[index];

    // Physical Flow is an observation, not a future supply forecast.
    if (date > todayIso) {
      return { value: 0, available: false, sourceType: "none" };
    }

    const direct = flowByDate.get(date);
    const directSource = pointOperationalSource(direct, key);
    if (
      directSource === "physical_flow" ||
      (date === todayIso && (directSource === "renomination" || directSource === "nomination"))
    ) {
      return {
        value: clipLow(direct?.[key] ?? 0, 0),
        available: true,
        sourceType: directSource === "physical_flow" ? "actual" : "provisional",
        provisionalSource:
          directSource === "renomination" || directSource === "nomination"
            ? directSource
            : undefined,
      };
    }

    // Fill a missing historical point from the most recent published observation.
    for (let back = index - 1; back >= 0; back -= 1) {
      const srcDate = dates[back];
      const row = flowByDate.get(srcDate);
      if (!pointPublished(row, key)) continue;
      return {
        value: clipLow(row?.[key] ?? 0, 0),
        available: true,
        sourceType: "historical_fallback",
        estimatedFrom: srcDate,
      };
    }

    // For old gaps only, use the nearest later observation that is still not in the future.
    for (let fwd = index + 1; fwd < dates.length && dates[fwd] <= todayIso; fwd += 1) {
      const srcDate = dates[fwd];
      const row = flowByDate.get(srcDate);
      if (!pointPublished(row, key)) continue;
      return {
        value: clipLow(row?.[key] ?? 0, 0),
        available: true,
        sourceType: "future_fallback",
        estimatedFrom: srcDate,
      };
    }

    return { value: 0, available: false, sourceType: "none" };
  };

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
    const demand = Math.min(MAX_SERBIAN_DAILY_MCM, clipLow(demandRaw, 0));

    const resolved = Object.fromEntries(
      FLOW_POINTS.map((key) => [key, resolvePoint(i, key)]),
    ) as Record<FlowPointName, ResolvedPoint>;

    const sourceType = sourcePriority(FLOW_POINTS.map((key) => resolved[key].sourceType));
    const supplyAvailable =
      !is_forecast && FLOW_POINTS.every((key) => resolved[key].available);

    const estimatedDates = Array.from(
      new Set(
        FLOW_POINTS.map((key) => resolved[key].estimatedFrom).filter(
          (value): value is string => !!value,
        ),
      ),
    ).sort();

    const provisionalSources = Array.from(
      new Set(
        FLOW_POINTS.map((key) => resolved[key].provisionalSource).filter(
          (value): value is "renomination" | "nomination" => !!value,
        ),
      ),
    );

    const kkdHu = resolved.kiskundorozsma_hu.value;
    const kire = resolved.kireevo.value;
    const kkd2 = resolved.kiskundorozsma_2.value;
    const kal = resolved.kalotina.value;

    const imports_from_bulgaria_mcm = clipLow(kire - kkd2, 0);
    const bosnia_consumption_mcm = clipLow(imports_from_bulgaria_mcm * bihShare, 0);
    const imports_from_bulgaria_available_mcm = clipLow(
      imports_from_bulgaria_mcm - bosnia_consumption_mcm,
      0,
    );

    const serbian_available_supply_mcm =
      imports_from_bulgaria_mcm +
      kal +
      kkdHu +
      domesticProduction -
      bosnia_consumption_mcm;

    const storage_imbalance_raw_mcm = supplyAvailable
      ? serbian_available_supply_mcm - demand
      : 0;
    const storage_imbalance_mcm = supplyAvailable
      ? clip(storage_imbalance_raw_mcm, -maxStorageWithdrawal, maxStorageInjection)
      : 0;
    const residual_gap_mcm = supplyAvailable
      ? storage_imbalance_raw_mcm - storage_imbalance_mcm
      : 0;
    const storage_injection_mcm = Math.max(storage_imbalance_mcm, 0);
    const storage_withdrawal_mcm = -Math.min(storage_imbalance_mcm, 0);

    return {
      date,
      ts,
      is_forecast,
      is_estimated: supplyAvailable && sourceType !== "actual",
      estimated_from: estimatedDates.length ? estimatedDates.join(", ") : undefined,
      source_type: is_forecast ? "none" : sourceType,
      provisional_sources: provisionalSources.length ? provisionalSources : undefined,
      temperature_c: temp,
      avg_temperature_c: avg,
      temperature_actual_c: is_forecast ? null : temp,
      temperature_forecast_c: is_forecast || date === todayIso ? temp : null,
      demand_mcm: demand,
      required_actual_mcm: is_forecast ? null : demand,
      required_forecast_mcm: is_forecast || date === todayIso ? demand : null,
      kalotina_entry_mcm: kal,
      kiskundorozsma_entry_mcm: kkdHu,
      imports_from_bulgaria_mcm,
      imports_from_bulgaria_available_mcm,
      bosnia_consumption_mcm,
      domestic_production_mcm: domesticProduction,
      serbian_available_supply_mcm,
      supply_available: supplyAvailable,
      storage_imbalance_raw_mcm,
      storage_imbalance_mcm,
      residual_gap_mcm,
      storage_injection_mcm,
      storage_withdrawal_mcm,
    };
  });
}
