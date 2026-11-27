import { Fragment, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RouteResult } from "@/lib/gas/arbitrage";
import { monthlyGrid, windowStats, type SpreadRow } from "@/lib/gas/arb/history";
import { CRISIS, addDays } from "@/lib/gas/arb/series";
import { RANGES, inRange, n2, pct, sgn, toneOf } from "./format";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  VERIFIED: "text-emerald-600",
  ESTIMATED: "text-amber-600",
  STALE: "text-amber-600",
  UNAVAILABLE: "text-muted-foreground",
};

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const tip = { fontSize: 12, borderRadius: 8 };

export function RouteEconomics({ routes }: { routes: RouteResult[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const th = "px-2 py-1.5 text-right font-medium";
  const td = "px-2 py-1.5 text-right tabular-nums";
  const day = routes[0]?.deliveryDay;
  return (
    <section className="rounded-lg border bg-card p-3 shadow-sm sm:p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Route economics · delivery day {day}</h3>
        <p className="text-xs text-muted-foreground">
          Reserve-price daily firm capacity, EUR/MWh. Capacity availability is not checked —
          indicative. Click a route for the cost legs.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b">
              <th className="px-2 py-1.5 text-left font-medium">Route</th>
              <th className={th}>Origin</th>
              <th className={th}>Dest.</th>
              <th className={th}>Gross</th>
              <th className={th}>Capacity</th>
              <th className={th}>Fuel</th>
              <th className={th}>Fees</th>
              <th className={th}>Transport</th>
              <th className={th}>Delivered</th>
              <th className={th}>Net</th>
              <th
                className={th}
                title="Largest auction premium on top of reserve prices that still breaks even"
              >
                Max premium
              </th>
              <th className="px-2 py-1.5 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <Fragment key={r.route.id}>
                <tr
                  className="cursor-pointer border-b hover:bg-accent/40"
                  onClick={() => setOpen(open === r.route.id ? null : r.route.id)}
                >
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1">
                      {open === r.route.id ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      {r.route.short}
                    </span>
                  </td>
                  <td className={td}>
                    {n2(r.origin?.price)}
                    {r.origin && !r.origin.final && (
                      <span className="ml-0.5 text-[9px] text-muted-foreground">p</span>
                    )}
                  </td>
                  <td className={td}>{r.route.destination ? n2(r.destination?.price) : "—"}</td>
                  <td className={cn(td, toneOf(r.gross))}>{sgn(r.gross)}</td>
                  <td className={td}>{n2(r.capacityCost)}</td>
                  <td className={td}>{n2(r.fuelCost)}</td>
                  <td className={td}>{n2(r.otherFees)}</td>
                  <td className={cn(td, "font-semibold")}>{n2(r.transportCost)}</td>
                  <td className={td}>{n2(r.delivered)}</td>
                  <td className={cn(td, "font-semibold", toneOf(r.netMargin))}>
                    {sgn(r.netMargin)}
                  </td>
                  <td className={td}>
                    {r.maxPremium !== null && r.maxPremium > 0 ? n2(r.maxPremium) : "—"}
                  </td>
                  <td className={cn("px-2 py-1.5 text-[10px]", STATUS_TONE[r.status])}>
                    {r.status}
                  </td>
                </tr>
                {open === r.route.id && (
                  <tr className="border-b bg-muted/30">
                    <td colSpan={12} className="px-6 py-2">
                      <table className="w-full text-[11px]">
                        <tbody>
                          {r.legs.map((l, i) => (
                            <tr key={i}>
                              <td className="py-0.5 pr-2">{l.operator}</td>
                              <td className="py-0.5 pr-2">{l.label}</td>
                              <td className="py-0.5 pr-2 text-right tabular-nums">
                                {n2(l.eurPerMwh)}
                              </td>
                              <td className="py-0.5 pr-2 text-muted-foreground">{l.working}</td>
                              <td className={cn("py-0.5", STATUS_TONE[l.status])}>{l.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {r.route.note && (
                        <p className="mt-1 text-[11px] text-amber-700">{r.route.note}</p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RangePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs">
      {RANGES.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onChange(r.id)}
          className={cn(
            "rounded px-2 py-0.5",
            value === r.id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function crisisArea(rows: SpreadRow[]) {
  if (!rows.length) return null;
  const a = rows[0].date > CRISIS.from ? rows[0].date : CRISIS.from;
  const b = rows[rows.length - 1].date < CRISIS.to ? rows[rows.length - 1].date : CRISIS.to;
  if (a > b) return null;
  return (
    <ReferenceArea
      x1={a}
      x2={b}
      fill="var(--status-warning)"
      fillOpacity={0.07}
      label={{
        value: "crisis regime",
        position: "insideTop",
        fontSize: 10,
        fill: "var(--muted-foreground)",
      }}
    />
  );
}

export function SpreadHistoryChart({ rows, range }: { rows: SpreadRow[]; range: string }) {
  const data = useMemo(
    () =>
      inRange(rows, range).map((r) => ({
        date: r.date,
        spread: r.spread,
        beBgHu: r.costBgHu,
        beHuBg: r.costHuBg === null ? null : -r.costHuBg,
      })),
    [rows, range],
  );
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={AXIS} minTickGap={40} />
        <YAxis tick={AXIS} width={44} unit="" />
        <Tooltip
          contentStyle={tip}
          formatter={(v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—")}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {crisisArea(inRange(rows, range))}
        <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
        <Line
          dataKey="spread"
          name="CEEGEX − BGH"
          stroke="var(--chart-1)"
          dot={false}
          strokeWidth={1.6}
        />
        <Line
          dataKey="beBgHu"
          name="BG→HU break-even"
          stroke="var(--chart-2)"
          strokeDasharray="5 4"
          dot={false}
          strokeWidth={1.2}
        />
        <Line
          dataKey="beHuBg"
          name="HU→BG break-even (−)"
          stroke="var(--chart-3)"
          strokeDasharray="5 4"
          dot={false}
          strokeWidth={1.2}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function BasisChart({ rows, range }: { rows: SpreadRow[]; range: string }) {
  const data = useMemo(
    () =>
      inRange(rows, range).map((r) => ({
        date: r.date,
        bgh: r.ttf === null ? null : r.bgh - r.ttf,
        ceegex: r.ttf === null ? null : r.ceegex - r.ttf,
        cegh: r.ttf === null || r.cegh === null ? null : r.cegh - r.ttf,
      })),
    [rows, range],
  );
  const any = data.some((d) => d.bgh !== null);
  if (!any)
    return (
      <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No TTF on the same days yet — import TTF history to see each hub's basis.
      </p>
    );
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={AXIS} minTickGap={40} />
        <YAxis tick={AXIS} width={44} />
        <Tooltip
          contentStyle={tip}
          formatter={(v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—")}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
        <Line
          dataKey="bgh"
          name="BGH − TTF"
          stroke="var(--chart-3)"
          dot={false}
          connectNulls={false}
        />
        <Line
          dataKey="ceegex"
          name="CEEGEX − TTF"
          stroke="var(--chart-1)"
          dot={false}
          connectNulls={false}
        />
        <Line
          dataKey="cegh"
          name="CEGH − TTF"
          stroke="var(--chart-4)"
          dot={false}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function WindowGrid({ rows }: { rows: SpreadRow[] }) {
  const [dir, setDir] = useState<"bgHu" | "huBg">("bgHu");
  const grid = useMemo(() => monthlyGrid(rows), [rows]);
  const years = [...new Set(grid.map((g) => g.month.slice(0, 4)))];
  const cell = (y: string, m: number) =>
    grid.find((g) => g.month === `${y}-${String(m + 1).padStart(2, "0")}`);
  const stats = (from: string) => windowStats(rows.filter((r) => r.date >= from));
  const last = rows[rows.length - 1]?.date;
  return (
    <section className="rounded-lg border bg-card p-3 shadow-sm sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">How often the window is open</h3>
          <p className="text-xs text-muted-foreground">
            Share of delivery days with a positive net margin after transport, by month. Days before
            the current gas year are costed with today's tariffs (approximation).
          </p>
        </div>
        <div className="inline-flex rounded-md border p-0.5 text-xs">
          {(["bgHu", "huBg"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDir(d)}
              className={cn(
                "rounded px-2 py-0.5",
                dir === d ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              {d === "bgHu" ? "BG → HU" : "HU → BG"}
            </button>
          ))}
        </div>
      </div>
      {last && (
        <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {[
            ["Last 30 days", addDays(last, -30)],
            ["Last 90 days", addDays(last, -90)],
            ["Last 365 days", addDays(last, -365)],
            ["All history", "0000"],
          ].map(([label, from]) => {
            const s = stats(from);
            const share = dir === "bgHu" ? s.shareBgHu : s.shareHuBg;
            const avg = dir === "bgHu" ? s.avgOpenBgHu : s.avgOpenHuBg;
            const streak = dir === "bgHu" ? s.longestStreakBgHu : s.longestStreakHuBg;
            return (
              <div key={label} className="rounded-md border px-2 py-1.5">
                <div className="text-muted-foreground">{label}</div>
                <div className="text-base font-semibold tabular-nums">{pct(share)}</div>
                <div className="text-[11px] text-muted-foreground">
                  {s.days} days · avg net when open {n2(avg)} · longest run {streak}d
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="text-[11px]">
          <thead>
            <tr>
              <th className="px-1.5 py-1 text-left font-medium text-muted-foreground">Year</th>
              {MONTHS.map((m) => (
                <th
                  key={m}
                  className="w-12 px-1 py-1 text-center font-medium text-muted-foreground"
                >
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <td className="px-1.5 py-0.5 font-medium">{y}</td>
                {MONTHS.map((_, m) => {
                  const c = cell(y, m);
                  const share = c ? (dir === "bgHu" ? c.shareBgHu : c.shareHuBg) : null;
                  return (
                    <td key={m} className="px-0.5 py-0.5">
                      <div
                        title={
                          c
                            ? `${c.month}: open ${pct(share)} of ${c.days} days · mean spread ${n2(c.meanSpread)}`
                            : "no data"
                        }
                        className="rounded px-1 py-1 text-center tabular-nums"
                        style={{
                          background:
                            share === null
                              ? "transparent"
                              : `color-mix(in oklab, var(--status-good) ${Math.round(share * 85)}%, var(--muted) )`,
                          color: share !== null && share > 0.55 ? "white" : undefined,
                        }}
                      >
                        {share === null ? "·" : pct(share)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
