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

// EU gas year = 1 Oct → 1 Oct of the following calendar year.
function currentGasYearStart(today = new Date()): number {
  const y = today.getUTCFullYear();
  return today.getUTCMonth() >= 9 ? y : y - 1;
}

function gasYearOptions() {
  const start = currentGasYearStart();
  const years = [-1, 0, 1, 2, 3, 4, 5];
  return years.map((offset) => {
    const y = start + offset;
    return {
      value: String(y),
      label: `Gas year ${y}/${String(y + 1).slice(-2)} (1 Oct ${y} → 1 Oct ${y + 1})`,
      fromISO: `${y}-10-01`,
      toISO: `${y + 1}-10-01`,
    };
  });
}

function CapacityPage() {
  const { flows } = useDashboardData();
  const options = useMemo(gasYearOptions, []);
  const [gasYear, setGasYear] = useState(String(currentGasYearStart()));

  const selected = options.find((o) => o.value === gasYear) ?? options[1];

  const { rows: capacity, range } = useMemo(
    () => dummyCapacity({ fromISO: selected.fromISO, toISO: selected.toISO }),
    [selected.fromISO, selected.toISO],
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
          <span className="text-xs text-muted-foreground">Gas year</span>
          <Select value={gasYear} onValueChange={setGasYear}>
            <SelectTrigger className="h-8 w-[300px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <CapacityCharts
        capacity={capacity}
        flows={flows}
        heatmapFromISO={selected.fromISO}
        heatmapToISO={selected.toISO}
      />
      <CapacityTable capacity={capacity} flows={flows} />
    </div>
  );
}
