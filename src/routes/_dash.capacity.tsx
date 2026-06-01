import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CapacityCharts } from "@/components/dashboard/CapacityCharts";
import { CapacityTable } from "@/components/dashboard/CapacityTable";
import { useDashboardData } from "@/state/use-dashboard-data";
import { dummyCapacity } from "@/lib/gas/dummy";
import { fmtShortDate } from "@/lib/gas/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_dash/capacity")({
  head: () => ({
    meta: [
      { title: "Capacity Bookings — Serbia Gas Dashboard" },
      {
        name: "description",
        content:
          "Cross-border capacity bookings for FGSZ, Bulgartransgaz and Gastrans.",
      },
    ],
  }),
  component: CapacityPage,
});

const HORIZONS = [
  { value: "0.25", label: "Next 3 months" },
  { value: "0.5", label: "Next 6 months" },
  { value: "1", label: "Next 12 months" },
  { value: "2", label: "Next 2 years" },
  { value: "3", label: "Next 3 years" },
  { value: "5", label: "Next 5 years" },
];

function CapacityPage() {
  const { flows } = useDashboardData();
  const [horizon, setHorizon] = useState("1");
  const years = Number(horizon);

  const { rows: capacity, range } = useMemo(
    () => dummyCapacity(years),
    [years],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border bg-card p-3 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold">Capacity bookings</h2>
          <p className="text-xs text-muted-foreground">
            Period shown:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {fmtShortDate(range.fromISO)} → {fmtShortDate(range.toISO)}
            </span>{" "}
            · daily, monthly &amp; quarterly products aggregated per route.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Horizon</span>
          <Select value={horizon} onValueChange={setHorizon}>
            <SelectTrigger className="h-8 w-[170px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HORIZONS.map((h) => (
                <SelectItem key={h.value} value={h.value} className="text-xs">
                  {h.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <CapacityCharts capacity={capacity} flows={flows} />
      <CapacityTable capacity={capacity} flows={flows} />
    </div>
  );
}
