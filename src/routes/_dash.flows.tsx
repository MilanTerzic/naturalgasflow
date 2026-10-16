import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { FlowsChart } from "@/components/dashboard/FlowsChart";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { SerbiaPipelineFlowMap } from "@/components/dashboard/SerbiaPipelineFlowMap";
import { fmtMcm } from "@/lib/gas/format";
import { gastransAfterHungaryMcm, grossPipelineEntryMcm, hasOperationalObservation, isGastransResidualOutlier } from "@/lib/gas/flow-metrics";
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
  const { flows, allocations, balance, dates, today } = useDashboardData();

  const latestAllocation = useMemo(() => {
    return [...allocations]
      .filter((row) => row.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);
  }, [allocations, today]);

  const latestBalance = useMemo(() => {
    if (!latestAllocation) return undefined;
    return balance.find((row) => row.date === latestAllocation.date);
  }, [balance, latestAllocation]);

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

  const grossPipelineEntry = grossPipelineEntryMcm(latestAllocation);
  const gastransResidual = gastransAfterHungaryMcm(latestAllocation);

  const flowToBosnia = latestBalance?.bosnia_consumption_mcm ?? null;

  const storageMcm =
    latestStorage?.gasInStorage == null
      ? null
      : (latestStorage.gasInStorage * 1000) / CONVERSION_MCM_TO_GWH;

  const diffStats = useMemo(() => {
    const flowByDate = new Map(allocations.map((f) => [f.date, f]));
    const diffs: { date: string; value: number }[] = [];
    for (const date of dates) {
      const row = flowByDate.get(date);
      if (!row) continue;
      const hasKireevo = hasOperationalObservation(row, "kireevo");
      const hasKkd2 = hasOperationalObservation(row, "kiskundorozsma_2");
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
  }, [allocations, dates, today]);

  const fmt = (v: number | null) =>
    v == null ? "n/a" : `${fmtMcm(v)} mcm/d`;

  return (
    <div className="space-y-4">
      <SerbiaPipelineFlowMap
        flows={flows}
        allocationFlows={allocations}
        today={today}
        balance={balance}
        storage={latestStorage}
      />

      {isGastransResidualOutlier(latestAllocation) && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <strong>Allocation reconciliation warning:</strong> Kireevo − Horgoš exceeds the indicative
          Gastrans Serbian-network technical exit capacity (11.5 mcm/day). The balance
          limits its modeled Gastrans delivery to that capacity and excludes the excess
          from supply. The raw residual is not measured imports; reconcile matched TSO data.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Gross pipeline entry"
          value={grossPipelineEntry == null ? "n/a" : `${fmtMcm(grossPipelineEntry)} mcm/d`}
          hint="ENTSOG Allocation; includes gas transiting to Hungary"
          tone="positive"
        />
        <KpiCard
          label="Gastrans to Serbia (max proxy)"
          value={latestBalance?.supply_available
            ? `${fmtMcm(latestBalance.imports_from_bulgaria_mcm)} mcm/d`
            : "n/a"}
          hint="Modeled delivery, never above 11.5 mcm/day technical exit capacity"
          tone={latestBalance?.is_capacity_limited ? "warning" : "default"}
        />
        <KpiCard
          label="Flow to Bosnia"
          value={flowToBosnia == null ? "n/a" : `${fmtMcm(flowToBosnia)} mcm/d`}
          hint="Modeled BiH share, not measured border flow"
        />
        <KpiCard
          label="Kireevo − Horgoš"
          value={gastransResidual == null ? "n/a" : `${fmtMcm(gastransResidual)} mcm/d`}
          hint="Raw cross-TSO allocation difference, not domestic gas delivery"
          tone={isGastransResidualOutlier(latestAllocation) ? "warning" : "default"}
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
          hint="Allocation: Kireevo − Kiskundorozsma 2"
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

      <ChartCard title="Per-point physical flows (mcm/day)" subtitle="Separate ENTSOG Physical Flow series; may differ from the Allocation values used for the gas balance and KPI cards. Missing observations remain blank." height={460}>
        <FlowsChart flows={flows} dates={dates} today={today} />
      </ChartCard>

      <div className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">
          Kireevo Entry minus Kiskundorozsma 2 Exit — allocation interpretation
        </div>
        <p>
          <span className="font-medium text-emerald-700">Positive</span> means the allocated entry
          at Kireevo exceeds the allocated exit at Horgoš; <span className="font-medium text-red-700">negative</span>
          means the reverse. This is a cross-TSO residual, not a direct measure of Serbia's
          domestic imports. Differences may reflect linepack, measurement or reporting timing.
        </p>
      </div>
    </div>
  );
}
