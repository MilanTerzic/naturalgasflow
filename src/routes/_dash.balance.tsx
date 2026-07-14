import { createFileRoute } from "@tanstack/react-router";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { CompositionChart } from "@/components/dashboard/CompositionChart";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { StorageChart } from "@/components/dashboard/StorageChart";
import { TemperatureChart } from "@/components/dashboard/TemperatureChart";
import { useDashboardData } from "@/state/use-dashboard-data";

export const Route = createFileRoute("/_dash/balance")({
  head: () => ({
    meta: [
      { title: "Gas Balance — Serbia Gas Dashboard" },
      { name: "description", content: "Daily Serbian gas balance: supply composition, temperature, storage." },
    ],
  }),
  component: BalancePage,
});

function BalancePage() {
  const { balance, today, warnings, isLoading } = useDashboardData();
  return (
    <div className="space-y-4">
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
      {isLoading && (
        <div className="rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
          Fetching live data…
        </div>
      )}
      <KpiRow balance={balance} today={today} />
      <ChartCard title="Daily composition of Serbia demand" subtitle="mcm/day — stacked supply vs required demand" height={340}>
        <CompositionChart data={balance} today={today} />
      </ChartCard>
      <ChartCard title="Belgrade temperature" subtitle="actual + forecast" height={200}>
        <TemperatureChart data={balance} today={today} />
      </ChartCard>
      <ChartCard title="Storage ± (supply − demand)" subtitle="green = injection, red = withdrawal" height={220}>
        <StorageChart data={balance} today={today} />
      </ChartCard>
    </div>
  );
}
