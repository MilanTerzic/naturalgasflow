import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { FlowsChart } from "@/components/dashboard/FlowsChart";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { SerbiaPipelineFlowMap } from "@/components/dashboard/SerbiaPipelineFlowMap";
import { fmtMcm } from "@/lib/gas/format";
import { fetchAgsiStorage } from "@/lib/data/agsi.functions";
import { CONVERSION_MCM_TO_GWH } from "@/lib/gas/config";
import { useDashboardData } from "@/state/use-dashboard-data";

export const Route = createFileRoute("/_dash/flows")({
  head: () => ({
    meta: [
      { title: "Flow Details — Serbia Gas Dashboard" },
      { name: "description", content: "Daily ENTSOG natural gas flows visualised across Serbian border points and pipeline corridors." },
    ],
  }),
  component: FlowsPage,
});

function FlowsPage() {
  const { flows, balance, dates, today } = useDashboardData();

  const latestFlow = useMemo(() => {
    return [...flows]
      .filter((row) => row.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);
  }, [flows, today]);

  const latestBalance = useMemo(() => {
    if (!latestFlow) return undefined;
    return balance.find((row) => row.date === latestFlow.date);
  }, [balance, latestFlow]);

  const storageQuery = useQuery({
    queryKey: ["agsi-serbia-latest", today],
    queryFn: () =>
      fetchAgsiStorage({
        data: {
          country: "rs",
          from: new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          to: today,
        },
      }),
    staleTime: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const latestStorage = storageQuery.data?.data?.at(-1);

  const exitToSerbia = latestFlow
    ? Math.max(latestFlow.kireevo - latestFlow.kiskundorozsma_2, 0)
    : null;

  const flowToBosnia = latestBalance?.bosnia_consumption_mcm ?? null;

  const storageMcm =
    latestStorage?.gasInStorage == null
      ? null
      : (latestStorage.gasInStorage * 1000) / CONVERSION_MCM_TO_GWH;

  const diffStats = useMemo(() => {
    const flowByDate = new Map(flows.map((f) => [f.date, f]));
    const diffs: { date: string; value: number }[] = [];
    for (const date of dates) {
      const row = flowByDate.get(date);
      if (!row) continue;
      const hasKireevo = !row.published_points || row.published_points.includes("kireevo");
      const hasKkd2 = !row.published_points || row.published_points.includes("kiskundorozsma_2");
      if (!hasKireevo || !hasKkd2) continue;
      diffs.push({ date, value: row.kireevo - row.kiskundorozsma_2 });
    }
    if (diffs.length === 0) {
      return { latest: null, avg: null, max: null, min: null };
    }
    const historical = diffs.filter((d) => d.date <= today);
    const latest = (historical[historical.length - 1] ?? diffs[diffs.length - 1]).value;
    const values = diffs.map((d) => d.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);
    return { latest, avg, max, min };
  }, [flows, dates, today]);

  const fmt = (v: number | null) =>
    v == null ? "n/a" : `${fmtMcm(v)} mcm/d`;

  return (
    <div className="space-y-4">
      <SerbiaPipelineFlowMap
        flows={flows}
        today={today}
        balance={balance}
        storage={latestStorage}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard
          label="Exit to Serbia"
          value={exitToSerbia == null ? "n/a" : `${fmtMcm(exitToSerbia)} mcm/d`}
          hint="Derived Gastrans corridor exit: Kireevo − Horgoš"
          tone="positive"
        />
        <KpiCard
          label="Exit to BiH"
          value={flowToBosnia == null ? "n/a" : `${fmtMcm(flowToBosnia)} mcm/d`}
          hint="Dashboard BiH model estimate; not a measured public flow"
        />
        <KpiCard
          label="Serbia storage"
          value={latestStorage?.full == null ? "n/a" : `${latestStorage.full.toFixed(1)}%`}
          hint={
            latestStorage && storageMcm != null
              ? `${fmtMcm(storageMcm)} mcm in storage · ${latestStorage.gasDayStart}`
              : storageQuery.data?.missingKey
                ? "AGSI_API_KEY not configured"
                : "AGSI+ latest available data"
          }
          tone={
            latestStorage?.full == null
              ? "default"
              : latestStorage.full >= 50
                ? "positive"
                : "warning"
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Latest difference"
          value={fmt(diffStats.latest)}
          hint="Kireevo − Kiskundorozsma 2"
          tone={
            diffStats.latest == null
              ? "default"
              : diffStats.latest >= 0
                ? "positive"
                : "negative"
          }
        />
        <KpiCard label="Average (period)" value={fmt(diffStats.avg)} />
        <KpiCard label="Maximum" value={fmt(diffStats.max)} tone="positive" />
        <KpiCard label="Minimum" value={fmt(diffStats.min)} tone="negative" />
      </div>

      <ChartCard title="Per-point flows (mcm/day)" subtitle="published ENTSOG Physical Flow; missing points remain blank" height={460}>
        <FlowsChart flows={flows} dates={dates} today={today} />
      </ChartCard>

      <div className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">
          Kireevo Entry minus Kiskundorozsma 2 Exit — interpretation
        </div>
        <p>
          <span className="font-medium text-emerald-700">Positive</span> value means more gas is
          entering Serbia via Kireevo than exiting / transiting via Kiskundorozsma 2.{" "}
          <span className="font-medium text-red-700">Negative</span> value means Kiskundorozsma 2
          exit / transit is higher than Kireevo entry.
        </p>
      </div>
    </div>
  );
}
