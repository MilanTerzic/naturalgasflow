import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CAPACITY_DEFS, CONVERSION_MCM_TO_MWH, PALETTE } from "@/lib/gas/config";
import { fmtMcm, fmtPct, fmtShortDate } from "@/lib/gas/format";
import type { CapacityRow, FlowRow } from "@/lib/gas/types";
import type { FlowPoint } from "@/lib/gas/config";
import { ChartCard } from "./ChartCard";

// Map a capacity route to the ENTSOG flow key that physically corresponds to it.
function flowKeyFor(d: (typeof CAPACITY_DEFS)[number]): FlowPoint | null {
  const bp = d.borderPoint.toLowerCase();
  if (bp.includes("kiskundorozsma 2")) return "kiskundorozsma_2";
  if (bp.includes("kiskundorozsma")) return "kiskundorozsma_hu";
  if (bp.includes("kireevo") || bp.includes("zaychar")) return "kireevo";
  if (bp.includes("kalotina")) return "kalotina";
  return null;
}

function routeLabel(d: (typeof CAPACITY_DEFS)[number]) {
  const point = d.borderPoint.split("/")[0].trim();
  return `${d.tso} · ${point} (${d.direction})`;
}

// All values below are in mcm/day so capacity and physical flow share one unit
// (flows arrive in mcm/d; capacity is stored in MWh/d and converted via
// CONVERSION_MCM_TO_MWH).  Used capacity is clamped to technical capacity so
// rounding / unit slack can never make the bar exceed 100 %.
interface RouteSummary {
  key: string;
  label: string;
  tso: string;
  available_mcm: number; // technical capacity
  booked_mcm: number; // booked across all products (max — never exceeds technical)
  used_mcm: number; // physical flow on latest date (clamped to technical)
  used_raw_mcm: number; // unclamped, for tooltips
  utilisation_booked: number; // booked / available
  utilisation_used: number; // used / available
  flowKey: FlowPoint | null;
  perDate: { date: string; used_mcm: number; util_pct: number }[];
}

function summarise(capacity: CapacityRow[], flows: FlowRow[]): RouteSummary[] {
  // Latest flow date that has data.
  const sortedFlows = [...flows].sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = sortedFlows.find(
    (f) => f.kireevo > 0 || f.kalotina > 0 || f.kiskundorozsma_hu > 0,
  );

  return CAPACITY_DEFS.map((d) => {
    const matched = capacity.filter(
      (r) => r.tso === d.tso && r.border_point === d.borderPoint && r.direction === d.direction,
    );
    // Collapse across products (daily / monthly / quarterly).  Offered =
    // technical capacity → take the max.  Booked → take the max across all
    // products (worst-case commitment); summing would double-count overlapping
    // products that all reserve the same pipe.  Convert MWh/d → mcm/d so we
    // can compare against physical flow directly.
    const availableMwh = matched.reduce((m, r) => Math.max(m, r.offered_mwh), 0);
    const bookedMwh = matched.reduce((m, r) => Math.max(m, r.booked_mwh), 0);
    const available = availableMwh / CONVERSION_MCM_TO_MWH;
    // Booked can never physically exceed technical.
    const booked = Math.min(bookedMwh / CONVERSION_MCM_TO_MWH, available);

    const flowKey = flowKeyFor(d);
    const usedRaw = flowKey && latest ? latest[flowKey] ?? 0 : 0;
    // Clamp physical flow to technical capacity for chart geometry —
    // measurement / rounding noise occasionally pushes flow a hair past 100 %.
    const used = available > 0 ? Math.min(usedRaw, available) : usedRaw;

    const perDate = flows.map((f) => {
      const u = flowKey ? f[flowKey] ?? 0 : 0;
      return {
        date: f.date,
        used_mcm: u,
        util_pct: available > 0 ? Math.min((u / available) * 100, 120) : 0,
      };
    });

    return {
      key: `${d.tso}|${d.borderPoint}|${d.direction}`,
      label: routeLabel(d),
      tso: d.tso,
      available_mcm: available,
      booked_mcm: booked,
      used_mcm: used,
      used_raw_mcm: usedRaw,
      utilisation_booked: available > 0 ? (booked / available) * 100 : 0,
      utilisation_used: available > 0 ? (usedRaw / available) * 100 : 0,
      flowKey,
      perDate,
    };
  });
}

// Color ramp 0–120% utilisation: cool → warm → hot.
function heatColor(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "oklch(0.96 0.01 240)";
  const p = Math.min(pct, 120) / 120;
  // Interpolate hue from 220 (blue) → 30 (orange) → 15 (red).
  const hue = 220 - 205 * p;
  const chroma = 0.05 + 0.15 * p;
  const light = 0.92 - 0.45 * p;
  return `oklch(${light.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`;
}

export function CapacityCharts({
  capacity,
  flows,
}: {
  capacity: CapacityRow[];
  flows: FlowRow[];
}) {
  const routes = useMemo(() => summarise(capacity, flows), [capacity, flows]);

  // Heatmap: limit to a sensible window — last 21 historical days.
  const heatDates = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const all = Array.from(new Set(flows.map((f) => f.date))).sort();
    return all.filter((d) => d <= today).slice(-21);
  }, [flows]);

  const totalAvailable = routes.reduce((s, r) => s + r.available_mcm, 0);
  const totalBooked = routes.reduce((s, r) => s + r.booked_mcm, 0);
  const totalUsed = routes.reduce((s, r) => s + r.used_mcm, 0);

  return (
    <div className="space-y-4">
      {/* Aggregate KPI strip */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryKpi
          label="Technical capacity"
          value={fmtMcm(totalAvailable)}
          unit="mcm/d"
          tone="muted"
          hint="Sum of offered capacity across all border routes."
        />
        <SummaryKpi
          label="Booked"
          value={fmtMcm(totalBooked)}
          unit="mcm/d"
          tone="accent"
          hint={`${fmtPct((totalBooked / Math.max(totalAvailable, 1)) * 100)} of technical`}
        />
        <SummaryKpi
          label="Used (physical flow)"
          value={fmtMcm(totalUsed)}
          unit="mcm/d"
          tone="primary"
          hint={`${fmtPct((totalUsed / Math.max(totalAvailable, 1)) * 100)} of technical · latest day`}
        />
      </div>

      {/* Per-route bars: available baseline with booked + used overlay */}
      <ChartCard title="Capacity vs flow — by route" subtitle="Technical · booked · physically used (latest day), mcm/d">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={routes.map((r) => ({
              label: r.label,
              available: r.available_mcm,
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
            <Tooltip
              formatter={(v) => (typeof v === "number" ? `${fmtMcm(v)} mcm/d` : "–")}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="available" name="Technical" fill="oklch(0.92 0.02 240)" isAnimationActive={false} />
            <Bar dataKey="booked" name="Booked" fill={PALETTE.bgImport} isAnimationActive={false} />
            <Bar dataKey="used" name="Used" fill={PALETTE.kalotina} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Heatmap */}
      <div className="rounded-md border bg-card p-3 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h3 className="text-sm font-semibold">Utilisation heatmap</h3>
            <p className="text-xs text-muted-foreground">
              Used / technical capacity, % · last {heatDates.length} historical days.
            </p>
          </div>
          <HeatLegend />
        </div>
        <div className="overflow-x-auto">
          <div
            className="grid gap-[2px]"
            style={{
              gridTemplateColumns: `260px repeat(${heatDates.length}, minmax(28px, 1fr))`,
            }}
          >
            <div />
            {heatDates.map((d) => (
              <div
                key={d}
                className="text-[9px] tabular-nums text-muted-foreground text-center -rotate-45 origin-bottom-left translate-y-2 h-5"
              >
                {fmtShortDate(d)}
              </div>
            ))}
            {routes.map((r) => (
              <RouteHeatRow key={r.key} route={r} dates={heatDates} />
            ))}
          </div>
        </div>
      </div>

      {/* Utilisation gauges per route */}
      <ChartCard title="Latest-day utilisation by route" subtitle="Used vs technical capacity">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={routes.map((r) => ({
              label: r.label.split("·").slice(1).join("·").trim() || r.label,
              tso: r.tso,
              // Physical flow cannot exceed technical capacity — cap at 100 %.
              util: +Math.min(r.utilisation_used, 100).toFixed(1),
            }))}
            margin={{ top: 10, right: 16, left: 4, bottom: 60 }}
          >
            <CartesianGrid stroke={PALETTE.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              stroke={PALETTE.axis}
              angle={-25}
              textAnchor="end"
              height={70}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke={PALETTE.axis}
              tickFormatter={(v) => `${v}%`}
              domain={[0, 100]}
            />
            <ReferenceLine y={100} stroke={PALETTE.demand} strokeDasharray="4 4" />
            <Tooltip
              formatter={(v) => (typeof v === "number" ? fmtPct(v) : "–")}
              contentStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="util" isAnimationActive={false}>
              {routes.map((r, i) => (
                <Cell key={i} fill={heatColor(Math.min(r.utilisation_used, 100))} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
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
  dates,
}: {
  route: RouteSummary;
  dates: string[];
}) {
  const byDate = new Map(route.perDate.map((p) => [p.date, p]));
  return (
    <>
      <div className="flex items-center pr-2 text-[11px] leading-tight">
        <span className="truncate" title={route.label}>
          {route.label}
        </span>
      </div>
      {dates.map((d) => {
        const cell = byDate.get(d);
        const pct = cell?.util_pct ?? 0;
        return (
          <div
            key={d}
            className="h-7 rounded-[3px]"
            style={{ background: heatColor(pct) }}
            title={`${route.label} · ${d}: ${fmtPct(pct)} (${fmtMcm(cell?.used_mcm ?? 0)} mcm/d)`}
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
