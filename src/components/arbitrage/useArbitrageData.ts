import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGasPrices } from "@/lib/data/gas-prices.functions";
import { fetchTariffFx } from "@/lib/data/fx.functions";
import { fetchAgsiStorage } from "@/lib/data/agsi.functions";
import {
  fetchArbitrageWeather,
  fetchPriceHistory,
  listArbitrageForecasts,
} from "@/lib/data/arbitrage.functions";
import { computeAll, type RouteResult } from "@/lib/gas/arbitrage";
import {
  ROUTE_BG_HU,
  ROUTE_HU_BG,
  spreadHistory,
  transportCost,
  type SpreadRow,
} from "@/lib/gas/arb/history";
import { addDays, mergeDaily, toMap, type DailyPrice, type Hub } from "@/lib/gas/arb/series";
import { buildDrivers, type DriverReport } from "@/lib/gas/arb/drivers";
import {
  forecastEnsemble,
  probAbove,
  type EnsembleResult,
  type PathPoint,
} from "@/lib/gas/arb/forecast";
import { monthlyOutlook, addMonths, type MonthOutlook } from "@/lib/gas/arb/monthly";
import { technicalScore, technicalSignals } from "@/lib/gas/arb/ta";
import type { ForecastBundle, OpenProb, Target } from "./labels";

export { TARGET_LABEL, type ForecastBundle, type OpenProb, type Target } from "./labels";

export const HISTORY_FROM = "2021-01-01";
export const HORIZON = 14;
export function belgradeToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(new Date());
}

const HOUR = 3600_000;

export function useArbitrageData(opts: { excludeCrisis: boolean }) {
  const today = belgradeToday();

  const pricesQ = useQuery({
    queryKey: ["gas-prices"],
    queryFn: () => fetchGasPrices({ data: {} }),
    staleTime: HOUR / 2,
  });
  const fxQ = useQuery({
    queryKey: ["tariff-fx", today],
    queryFn: () => fetchTariffFx({ data: { onOrBefore: today } }),
    staleTime: 6 * HOUR,
  });
  const historyQ = useQuery({
    queryKey: ["arb-history", HISTORY_FROM],
    queryFn: () => fetchPriceHistory({ data: { from: HISTORY_FROM } }),
    staleTime: HOUR,
  });
  const fx = fxQ.data?.fx ?? null;

  // Merge stored/imported history with the live feeds (live wins unless only provisional).
  const series = useMemo(() => {
    const hist = historyQ.data?.series;
    const live = pricesQ.data?.hubs;
    const out = {} as Record<Hub, DailyPrice[]>;
    for (const h of ["BGH", "CEEGEX", "TTF", "CEGH"] as Hub[]) {
      const stored: DailyPrice[] = (hist?.[h] ?? []).map((p) => ({
        date: p.date,
        price: p.price,
        final: p.final,
      }));
      const now: DailyPrice[] = (live?.[h]?.points ?? [])
        .filter((p): p is typeof p & { date: string } => !!p.date)
        .map((p) => ({ date: p.date, price: p.price, final: p.final }));
      out[h] = mergeDaily(stored, now);
    }
    return out;
  }, [historyQ.data, pricesQ.data]);

  const forward = useMemo(() => {
    // Month-ahead quotes by trading day → latest quote per delivery month (trade month + 1).
    const m = (hub: "BGH_MA" | "CEEGEX_MA") => {
      const out = new Map<string, number>();
      for (const p of historyQ.data?.series?.[hub] ?? [])
        out.set(addMonths(p.date.slice(0, 7), 1), p.price);
      return out;
    };
    return { BGH: m("BGH_MA"), CEEGEX: m("CEEGEX_MA") };
  }, [historyQ.data]);

  const rows: SpreadRow[] = useMemo(
    () =>
      spreadHistory(
        { BGH: series.BGH, CEEGEX: series.CEEGEX, TTF: series.TTF, CEGH: series.CEGH },
        fx,
      ),
    [series, fx],
  );
  const firstDay = rows[0]?.date ?? addDays(today, -60);

  const weatherQ = useQuery({
    queryKey: ["arb-weather", firstDay, today],
    queryFn: () => fetchArbitrageWeather({ data: { from: firstDay, to: addDays(today, 16) } }),
    staleTime: 3 * HOUR,
    enabled: rows.length > 0,
  });
  const storageFrom = `${Number(firstDay.slice(0, 4)) - 5}${firstDay.slice(4)}`;
  const agsi = (country: string) => ({
    queryKey: ["agsi", country, storageFrom, today],
    queryFn: () => fetchAgsiStorage({ data: { country, from: storageFrom, to: today } }),
    staleTime: 12 * HOUR,
    enabled: rows.length > 0,
  });
  const huStorageQ = useQuery(agsi("hu"));
  const bgStorageQ = useQuery(agsi("bg"));
  const shadowQ = useQuery({
    queryKey: ["arb-forecasts", addDays(today, -90)],
    queryFn: () => listArbitrageForecasts({ data: { from: addDays(today, -90) } }),
    staleTime: HOUR,
  });

  // Today's route economics: both hubs on the same delivery day (D+1 when both published).
  const routes: RouteResult[] = useMemo(() => {
    const both = (d: string) =>
      series.BGH.some((p) => p.date === d) && series.CEEGEX.some((p) => p.date === d);
    const d1 = addDays(today, 1);
    const day = both(d1) ? d1 : both(today) ? today : (rows[rows.length - 1]?.date ?? today);
    return computeAll(day, { BGH: series.BGH, CEEGEX: series.CEEGEX }, fx);
  }, [series, rows, fx, today]);

  const huStorage = huStorageQ.data;
  const bgStorage = bgStorageQ.data;
  const sources = useMemo(() => {
    const temps: Record<string, Map<string, number>> = {};
    for (const [c, m] of Object.entries(weatherQ.data?.temps ?? {}))
      if (Object.keys(m).length) temps[c] = new Map(Object.entries(m));
    const storage: Record<string, Map<string, number>> = {};
    for (const [c, q] of [
      ["hu", huStorage],
      ["bg", bgStorage],
    ] as const) {
      const m = new Map<string, number>();
      for (const r of q?.data ?? []) if (r.full !== null) m.set(r.gasDayStart, r.full);
      if (m.size) storage[c] = m;
    }
    return { temps, storage, ttf: toMap(series.TTF) };
  }, [weatherQ.data, huStorage, bgStorage, series.TTF]);

  const forecasts = useMemo(() => {
    const train = rows.filter((r) => !opts.excludeCrisis || !r.crisis);
    const out: Partial<Record<Target, ForecastBundle>> = {};
    if (train.length < 10) return out;
    const dates = train.map((r) => r.date);
    const future = Array.from({ length: HORIZON }, (_, i) =>
      addDays(dates[dates.length - 1], i + 1),
    );
    for (const target of ["spread", "BGH", "CEEGEX"] as Target[]) {
      const y = train.map((r) =>
        target === "spread" ? r.spread : target === "BGH" ? r.bgh : r.ceegex,
      );
      // TTF level is a driver for hub levels, not for the spread (it would mostly add noise).
      const { drivers, report } = buildDrivers(dates, future, {
        temps: sources.temps,
        storage: sources.storage,
        ttf: target === "spread" ? undefined : sources.ttf,
      });
      const result = forecastEnsemble({ dates, y, horizon: HORIZON, drivers }, 60);
      const signals = technicalSignals(y);
      out[target] = {
        target,
        result,
        report,
        signals,
        score: technicalScore(signals),
        observations: y.length,
      };
    }
    return out;
  }, [rows, sources, opts.excludeCrisis]);

  const openProbs: OpenProb[] = useMemo(() => {
    const ens = forecasts.spread?.result.ensemble ?? [];
    const lastB = series.BGH[series.BGH.length - 1]?.price;
    const lastC = series.CEEGEX[series.CEEGEX.length - 1]?.price;
    const bghPath = forecasts.BGH?.result.ensemble ?? [];
    const ceePath = forecasts.CEEGEX?.result.ensemble ?? [];
    return ens.map((pt, k) => {
      const costBgHu = transportCost(ROUTE_BG_HU, pt.date, bghPath[k]?.p50 ?? lastB ?? 0, fx);
      const costHuBg = transportCost(ROUTE_HU_BG, pt.date, ceePath[k]?.p50 ?? lastC ?? 0, fx);
      // HU → BG wins when −spread > cost, i.e. spread < −cost.
      return {
        date: pt.date,
        spread: pt,
        costBgHu,
        costHuBg,
        pBgHu: costBgHu === null ? null : probAbove(pt, costBgHu),
        pHuBg: costHuBg === null ? null : 1 - probAbove(pt, -costHuBg),
      };
    });
  }, [forecasts, series, fx]);

  const outlook = useMemo(
    (): { outlook: MonthOutlook[]; note: string } =>
      rows.length
        ? monthlyOutlook(rows, { months: 6, excludeCrisis: opts.excludeCrisis, forward })
        : { outlook: [], note: "No history yet." },
    [rows, opts.excludeCrisis, forward],
  );

  const status = {
    loading: pricesQ.isLoading || historyQ.isLoading || fxQ.isLoading,
    historyError: historyQ.data?.error ?? (historyQ.error ? String(historyQ.error) : null),
    weatherError: weatherQ.data?.error ?? null,
    storageError:
      [huStorageQ.data?.error, bgStorageQ.data?.error].filter(Boolean).join("; ") ||
      (huStorageQ.data?.missingKey ? "AGSI_API_KEY not configured" : null),
    fxError: fxQ.data?.error ?? null,
    imported: Object.fromEntries(
      Object.entries(historyQ.data?.series ?? {}).map(([h, xs]) => [
        h,
        { count: xs.length, from: xs[0]?.date ?? null, to: xs[xs.length - 1]?.date ?? null },
      ]),
    ) as Record<string, { count: number; from: string | null; to: string | null }>,
  };

  return {
    today,
    fx,
    series,
    rows,
    routes,
    forecasts,
    openProbs,
    outlook,
    forward,
    shadow: shadowQ.data?.rows ?? [],
    status,
    refetchHistory: historyQ.refetch,
  };
}
