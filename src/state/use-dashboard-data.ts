import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { buildBalance, dateRangeIso, todayIso } from "@/lib/gas/demand";
import { dummyFlows, dummyTemperatures, dummyCapacity } from "@/lib/gas/dummy";
import { fetchBelgradeTemperatures } from "@/lib/data/openmeteo.functions";
import { fetchEntsogFlows } from "@/lib/data/entsog.functions";
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
  todayFallback: boolean; // true when today's flows were carried over from yesterday
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
    staleTime: 30 * 60 * 1000,
  });

  const flowQuery = useQuery({
    queryKey: ["flows", from, to],
    queryFn: () => fetchEntsogFlows({ data: { from, to } }),
    enabled: s.mode === "live",
    staleTime: 30 * 60 * 1000,
  });

  const warnings: string[] = [];
  let temps: TempRow[];
  let flows: FlowRow[];

  if (s.mode === "live") {
    // Temperatures: live only. No silent dummy mix.
    if (tempQuery.data?.error) {
      warnings.push(`Open-Meteo: ${tempQuery.data.error}. Temperature unavailable.`);
      temps = tempQuery.data.data ?? [];
    } else if (tempQuery.isError) {
      warnings.push("Open-Meteo unreachable. Temperature unavailable.");
      temps = [];
    } else {
      temps = tempQuery.data?.data ?? [];
    }
    // Flows: live only.
    if (flowQuery.data?.error) {
      warnings.push(`ENTSOG: ${flowQuery.data.error}. Flow data unavailable.`);
      flows = flowQuery.data.data ?? [];
    } else if (flowQuery.isError) {
      warnings.push("ENTSOG unreachable. Flow data unavailable.");
      flows = [];
    } else {
      flows = flowQuery.data?.data ?? [];
    }
  } else {
    temps = dummyTemperatures(dates);
    flows = dummyFlows(dates);
  }

  // Detect "today fallback": no flow row for today, but yesterday is available.
  const todayFallback = useMemo(() => {
    const hasToday = flows.some((f) => f.date === today && (f.kireevo > 0 || f.kalotina > 0 || f.kiskundorozsma_hu > 0));
    if (hasToday) return false;
    const yIdx = dates.indexOf(today) - 1;
    if (yIdx < 0) return false;
    const y = dates[yIdx];
    return flows.some((f) => f.date === y && (f.kireevo > 0 || f.kalotina > 0));
  }, [flows, today, dates]);

  const balance = useMemo(
    () =>
      buildBalance({
        dates,
        todayIso: today,
        flows,
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
      flows,
      temps,
      s.usePolynomial,
      s.curveShift,
      s.curveDistortion,
      s.bihShare,
      s.domesticProduction,
    ],
  );

  const capacity = useMemo(() => dummyCapacity(), []);

  // Validation: warn on day-over-day total-supply jumps > 50%.
  for (let i = 1; i < balance.length; i++) {
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
    isLoading: s.mode === "live" && (tempQuery.isLoading || flowQuery.isLoading),
    todayFallback,
    refreshedAt: today,
  };
}
