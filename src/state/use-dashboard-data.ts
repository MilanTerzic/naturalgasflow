import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { buildBalance, dateRangeIso, todayIso } from "@/lib/gas/demand";
import { dummyFlows, dummyTemperatures, dummyCapacity } from "@/lib/gas/dummy";
import { fetchBelgradeTemperatures } from "@/lib/server/openmeteo.functions";
import { fetchEntsogFlows } from "@/lib/server/entsog.functions";
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
    if (tempQuery.data && tempQuery.data.data.length > 0 && !tempQuery.data.error) {
      temps = tempQuery.data.data;
    } else {
      temps = dummyTemperatures(dates);
      if (tempQuery.data?.error) warnings.push(`Open-Meteo: ${tempQuery.data.error}. Using dummy temperatures.`);
      else if (tempQuery.isError) warnings.push("Open-Meteo unreachable. Using dummy temperatures.");
    }
    if (flowQuery.data && flowQuery.data.data.length > 0 && !flowQuery.data.error) {
      flows = flowQuery.data.data;
    } else {
      flows = dummyFlows(dates);
      if (flowQuery.data?.error) warnings.push(`ENTSOG: ${flowQuery.data.error}. Using dummy flows.`);
      else if (flowQuery.isError) warnings.push("ENTSOG unreachable. Using dummy flows.");
    }
  } else {
    temps = dummyTemperatures(dates);
    flows = dummyFlows(dates);
  }

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

  return {
    balance,
    flows,
    temps,
    capacity,
    dates,
    today,
    warnings,
    isLoading: s.mode === "live" && (tempQuery.isLoading || flowQuery.isLoading),
  };
}
