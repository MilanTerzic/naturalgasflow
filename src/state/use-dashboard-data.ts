import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { buildBalance, dateRangeIso, todayIso } from "@/lib/gas/demand";
import { dummyFlows, dummyTemperatures, dummyCapacity } from "@/lib/gas/dummy";
import { fetchBelgradeTemperatures } from "@/lib/data/openmeteo.functions";
import { fetchEntsogAllocations, fetchEntsogFlows } from "@/lib/data/entsog.functions";
import type { BalanceRow, CapacityRow, FlowRow, TempRow } from "@/lib/gas/types";
import { useDashboard } from "./dashboard-context";

export interface DashboardData {
  balance: BalanceRow[];
  flows: FlowRow[];
  temps: TempRow[];
  capacity: CapacityRow[];
  dates: string[];
  today: string;
  warnings: string[];
  isLoading: boolean;
  todayFallback: boolean; // true when today's allocation inputs were carried over
  refreshedAt: string;
}

export function useDashboardData(): DashboardData {
  const s = useDashboard();
  const today = todayIso();

  const dates = useMemo(() => {
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - s.rangePastDays);
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + s.rangeFutureDays);
    return dateRangeIso(start, end);
  }, [today, s.rangePastDays, s.rangeFutureDays]);

  const from = dates[0];
  const to = dates[dates.length - 1];

  const tempQuery = useQuery({
    queryKey: ["temps", from, to],
    queryFn: () => fetchBelgradeTemperatures({ data: { from, to } }),
    enabled: s.mode === "live",
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const flowQuery = useQuery({
    queryKey: ["flows", from, to],
    queryFn: () => fetchEntsogFlows({ data: { from, to } }),
    enabled: s.mode === "live",
    staleTime: 30 * 60 * 1000,
  });

  const allocationQuery = useQuery({
    queryKey: ["allocations", from, to],
    queryFn: () => fetchEntsogAllocations({ data: { from, to } }),
    enabled: s.mode === "live",
    staleTime: 30 * 60 * 1000,
  });

  const warnings: string[] = [];
  let temps: TempRow[];
  let flows: FlowRow[];
  let balanceFlows: FlowRow[];

  if (s.mode === "live") {
    // Temperatures: live only. No silent dummy mix.
    if (tempQuery.data?.error) {
      warnings.push(`${tempQuery.data.error}. Temperature unavailable.`);
      temps = tempQuery.data.data ?? [];
    } else if (tempQuery.isError) {
      warnings.push("Weather providers unreachable. Temperature unavailable.");
      temps = [];
    } else {
      if (tempQuery.data?.warning) warnings.push(tempQuery.data.warning);
      temps = tempQuery.data?.data ?? [];
    }
    // Physical flows remain available for Flow Details / the pipeline map.
    if (flowQuery.data?.error || flowQuery.isError) {
      flows = flowQuery.data?.data ?? [];
    } else {
      flows = flowQuery.data?.data ?? [];
    }

    // Serbian balance uses ENTSOG Allocation actuals. Current-day gaps may still
    // use ENTSOG renomination/nomination as explicitly provisional substitutes.
    if (allocationQuery.data?.error) {
      warnings.push(`ENTSOG Allocation: ${allocationQuery.data.error}. Allocation data unavailable.`);
      balanceFlows = allocationQuery.data.data ?? [];
    } else if (allocationQuery.isError) {
      warnings.push("ENTSOG Allocation unreachable. Allocation data unavailable.");
      balanceFlows = [];
    } else {
      balanceFlows = allocationQuery.data?.data ?? [];
    }
  } else {
    temps = dummyTemperatures(dates);
    flows = dummyFlows(dates);
    balanceFlows = flows;
  }

  // A published zero is real data. Current-day ENTSOG nominations/renominations
  // also count as operational coverage, but remain explicitly provisional.
  const todayFallback = useMemo(() => {
    const hasCompleteOperationalCoverage = (row: FlowRow | undefined) => {
      if (!row) return false;
      if (row.point_source) {
        return Boolean(
          row.point_source.kiskundorozsma_hu &&
            row.point_source.kireevo &&
            row.point_source.kiskundorozsma_2 &&
            row.point_source.kalotina,
        );
      }
      return !row.published_points || row.published_points.length === 4;
    };

    const todayRow = balanceFlows.find((f) => f.date === today);
    if (hasCompleteOperationalCoverage(todayRow)) return false;

    const yIdx = dates.indexOf(today) - 1;
    if (yIdx < 0) return false;
    const yesterdayRow = balanceFlows.find((f) => f.date === dates[yIdx]);
    return (
      !!yesterdayRow &&
      (!yesterdayRow.published_points || yesterdayRow.published_points.length === 4)
    );
  }, [balanceFlows, today, dates]);

  const dataThrough = useMemo(() => {
    return [...balanceFlows]
      .filter(
        (f) =>
          f.date <= today &&
          (!f.published_points || f.published_points.length === 4),
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? "";
  }, [balanceFlows, today]);

  const balance = useMemo(
    () =>
      buildBalance({
        dates,
        todayIso: today,
        flows: balanceFlows,
        temps,
        usePolynomial: s.usePolynomial,
        curveShift: s.curveShift,
        curveDistortion: s.curveDistortion,
        bihShare: s.bihShare,
        domesticProduction: s.domesticProduction,
      }),
    [
      dates,
      today,
      balanceFlows,
      temps,
      s.usePolynomial,
      s.curveShift,
      s.curveDistortion,
      s.bihShare,
      s.domesticProduction,
    ],
  );

  const capacity = useMemo(() => dummyCapacity().rows, []);

  // Validation: warn on day-over-day total-supply jumps > 50%.
  for (let i = 1; i < balance.length; i++) {
    if (!balance[i - 1].supply_available || !balance[i].supply_available) continue;
    const a = balance[i - 1].serbian_available_supply_mcm;
    const b = balance[i].serbian_available_supply_mcm;
    if (a > 1 && Math.abs(b - a) / a > 0.5 && !balance[i].is_forecast) {
      const dir = b > a ? "↑" : "↓";
      warnings.push(
        `Supply jump ${dir} ${(((b - a) / a) * 100).toFixed(0)}% on ${balance[i].date} ` +
          `(${a.toFixed(2)} → ${b.toFixed(2)} mcm). Check ENTSOG inputs for this day.`,
      );
    }
  }

  return {
    balance,
    flows,
    temps,
    capacity,
    dates,
    today,
    warnings,
    isLoading: s.mode === "live" && (tempQuery.isLoading || allocationQuery.isLoading),
    todayFallback,
    refreshedAt: dataThrough,
  };
}
