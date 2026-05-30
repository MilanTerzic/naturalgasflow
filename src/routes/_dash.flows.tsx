import { createFileRoute } from "@tanstack/react-router";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { FlowsChart } from "@/components/dashboard/FlowsChart";
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
  return (
    <div className="space-y-4">
      <ChartCard title="Per-point flows (mcm/day)" subtitle="solid = historical, dashed = forecast" height={460}>
        <FlowsChart flows={flows} dates={dates} today={today} />
      </ChartCard>
    </div>
  );
}
