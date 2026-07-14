import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CONVERSION_MCM_TO_MWH, PALETTE, POINTS, type FlowPoint } from "@/lib/gas/config";
import { CAPACITY_ROUTE_BY_ID } from "@/lib/gas/capacity-routes";
import {
  buildCapacityRouteSummaries,
  deduplicateCapacityAggregate,
  mwhDayToMcmDay,
  type CapacityRouteSummary,
} from "@/lib/gas/capacity-utils";
import { fmtMcm, fmtPct, fmtShortDateYear } from "@/lib/gas/format";
import type { CapacityRow, FlowRow } from "@/lib/gas/types";
import { ChartCard } from "./ChartCard";

interface CalendarRouteSeries {
  key: string;
  label: string;
  flowKey: FlowPoint;
  data: Array<{
    date: string;
    technical_mcm: number | null;
    booked_mcm: number | null;
    available_mcm: number | null;
    flow_mcm: number | null;
  }>;
}

const CALENDAR_PHYSICAL_POINT_ORDER: FlowPoint[] = [
  "kiskundorozsma_hu",
  "kireevo",
  "kalotina",
  "kiskundorozsma_2",
];

function fmtMaybeMcm(v: number | null | undefined) {
  return v == null ? "N/A" : fmtMcm(v);
}

function fmtMaybePct(v: number | null | undefined) {
  return v == null ? "N/A" : fmtPct(v);
}

function dailyCapacitySeries(capacity: CapacityRow[], flows: FlowRow[]): CalendarRouteSeries[] {
  const flowByDate = new Map(flows.map((f) => [f.date, f]));
  const capacityByPoint = new Map<
    FlowPoint,
    Map<string, { technical_mwh: number | null; booked_mwh: number | null }>
  >();

  for (const row of capacity) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.period)) continue;
    const route = row.route_id ? CAPACITY_ROUTE_BY_ID.get(row.route_id) : undefined;
    if (!route) continue;
    const byDate =
      capacityByPoint.get(route.physicalFlowKey) ??
      new Map<string, { technical_mwh: number | null; booked_mwh: number | null }>();
    const existing = byDate.get(row.period);
    const technical = row.technical_mwh ?? row.offered_mwh ?? null;
    const booked = row.booked_mwh ?? null;
    byDate.set(row.period, {
      technical_mwh:
        existing?.technical_mwh == null
          ? technical
          : technical == null
            ? existing.technical_mwh
            : Math.max(existing.technical_mwh, technical),
      booked_mwh:
        existing?.booked_mwh == null
          ? booked
          : booked == null
            ? existing.booked_mwh
            : Math.max(existing.booked_mwh, booked),
    });
    capacityByPoint.set(route.physicalFlowKey, byDate);
  }

  return CALENDAR_PHYSICAL_POINT_ORDER.map((flowKey) => {
    const capacityByDate =
      capacityByPoint.get(flowKey) ??
      new Map<string, { technical_mwh: number | null; booked_mwh: number | null }>();
    const dates = Array.from(
      new Set([...capacityByDate.keys(), ...flows.map((f) => f.date)]),
    ).sort();
    return {
      key: flowKey,
      label: POINTS[flowKey],
      flowKey,
      data: dates.map((date) => {
        const c = capacityByDate.get(date);
        const technical = mwhDayToMcmDay(c?.technical_mwh);
        const booked =
          c?.booked_mwh == null
            ? null
            : Math.min(c.booked_mwh / CONVERSION_MCM_TO_MWH, technical ?? Number.POSITIVE_INFINITY);
        const flow = flowByDate.get(date)?.[flowKey] ?? null;
        return {
          date,
          technical_mcm: technical,
          booked_mcm: booked,
          available_mcm:
            technical == null || booked == null ? null : Math.max(technical - booked, 0),
          flow_mcm: flow,
        };
      }),
    };
  }).filter((route) =>
    route.data.some(
      (d) =>
        (d.technical_mcm != null && d.technical_mcm > 0) || (d.flow_mcm != null && d.flow_mcm > 0),
    ),
  );
}

function heatColor(pct: number | null): string {
  if (!Number.isFinite(pct ?? NaN) || (pct ?? 0) <= 0) return "oklch(0.96 0.01 240)";
  const p = Math.min(pct ?? 0, 120) / 120;
  const hue = 220 - 205 * p;
  const chroma = 0.05 + 0.15 * p;
  const light = 0.92 - 0.45 * p;
  return `oklch(${light.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`;
}

function monthBucketsBetween(fromISO: string, toISO: string) {
  const from = new Date(`${fromISO}T00:00:00Z`);
  const to = new Date(`${toISO}T00:00:00Z`);
  const out: { key: string; label: string }[] = [];
  let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (d < to) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const monthShort = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ][m];
    out.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      label: `${monthShort} ${String(y).slice(-2)}`,
    });
    d = new Date(Date.UTC(y, m + 1, 1));
  }
  return out;
}

export function CapacityCharts({
  capacity,
  flows,
  heatmapFlows,
  calendarCapacity,
  calendarFlows,
  heatmapFromISO,
  heatmapToISO,
}: {
  capacity: CapacityRow[];
  flows: FlowRow[];
  heatmapFlows?: FlowRow[];
  calendarCapacity?: CapacityRow[];
  calendarFlows?: FlowRow[];
  heatmapFromISO?: string;
  heatmapToISO?: string;
}) {
  const routes = useMemo(() => buildCapacityRouteSummaries(capacity, flows), [capacity, flows]);
  const heatmapRoutes = useMemo(
    () => buildCapacityRouteSummaries(capacity, heatmapFlows ?? flows),
    [capacity, flows, heatmapFlows],
  );
  const aggregate = useMemo(() => deduplicateCapacityAggregate(routes), [routes]);
  const referenceDate = routes.find((route) => route.flow_reference_date)?.flow_reference_date;
  const capacityReferenceDate = routes.find(
    (route) => route.capacity_reference_date,
  )?.capacity_reference_date;
  const calendarRoutes = useMemo(
    () =>
      calendarCapacity && calendarFlows ? dailyCapacitySeries(calendarCapacity, calendarFlows) : [],
    [calendarCapacity, calendarFlows],
  );

  const heatMonths = useMemo(() => {
    if (heatmapFromISO && heatmapToISO) return monthBucketsBetween(heatmapFromISO, heatmapToISO);
    const today = new Date();
    const y = today.getUTCMonth() >= 9 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    return monthBucketsBetween(`${y}-10-01`, `${y + 1}-10-01`);
  }, [heatmapFromISO, heatmapToISO]);

  const todayISO = new Date().toISOString().slice(0, 10);
  const bookedPct =
    aggregate.technical_mcm != null && aggregate.technical_mcm > 0 && aggregate.booked_mcm != null
      ? (aggregate.booked_mcm / aggregate.technical_mcm) * 100
      : null;
  const usedPct =
    aggregate.technical_mcm != null && aggregate.technical_mcm > 0 && aggregate.used_mcm != null
      ? (aggregate.used_mcm / aggregate.technical_mcm) * 100
      : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryKpi
          label="Technical capacity"
          value={fmtMaybeMcm(aggregate.technical_mcm)}
          unit="mcm/d"
          tone="muted"
          hint={`${aggregate.hint} Capacity reference: ${
            capacityReferenceDate ? fmtShortDateYear(capacityReferenceDate) : "N/A"
          }.`}
        />
        <SummaryKpi
          label="Booked"
          value={fmtMaybeMcm(aggregate.booked_mcm)}
          unit="mcm/d"
          tone="accent"
          hint={
            bookedPct == null
              ? "Aggregate firm booked capacity: N/A"
              : `${fmtPct(bookedPct)} of technical. ${aggregate.hint}`
          }
        />
        <SummaryKpi
          label="Used (physical flow)"
          value={fmtMaybeMcm(aggregate.used_mcm)}
          unit="mcm/d"
          tone="primary"
          hint={
            usedPct == null
              ? "Measured physical flow: N/A"
              : `${fmtPct(usedPct)} of technical. Latest flow date: ${
                  referenceDate ? fmtShortDateYear(referenceDate) : "N/A"
                }.`
          }
        />
      </div>

      <ChartCard
        title="Capacity vs flow — by route"
        subtitle="Technical · aggregate firm booked · physically used, mcm/d"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={routes.map((r) => ({
              ...r,
              label: r.label,
              available: r.technical_mcm,
              booked: r.booked_mcm,
              used: r.used_mcm,
            }))}
            layout="vertical"
            margin={{ top: 8, right: 24, left: 4, bottom: 8 }}
            barCategoryGap={14}
          >
            <CartesianGrid stroke={PALETTE.grid} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10 }}
              stroke={PALETTE.axis}
              tickFormatter={(v) => fmtMcm(v)}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={260}
              tick={{ fontSize: 11 }}
              stroke={PALETTE.axis}
            />
            <Tooltip content={<CapacityRouteTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              dataKey="available"
              name="Technical"
              fill="oklch(0.92 0.02 240)"
              isAnimationActive={false}
            />
            <Bar dataKey="booked" name="Booked" fill={PALETTE.bgImport} isAnimationActive={false} />
            <Bar dataKey="used" name="Used" fill={PALETTE.kalotina} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      {calendarRoutes.length > 0 && (
        <div className="space-y-3">
          <div className="rounded-md border bg-card p-3 shadow-sm">
            <h3 className="text-sm font-semibold">2026 interconnection capacity stacks</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Daily ENTSOG capacity, Jan 01-Dec 31 2026. Bars stack booked plus available capacity
              to technical capacity; the green line is physical flow where measured data exists.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {calendarRoutes.map((route) => (
              <CalendarCapacityStackCard key={route.key} route={route} />
            ))}
          </div>
        </div>
      )}

      <div className="rounded-md border bg-card p-3 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h3 className="text-sm font-semibold">Utilisation heatmap</h3>
            <p className="text-xs text-muted-foreground">
              Used / technical capacity, monthly average · {heatMonths[0]?.label} to{" "}
              {heatMonths[heatMonths.length - 1]?.label}. Months without physical-flow data are
              shown blank.
            </p>
          </div>
          <HeatLegend />
        </div>
        <div className="overflow-x-auto">
          <div
            className="grid gap-[2px]"
            style={{
              gridTemplateColumns: `260px repeat(${heatMonths.length}, minmax(40px, 1fr))`,
            }}
          >
            <div />
            {heatMonths.map((m) => (
              <div
                key={m.key}
                className="pb-1 text-center text-[10px] tabular-nums text-muted-foreground"
              >
                {m.label}
              </div>
            ))}
            {heatmapRoutes.map((r) => (
              <RouteHeatRow key={r.key} route={r} months={heatMonths} todayISO={todayISO} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CapacityRouteTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: CapacityRouteSummary }>;
}) {
  const route = active ? payload?.[0]?.payload : undefined;
  if (!route) return null;
  return (
    <div className="max-w-sm rounded-md border bg-white p-3 text-xs shadow">
      <div className="font-semibold">{route.label}</div>
      <div className="mt-1 text-muted-foreground">
        {route.route.borderPoint} · {route.route.direction}
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <span>Technical capacity</span>
        <span className="tabular-nums">{fmtMaybeMcm(route.technical_mcm)} mcm/d</span>
        <span>Aggregate booked capacity</span>
        <span className="tabular-nums">{fmtMaybeMcm(route.booked_mcm)} mcm/d</span>
        <span>Physical flow</span>
        <span className="tabular-nums">{fmtMaybeMcm(route.used_mcm)} mcm/d</span>
        <span>Capacity source</span>
        <span>{sourceLabel(route)}</span>
        <span>Capacity reference date</span>
        <span>
          {route.capacity_reference_date ? fmtShortDateYear(route.capacity_reference_date) : "N/A"}
        </span>
        <span>Source publication date</span>
        <span>
          {route.capacity_source_date ? fmtShortDateYear(route.capacity_source_date) : "N/A"}
        </span>
        <span>Flow reference date</span>
        <span>
          {route.flow_reference_date ? fmtShortDateYear(route.flow_reference_date) : "N/A"}
        </span>
      </div>
      {route.is_proxy && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
          Counterparty-side proxy; no direct Gastrans publication used.
        </div>
      )}
      {route.is_carried_forward && route.capacity_source_date && (
        <div className="mt-1 text-muted-foreground">
          Capacity as of {fmtShortDateYear(route.capacity_source_date)}.
        </div>
      )}
      {route.warning && <div className="mt-1 text-amber-800">{route.warning}</div>}
    </div>
  );
}

function sourceLabel(route: CapacityRouteSummary) {
  if (route.data_status === "unavailable") return "Unavailable";
  if (route.is_proxy) return "Counterparty proxy";
  if (route.data_status === "cached") return "Cached";
  if (route.data_status === "historical") return "Historical";
  if (route.source === "ENTSOG") return "Live ENTSOG";
  return route.source ?? "N/A";
}

function CalendarCapacityStackCard({ route }: { route: CalendarRouteSeries }) {
  const tickInterval = Math.max(0, Math.floor(route.data.length / 9));
  return (
    <ChartCard title={route.label} subtitle="mcm/d" height={300}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={route.data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid stroke={PALETTE.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            stroke={PALETTE.axis}
            interval={tickInterval}
            tickFormatter={(v) => String(v).slice(5)}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            stroke={PALETTE.axis}
            width={42}
            tickFormatter={(v) => fmtMcm(Number(v))}
          />
          <Tooltip
            labelFormatter={(v) => String(v)}
            formatter={(v, n) => {
              const label =
                n === "booked_mcm"
                  ? "Booked"
                  : n === "available_mcm"
                    ? "Available"
                    : n === "technical_mcm"
                      ? "Technical"
                      : "Physical flow";
              return [typeof v === "number" ? `${fmtMcm(v)} mcm/d` : "N/A", label];
            }}
            contentStyle={{ fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Bar
            dataKey="booked_mcm"
            name="Booked"
            stackId="capacity"
            fill={PALETTE.bgImport}
            isAnimationActive={false}
          />
          <Bar
            dataKey="available_mcm"
            name="Available"
            stackId="capacity"
            fill="oklch(0.91 0.02 240)"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="technical_mcm"
            name="Technical"
            stroke="oklch(0.35 0.03 245)"
            strokeWidth={1.8}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="flow_mcm"
            name="Physical flow"
            stroke={PALETTE.kalotina}
            strokeWidth={2.2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function SummaryKpi({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  hint?: string;
  tone: "muted" | "primary" | "accent";
}) {
  const ring =
    tone === "primary"
      ? "border-emerald-300 bg-emerald-50/50"
      : tone === "accent"
        ? "border-sky-300 bg-sky-50/50"
        : "border-border bg-card";
  return (
    <div className={`rounded-md border p-3 shadow-sm ${ring}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{unit}</div>
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function RouteHeatRow({
  route,
  months,
  todayISO,
}: {
  route: CapacityRouteSummary;
  months: { key: string; label: string }[];
  todayISO: string;
}) {
  const byMonth = new Map<string, { sum: number; n: number; usedSum: number }>();
  for (const p of route.perDate) {
    if (p.util_pct == null || p.used_mcm == null || p.used_mcm <= 0) continue;
    const k = p.date.slice(0, 7);
    const slot = byMonth.get(k) ?? { sum: 0, n: 0, usedSum: 0 };
    slot.sum += p.util_pct;
    slot.usedSum += p.used_mcm;
    slot.n += 1;
    byMonth.set(k, slot);
  }
  const todayMonth = todayISO.slice(0, 7);

  return (
    <>
      <div className="flex items-center pr-2 text-[11px] leading-tight">
        <span className="truncate" title={route.label}>
          {route.label}
        </span>
      </div>
      {months.map((m) => {
        const slot = byMonth.get(m.key);
        const hasData = !!slot && slot.n > 0;
        const pct = hasData ? slot.sum / slot.n : null;
        const avgUsed = hasData ? slot.usedSum / slot.n : null;
        const isFuture = m.key > todayMonth;
        return (
          <div
            key={m.key}
            className="h-7 rounded-[3px]"
            style={{
              background: hasData ? heatColor(pct) : "oklch(0.97 0.005 240)",
              opacity: !hasData && isFuture ? 0.4 : 1,
            }}
            title={
              hasData
                ? `${route.label} · ${m.label}: ${fmtMaybePct(pct)} avg (${fmtMaybeMcm(avgUsed)} mcm/d avg, ${slot.n} days)`
                : `${route.label} · ${m.label}: no flow data`
            }
          />
        );
      })}
    </>
  );
}

function HeatLegend() {
  const stops = [0, 25, 50, 75, 100, 120];
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground">0%</span>
      <div className="flex h-3 w-40 overflow-hidden rounded-sm">
        {stops.map((s, i) => (
          <div key={i} className="flex-1" style={{ background: heatColor(s) }} />
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground">120%</span>
    </div>
  );
}
