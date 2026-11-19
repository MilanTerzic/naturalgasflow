// Capacity booked via RBP auctions at the Serbian border points (Gastrans, Transportgas).
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PALETTE } from "@/lib/gas/config";
import { fmtMcm, fmtShortDateYear } from "@/lib/gas/format";
import type { RbpBookingsResponse } from "@/lib/data/rbp-bookings.functions";
import { RBP_PRODUCTS, type RbpProduct } from "@/lib/rbp/bookings";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PRODUCT_COLOR: Record<RbpProduct, string> = {
  Yearly: "oklch(0.45 0.12 255)",
  Quarterly: "oklch(0.6 0.12 230)",
  Monthly: "oklch(0.72 0.12 190)",
  "Day ahead": "oklch(0.78 0.14 85)",
};

const fmt = (v: number | null | undefined) => (v == null ? "—" : fmtMcm(v));

export function RbpBookingsCard({
  data,
  loading,
  today,
}: {
  data: RbpBookingsResponse | undefined;
  loading: boolean;
  today: string;
}) {
  const points = useMemo(() => data?.points ?? [], [data]);
  const [selected, setSelected] = useState<string | null>(null);
  const point =
    points.find((p) => p.name === selected) ?? points.find((p) => p.auctions.length) ?? points[0];

  const rows = useMemo(
    () =>
      points.map((p) => {
        const day = p.days.find((d) => d.date === today) ?? p.days.at(-1);
        const elapsed = p.days.filter((d) => d.date <= today);
        const avg = elapsed.length
          ? elapsed.reduce((s, d) => s + d.total, 0) / elapsed.length
          : null;
        const forward = p.days.filter((d) => d.date > today);
        const fwdAvg = forward.length
          ? forward.reduce((s, d) => s + d.total, 0) / forward.length
          : null;
        return { p, day, avg, fwdAvg };
      }),
    [points, today],
  );

  const chart = useMemo(
    () =>
      (point?.days ?? []).map((d) => ({
        date: d.date,
        ...Object.fromEntries(RBP_PRODUCTS.map((k) => [k, d.byProduct[k] ?? 0])),
      })),
    [point],
  );

  return (
    <div className="space-y-3 rounded-md border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            Booked via RBP auctions — Gastrans &amp; Transportgas
          </h3>
          <p className="text-xs text-muted-foreground">
            Allocated capacity of closed RBP auctions in force on each gas day (yearly, quarterly,
            monthly, day-ahead; within-day left out), mcm/d. Long-term contracts signed outside RBP
            are not included, so this is not the full booked capacity. Units converted from RBP
            (Gastrans kWh/h, Transportgas kWh/d) at 10.55 GWh/mcm.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {loading
            ? "Loading RBP…"
            : data
              ? `RBP public API · ${fmtShortDateYear(data.fetchedAt.slice(0, 10))}`
              : "RBP unavailable"}
        </span>
      </div>

      {data && !data.allocationPublished && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          RBP returned closed auctions without an allocated-capacity field, so bookings cannot be
          shown from the public API for this period. Nothing is filled in.
        </div>
      )}
      {data && data.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          {data.warnings.slice(0, 3).join(" · ")}
          {data.warnings.length > 3 ? ` · +${data.warnings.length - 3} more` : ""}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Point</TableHead>
            <TableHead className="text-right">Today</TableHead>
            {RBP_PRODUCTS.map((k) => (
              <TableHead key={k} className="text-right">
                {k}
              </TableHead>
            ))}
            <TableHead className="text-right">Avg to date</TableHead>
            <TableHead className="text-right">Forward avg</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                {loading ? "Loading RBP auction allocations…" : "No RBP data for this period."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map(({ p, day, avg, fwdAvg }) => (
              <TableRow
                key={p.name}
                className={p.name === point?.name ? "bg-muted/40" : "cursor-pointer"}
                onClick={() => setSelected(p.name)}
              >
                <TableCell className="text-xs">
                  <div className="font-medium">{p.label}</div>
                  <div className="text-muted-foreground">
                    {p.auctions.length} allocated auctions
                    {p.unpublished ? ` · ${p.unpublished} closed without published allocation` : ""}
                  </div>
                </TableCell>
                <TableCell className="text-right text-xs font-semibold tabular-nums">
                  {fmt(day?.total)}
                </TableCell>
                {RBP_PRODUCTS.map((k) => (
                  <TableCell key={k} className="text-right text-xs tabular-nums">
                    {day?.byProduct[k] ? fmt(day.byProduct[k]) : "—"}
                  </TableCell>
                ))}
                <TableCell className="text-right text-xs tabular-nums">{fmt(avg)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{fmt(fwdAvg)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {point && (
        <div>
          <div className="mb-1 text-xs font-medium">
            {point.label}: RBP-allocated capacity by product (click a row to switch)
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  stroke={PALETTE.axis}
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  stroke={PALETTE.axis}
                  tickFormatter={(v) => fmtMcm(v)}
                />
                <Tooltip
                  formatter={(v: number, name: string) => [`${fmtMcm(v)} mcm/d`, name]}
                  labelFormatter={(l) => `Gas day ${l}`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine x={today} stroke={PALETTE.axis} strokeDasharray="3 3" />
                {RBP_PRODUCTS.map((k) => (
                  <Area
                    key={k}
                    type="stepAfter"
                    dataKey={k}
                    stackId="rbp"
                    stroke={PRODUCT_COLOR[k]}
                    fill={PRODUCT_COLOR[k]}
                    fillOpacity={0.55}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
