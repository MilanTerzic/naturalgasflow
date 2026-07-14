import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { CapacityCharts } from "@/components/dashboard/CapacityCharts";
import { CapacityTable } from "@/components/dashboard/CapacityTable";
import { Button } from "@/components/ui/button";
import { dummyCapacity, dummyFlows } from "@/lib/gas/dummy";
import { fetchLiveCapacityBookings } from "@/lib/data/capacity.functions";
import { fetchEntsogFlows } from "@/lib/data/entsog.functions";
import { realCapacityAndFlows, SNAPSHOT_RANGE } from "@/lib/gas/real-data";
import { useDashboardData } from "@/state/use-dashboard-data";
import { useDashboard } from "@/state/dashboard-context";
import { fmtMwh, fmtShortDate, fmtShortDateYear } from "@/lib/gas/format";
import type { CapacityAuctionRow } from "@/lib/gas/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_dash/capacity")({
  head: () => ({
    meta: [
      { title: "Capacity Bookings - Serbia Gas Dashboard" },
      {
        name: "description",
        content: "Cross-border capacity bookings for FGSZ, Bulgartransgaz and Gastrans.",
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
      label: `Gas year ${y}/${String(y + 1).slice(-2)} (1 Oct ${y} -> 1 Oct ${y + 1})`,
      fromISO: `${y}-10-01`,
      toISO: `${y + 1}-10-01`,
    };
  });
}

function overlapsSnapshot(fromISO: string, toISO: string) {
  return fromISO < SNAPSHOT_RANGE.toISO && toISO > SNAPSHOT_RANGE.fromISO;
}

function dateRangeIso(fromISO: string, toISO: string) {
  const dates: string[] = [];
  for (
    let d = new Date(`${fromISO}T00:00:00Z`);
    d < new Date(`${toISO}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function CapacityPage() {
  const { flows: liveFlows } = useDashboardData();
  const { mode } = useDashboard();
  const options = useMemo(gasYearOptions, []);
  const [gasYear, setGasYear] = useState(String(currentGasYearStart()));
  const [refreshNonce, setRefreshNonce] = useState(0);
  const selected = options.find((o) => o.value === gasYear) ?? options[1];
  const calendar2026FromISO = "2026-01-01";
  const calendar2026ToISO = "2027-01-01";

  const liveCapacityQuery = useQuery({
    queryKey: ["live-capacity-bookings", selected.fromISO, selected.toISO, refreshNonce],
    queryFn: () =>
      fetchLiveCapacityBookings({
        data: {
          from: selected.fromISO,
          to: selected.toISO,
          force: refreshNonce,
        },
      }),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
    enabled: mode === "live",
  });

  const calendar2026CapacityQuery = useQuery({
    queryKey: [
      "live-capacity-bookings-calendar-2026",
      calendar2026FromISO,
      calendar2026ToISO,
      refreshNonce,
    ],
    queryFn: () =>
      fetchLiveCapacityBookings({
        data: {
          from: calendar2026FromISO,
          to: calendar2026ToISO,
          force: refreshNonce,
        },
      }),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
    enabled: mode === "live",
  });

  const calendar2026FlowsQuery = useQuery({
    queryKey: ["flows-calendar-2026", calendar2026FromISO, calendar2026ToISO],
    queryFn: () =>
      fetchEntsogFlows({
        data: {
          from: calendar2026FromISO,
          to: calendar2026ToISO,
        },
      }),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
    enabled: mode === "live",
  });

  const selectedPeriodFlowsQuery = useQuery({
    queryKey: ["flows-capacity-window", selected.fromISO, selected.toISO],
    queryFn: () =>
      fetchEntsogFlows({
        data: {
          from: selected.fromISO,
          to: selected.toISO,
        },
      }),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
    enabled: mode === "live",
  });

  const { capacity, flows, sourceLabel } = useMemo(() => {
    if (mode === "dummy") {
      const d = dummyCapacity({ fromISO: selected.fromISO, toISO: selected.toISO });
      return {
        capacity: d.rows,
        flows: liveFlows,
        sourceLabel: "Demo capacity data. Not live ENTSOG/RBP data.",
      };
    }

    if ((liveCapacityQuery.data?.capacity.length ?? 0) > 0) {
      const hasCached = liveCapacityQuery.data!.capacity.some(
        (row) => row.data_status === "cached",
      );
      return {
        capacity: liveCapacityQuery.data!.capacity,
        flows: liveFlows,
        sourceLabel: `${hasCached ? "Cached" : "Live"} ENTSOG technical and aggregate firm booked capacity refresh (${fmtShortDateYear(liveCapacityQuery.data!.fetchedAt.slice(0, 10))}).`,
      };
    }

    if (overlapsSnapshot(selected.fromISO, selected.toISO)) {
      const r = realCapacityAndFlows({
        fromISO: selected.fromISO,
        toISO: selected.toISO,
      });
      return {
        capacity: r.capacity,
        flows: r.flows,
        sourceLabel: `Historical ENTSOG snapshot (${fmtShortDate(SNAPSHOT_RANGE.fromISO)} -> ${fmtShortDate(SNAPSHOT_RANGE.toISO)}).`,
      };
    }

    return {
      capacity: [],
      flows: liveFlows,
      sourceLabel:
        "Live capacity unavailable for this gas-year window. Missing values display as N/A.",
    };
  }, [mode, selected.fromISO, selected.toISO, liveFlows, liveCapacityQuery.data]);

  const rbpAuctions = liveCapacityQuery.data?.rbpAuctions ?? [];
  const selectedPeriodFlows = useMemo(() => {
    if (mode === "dummy") {
      return dummyFlows(dateRangeIso(selected.fromISO, selected.toISO));
    }

    if ((selectedPeriodFlowsQuery.data?.data.length ?? 0) > 0) {
      return selectedPeriodFlowsQuery.data!.data;
    }

    if (overlapsSnapshot(selected.fromISO, selected.toISO)) {
      return realCapacityAndFlows({
        fromISO: selected.fromISO,
        toISO: selected.toISO,
      }).flows;
    }

    return [];
  }, [mode, selected.fromISO, selected.toISO, selectedPeriodFlowsQuery.data]);

  const calendar2026 = useMemo(() => {
    if (mode === "dummy") {
      const dates = dateRangeIso(calendar2026FromISO, calendar2026ToISO);
      return {
        capacity: dummyCapacity({
          fromISO: calendar2026FromISO,
          toISO: "2026-12-31",
        }).rows,
        flows: dummyFlows(dates),
      };
    }

    if ((calendar2026CapacityQuery.data?.capacity.length ?? 0) > 0) {
      return {
        capacity: calendar2026CapacityQuery.data!.capacity,
        flows: calendar2026FlowsQuery.data?.data ?? [],
      };
    }

    const fallback = realCapacityAndFlows({
      fromISO: calendar2026FromISO,
      toISO: calendar2026ToISO,
    });
    return {
      capacity: fallback.capacity,
      flows: fallback.flows,
    };
  }, [mode, calendar2026CapacityQuery.data, calendar2026FlowsQuery.data]);
  const warnings = [
    ...(liveCapacityQuery.data?.warnings ?? []),
    ...(calendar2026CapacityQuery.data?.warnings ?? []).map((warning) => `2026 stacks: ${warning}`),
    ...(calendar2026FlowsQuery.data?.error
      ? [`2026 stacks: ENTSOG flow data unavailable: ${calendar2026FlowsQuery.data.error}`]
      : []),
    ...(selectedPeriodFlowsQuery.data?.error
      ? [
          `Utilisation heatmap: ENTSOG flow data unavailable: ${selectedPeriodFlowsQuery.data.error}`,
        ]
      : []),
    ...(liveCapacityQuery.data?.error ? [liveCapacityQuery.data.error] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border bg-card p-3 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold">Capacity bookings</h2>
          <p className="text-xs text-muted-foreground">
            Period shown:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {fmtShortDate(selected.fromISO)} {"->"} {fmtShortDate(selected.toISO)}
            </span>{" "}
            - {sourceLabel}
            {liveCapacityQuery.isFetching ? " Refreshing ENTSOG/RBP..." : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRefreshNonce((value) => value + 1)}
            disabled={liveCapacityQuery.isFetching}
            title="Refresh live ENTSOG capacity and RBP auction offers"
          >
            <RefreshCw
              className={`h-4 w-4 ${liveCapacityQuery.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
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
      </div>

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {warnings.slice(0, 3).join(" ")}
        </div>
      )}

      <CapacityCharts
        capacity={capacity}
        flows={flows}
        heatmapFlows={selectedPeriodFlows}
        calendarCapacity={calendar2026.capacity}
        calendarFlows={calendar2026.flows}
        heatmapFromISO={selected.fromISO}
        heatmapToISO={selected.toISO}
      />
      <RbpAuctionTable auctions={rbpAuctions} isLoading={liveCapacityQuery.isFetching} />
      <CapacityTable capacity={capacity} flows={flows} />
    </div>
  );
}

function RbpAuctionTable({
  auctions,
  isLoading,
}: {
  auctions: CapacityAuctionRow[];
  isLoading: boolean;
}) {
  const rows = auctions.slice(0, 12);
  return (
    <div className="rounded-md border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">RBP auction offers</h3>
          <p className="text-xs text-muted-foreground">
            Public RBP auction list for the selected period. Offered capacity is auction offer
            volume, not booked allocation.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {isLoading ? "Refreshing..." : `${auctions.length} rows`}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Point</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Validity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Offered (MWh/d)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                {isLoading
                  ? "Loading RBP auction offers..."
                  : "No RBP auction offers returned for this period."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow
                key={`${r.auction_code}-${r.network_point}-${r.valid_from}-${r.offered_mwh}`}
              >
                <TableCell className="text-xs">
                  <div className="font-medium">{r.network_point}</div>
                  <div className="text-muted-foreground">{r.auction_code}</div>
                </TableCell>
                <TableCell className="text-xs">{r.product_type}</TableCell>
                <TableCell className="text-xs tabular-nums">
                  {r.valid_from} {"->"} {r.valid_to}
                </TableCell>
                <TableCell className="text-xs">{r.status}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {fmtMwh(r.offered_mwh)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
