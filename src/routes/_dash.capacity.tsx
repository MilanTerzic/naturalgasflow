import { createFileRoute } from "@tanstack/react-router";
import { CapacityCharts } from "@/components/dashboard/CapacityCharts";
import { CapacityTable } from "@/components/dashboard/CapacityTable";
import { useDashboardData } from "@/state/use-dashboard-data";

export const Route = createFileRoute("/_dash/capacity")({
  head: () => ({
    meta: [
      { title: "Capacity Bookings — Serbia Gas Dashboard" },
      { name: "description", content: "Cross-border capacity bookings for FGSZ, Bulgartransgaz and Gastrans." },
    ],
  }),
  component: CapacityPage,
});

function CapacityPage() {
  const { capacity, flows } = useDashboardData();
  return (
    <div className="space-y-4">
      <CapacityCharts capacity={capacity} flows={flows} />
      <CapacityTable capacity={capacity} flows={flows} />
    </div>
  );
}
