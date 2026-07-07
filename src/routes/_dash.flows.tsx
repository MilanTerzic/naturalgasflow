import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { FlowsChart } from "@/components/dashboard/FlowsChart";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { fmtMcm } from "@/lib/gas/format";
import { useDashboardData } from "@/state/use-dashboard-data";

export const Route = createFileRoute("/_dash/flows")({
  head: () => ({
    meta: [
      { title: "Flow Details — Serbia Gas Dashboard" },
      { name: "description", content: "Per-point natural gas flows in mcm/day for the four Serbian border points." },
    ],
  }),
  component: FlowsPage,
});

function FlowsPage() {
  const { flows, dates, today } = useDashboardData();

  const diffStats = useMemo(() => {
    const flowByDate = new Map(flows.map((f) => [f.date, f]));
    const diffs: { date: string; value: number }[] = [];
    for (const date of dates) {
      const row = flowByDate.get(date);
      if (!row) continue;
      const kire = row.kireevo;
      const kkd2 = row.kiskundorozsma_2;
      if (kire == null || kkd2 == null) continue;
      if (kire === 0 && kkd2 === 0) continue;
      diffs.push({ date, value: kire - kkd2 });
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

      <ChartCard title="Per-point flows (mcm/day)" subtitle="solid = historical, dashed = forecast" height={460}>
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
