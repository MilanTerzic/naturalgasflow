import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CAPACITY_DEFS, CONVERSION_MCM_TO_MWH, PALETTE } from "@/lib/gas/config";
import { fmtMcm, fmtPct } from "@/lib/gas/format";
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

// Build the 12 month-buckets that span [fromISO, toISO).
function monthBucketsBetween(fromISO: string, toISO: string) {
  const from = new Date(`${fromISO}T00:00:00Z`);
  const to = new Date(`${toISO}T00:00:00Z`);
  const out: { key: string; label: string }[] = [];
  let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (d < to) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m];
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
  heatmapFromISO,
  heatmapToISO,
}: {
  capacity: CapacityRow[];
  flows: FlowRow[];
  heatmapFromISO?: string;
  heatmapToISO?: string;
}) {
  const routes = useMemo(() => summarise(capacity, flows), [capacity, flows]);

  // Annual, monthly heatmap. Default window = current gas year if not provided.
  const heatMonths = useMemo(() => {
    if (heatmapFromISO && heatmapToISO) {
      return monthBucketsBetween(heatmapFromISO, heatmapToISO);
    }
    const today = new Date();
    const y = today.getUTCMonth() >= 9 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    return monthBucketsBetween(`${y}-10-01`, `${y + 1}-10-01`);
  }, [heatmapFromISO, heatmapToISO]);

  const todayISO = new Date().toISOString().slice(0, 10);

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

      {/* Annual heatmap aggregated by month */}
      <div className="rounded-md border bg-card p-3 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h3 className="text-sm font-semibold">Utilisation heatmap</h3>
            <p className="text-xs text-muted-foreground">
              Used / technical capacity, monthly average · {heatMonths[0]?.label} → {heatMonths[heatMonths.length - 1]?.label}.
              Months without physical-flow data are shown blank.
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
                className="text-[10px] tabular-nums text-muted-foreground text-center pb-1"
              >
                {m.label}
              </div>
            ))}
            {routes.map((r) => (
              <RouteHeatRow key={r.key} route={r} months={heatMonths} todayISO={todayISO} />
            ))}
          </div>
        </div>
      </div>
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
  months,
  todayISO,
}: {
  route: RouteSummary;
  months: { key: string; label: string }[];
  todayISO: string;
}) {
  // Group per-date utilisation into month buckets (mean of util_pct across the
  // days we have data for). Months with zero observed days render blank.
  const byMonth = new Map<string, { sum: number; n: number; usedSum: number }>();
  for (const p of route.perDate) {
    const k = p.date.slice(0, 7); // YYYY-MM
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
        const pct = hasData ? slot!.sum / slot!.n : 0;
        const avgUsed = hasData ? slot!.usedSum / slot!.n : 0;
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
                ? `${route.label} · ${m.label}: ${fmtPct(pct)} avg (${fmtMcm(avgUsed)} mcm/d avg, ${slot!.n} days)`
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
