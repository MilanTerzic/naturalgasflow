import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CapacityCharts } from "@/components/dashboard/CapacityCharts";
import { CapacityTable } from "@/components/dashboard/CapacityTable";
import { dummyCapacity } from "@/lib/gas/dummy";
import { realCapacityAndFlows, SNAPSHOT_RANGE } from "@/lib/gas/real-data";
import { useDashboardData } from "@/state/use-dashboard-data";
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

function overlapsSnapshot(fromISO: string, toISO: string) {
  return fromISO < SNAPSHOT_RANGE.toISO && toISO > SNAPSHOT_RANGE.fromISO;
}

function CapacityPage() {
  const { flows: liveFlows } = useDashboardData();
  const options = useMemo(gasYearOptions, []);
  const [gasYear, setGasYear] = useState(String(currentGasYearStart()));

  const selected = options.find((o) => o.value === gasYear) ?? options[1];

  const { capacity, flows, usingReal } = useMemo(() => {
    if (overlapsSnapshot(selected.fromISO, selected.toISO)) {
      const r = realCapacityAndFlows({
        fromISO: selected.fromISO,
        toISO: selected.toISO,
      });
      return { capacity: r.capacity, flows: r.flows, usingReal: true };
    }
    const d = dummyCapacity({ fromISO: selected.fromISO, toISO: selected.toISO });
    return { capacity: d.rows, flows: liveFlows, usingReal: false };
  }, [selected.fromISO, selected.toISO, liveFlows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border bg-card p-3 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold">Capacity bookings</h2>
          <p className="text-xs text-muted-foreground">
            Period shown:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {fmtShortDate(selected.fromISO)} → {fmtShortDate(selected.toISO)}
            </span>{" "}
            ·{" "}
            {usingReal
              ? `ENTSOG operational data (snapshot ${fmtShortDate(SNAPSHOT_RANGE.fromISO)} → ${fmtShortDate(SNAPSHOT_RANGE.toISO)}).`
              : "Modelled values — outside the available ENTSOG snapshot window."}
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
