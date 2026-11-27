import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StoredForecast } from "@/lib/data/arbitrage.functions";
import type { DriverContribution } from "@/lib/gas/arb/forecast";
import type { SpreadRow } from "@/lib/gas/arb/history";
import type { MonthOutlook } from "@/lib/gas/arb/monthly";
import { daysBetween, mean } from "@/lib/gas/arb/series";
import { cn } from "@/lib/utils";
import { n2, pct, sgn, toneOf } from "./format";
import { TARGET_LABEL, type ForecastBundle, type OpenProb, type Target } from "./labels";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const tip = { fontSize: 12, borderRadius: 8 };
const MODEL_COLOR: Record<string, string> = {
  naive: "var(--muted-foreground)",
  meanrev: "var(--chart-2)",
  trend: "var(--chart-3)",
  fundamental: "var(--chart-5)",
};

const actualOf = (r: SpreadRow, t: Target) =>
  t === "spread" ? r.spread : t === "BGH" ? r.bgh : r.ceegex;

export function ForecastChart({
  bundle,
  rows,
  showModels,
}: {
  bundle: ForecastBundle;
  rows: SpreadRow[];
  showModels: boolean;
}) {
  const data = useMemo(() => {
    const hist = rows.slice(-60).map((r) => ({ date: r.date, actual: actualOf(r, bundle.target) }));
    const fut = bundle.result.ensemble.map((p, k) => {
      const row: Record<string, number | string | [number, number]> = {
        date: p.date,
        p50: p.p50,
        band: [p.lo, p.hi],
      };
      for (const m of bundle.result.models) if (m.status === "ok") row[m.id] = m.path[k].p50;
      return row;
    });
    // Join the forecast to the last actual so the lines connect.
    const last = hist[hist.length - 1];
    if (last && fut.length)
      Object.assign(last, { p50: last.actual, band: [last.actual, last.actual] });
    return [...hist, ...fut];
  }, [bundle, rows]);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={AXIS} minTickGap={30} />
        <YAxis tick={AXIS} width={44} domain={["auto", "auto"]} />
        <Tooltip
          contentStyle={tip}
          formatter={(v: number | [number, number]) =>
            Array.isArray(v)
              ? `${v[0].toFixed(2)} – ${v[1].toFixed(2)}`
              : Number.isFinite(v)
                ? v.toFixed(2)
                : "—"
          }
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {bundle.target === "spread" && (
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
        )}
        <Area
          dataKey="band"
          name="80% band"
          stroke="none"
          fill="var(--chart-1)"
          fillOpacity={0.15}
        />
        <Line
          dataKey="actual"
          name="Actual"
          stroke="var(--foreground)"
          dot={false}
          strokeWidth={1.4}
        />
        <Line dataKey="p50" name="Ensemble" stroke="var(--chart-1)" dot={false} strokeWidth={2} />
        {showModels &&
          bundle.result.models
            .filter((m) => m.status === "ok")
            .map((m) => (
              <Line
                key={m.id}
                dataKey={m.id}
                name={m.label}
                stroke={MODEL_COLOR[m.id]}
                strokeDasharray="4 3"
                dot={false}
                strokeWidth={1}
              />
            ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function OpenWindowTable({ probs }: { probs: OpenProb[] }) {
  if (!probs.length) return null;
  const cellTone = (p: number | null) =>
    p === null
      ? ""
      : p >= 0.7
        ? "bg-emerald-500/15 font-semibold"
        : p >= 0.4
          ? "bg-amber-500/10"
          : "";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="px-2 py-1 text-left font-medium">Delivery day</th>
            <th className="px-2 py-1 text-right font-medium">Spread p50</th>
            <th className="px-2 py-1 text-right font-medium">80% band</th>
            <th className="px-2 py-1 text-right font-medium">BG→HU cost</th>
            <th className="px-2 py-1 text-right font-medium">P(BG→HU open)</th>
            <th className="px-2 py-1 text-right font-medium">HU→BG cost</th>
            <th className="px-2 py-1 text-right font-medium">P(HU→BG open)</th>
          </tr>
        </thead>
        <tbody>
          {probs.map((p) => (
            <tr key={p.date} className="border-b last:border-0">
              <td className="px-2 py-1">{p.date}</td>
              <td className={cn("px-2 py-1 text-right tabular-nums", toneOf(p.spread.p50))}>
                {sgn(p.spread.p50)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                {n2(p.spread.lo)} … {n2(p.spread.hi)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{n2(p.costBgHu)}</td>
              <td className={cn("px-2 py-1 text-right tabular-nums", cellTone(p.pBgHu))}>
                {pct(p.pBgHu)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{n2(p.costHuBg)}</td>
              <td className={cn("px-2 py-1 text-right tabular-nums", cellTone(p.pHuBg))}>
                {pct(p.pHuBg)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Probability that the spread clears transport cost at reserve prices, from the ensemble's 80%
        band (normal errors assumed). Auction premiums and capacity availability come on top.
      </p>
    </div>
  );
}

export function ScoreTable({ bundle }: { bundle: ForecastBundle }) {
  const steps = [0, 6, 13].filter((k) => k < (bundle.result.scores[0]?.mae.length ?? 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="px-2 py-1 text-left font-medium">Model</th>
            {steps.map((k) => (
              <th key={k} className="px-2 py-1 text-right font-medium">
                MAE {k + 1}d
              </th>
            ))}
            {steps.map((k) => (
              <th key={`s${k}`} className="px-2 py-1 text-right font-medium">
                Skill {k + 1}d
              </th>
            ))}
            <th className="px-2 py-1 text-right font-medium">Direction hit</th>
            <th className="px-2 py-1 text-right font-medium">Weight 1d</th>
          </tr>
        </thead>
        <tbody>
          {bundle.result.scores.map((s) => (
            <tr
              key={s.id}
              className={cn("border-b last:border-0", s.id === "ensemble" && "font-semibold")}
            >
              <td className="px-2 py-1">{s.label}</td>
              {steps.map((k) => (
                <td key={k} className="px-2 py-1 text-right tabular-nums">
                  {n2(s.mae[k])}
                </td>
              ))}
              {steps.map((k) => (
                <td
                  key={`s${k}`}
                  className={cn("px-2 py-1 text-right tabular-nums", toneOf(s.skill[k]))}
                >
                  {s.id === "naive" ? "—" : pct(s.skill[k])}
                </td>
              ))}
              <td className="px-2 py-1 text-right tabular-nums">{pct(s.hitRate)}</td>
              <td className="px-2 py-1 text-right tabular-nums">
                {s.id === "ensemble" ? "—" : pct(bundle.result.weights[s.id]?.[0])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Rolling-origin backtest over the last 60 days (each forecast uses only data before its
        origin; the fundamentals model sees realised weather). Skill &gt; 0 beats the random walk.
        Band:{" "}
        {bundle.result.bandSource === "empirical"
          ? "from the ensemble's own backtest errors"
          : "model-based"}
        .
      </p>
    </div>
  );
}

export function ModelNotes({ bundle }: { bundle: ForecastBundle }) {
  return (
    <ul className="space-y-1 text-xs">
      {bundle.result.models.map((m) => (
        <li key={m.id}>
          <span className={cn("font-semibold", m.status !== "ok" && "text-muted-foreground")}>
            {m.label}:
          </span>{" "}
          <span className={m.status !== "ok" ? "text-amber-700" : "text-muted-foreground"}>
            {m.note}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DriversPanel({ bundle }: { bundle: ForecastBundle }) {
  const fm = bundle.result.models.find((m) => m.id === "fundamental") as
    (ForecastBundle["result"]["models"][number] & { contrib?: DriverContribution[] }) | undefined;
  const contrib = fm?.contrib ?? [];
  const max = Math.max(1e-9, ...contrib.map((c) => Math.abs(c.contribution)));
  return (
    <div className="space-y-3 text-xs">
      {contrib.length ? (
        <div className="space-y-1">
          {contrib.map((c) => (
            <div key={c.name} className="grid grid-cols-[150px_1fr_70px] items-center gap-2">
              <span
                className="truncate"
                title={`coefficient ${c.coef.toFixed(3)}, latest ${c.latest.toFixed(2)}`}
              >
                {c.name}
              </span>
              <div className="relative h-3 rounded bg-muted">
                <div
                  className={cn(
                    "absolute top-0 h-3 rounded",
                    c.contribution >= 0 ? "bg-emerald-500/70" : "bg-rose-500/70",
                  )}
                  style={{
                    left:
                      c.contribution >= 0
                        ? "50%"
                        : `${50 - (Math.abs(c.contribution) / max) * 50}%`,
                    width: `${(Math.abs(c.contribution) / max) * 50}%`,
                  }}
                />
                <div className="absolute top-0 left-1/2 h-3 w-px bg-border" />
              </div>
              <span className={cn("text-right tabular-nums", toneOf(c.contribution))}>
                {sgn(c.contribution)}
              </span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Push of each driver on today's fitted value versus its average level (€/MWh). Green
            raises {bundle.target === "spread" ? "the spread (favours BG→HU)" : "the price"}.
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground">
          Fundamentals model not running — see the notes below.
        </p>
      )}
      <ul className="space-y-0.5">
        {bundle.report.map((r) => (
          <li key={r.name} className={r.used ? "" : "text-muted-foreground"}>
            {r.used ? "✓" : "✗"} {r.name} — {r.used ? `coverage ${pct(r.coverage)}` : r.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TechnicalPanel({ bundle }: { bundle: ForecastBundle }) {
  if (!bundle.signals.length)
    return (
      <p className="text-xs text-muted-foreground">
        Needs 30 observations for technical indicators.
      </p>
    );
  const tone = {
    up: "text-emerald-600",
    down: "text-rose-600",
    neutral: "text-muted-foreground",
  } as const;
  const arrow = { up: "▲", down: "▼", neutral: "●" } as const;
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Technical read:</span>
        <span className={cn("font-semibold", toneOf(bundle.score))}>
          {bundle.score > 0.25 ? "Bullish" : bundle.score < -0.25 ? "Bearish" : "Mixed"} (
          {sgn(bundle.score)})
        </span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {bundle.signals.map((s) => (
            <tr key={s.name} className="border-b last:border-0">
              <td className="py-1 pr-2">{s.name}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{s.value}</td>
              <td className={cn("py-1 pr-2", tone[s.bias])}>{arrow[s.bias]}</td>
              <td className="py-1 text-muted-foreground">{s.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground">
        Indicators describe momentum and stretch; they are context for the models, not a forecast on
        their own.
      </p>
    </div>
  );
}

export function MonthlyOutlookTable({ outlook, note }: { outlook: MonthOutlook[]; note: string }) {
  if (!outlook.length) return <p className="text-xs text-muted-foreground">{note}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="px-2 py-1 text-left font-medium">Month</th>
            <th className="px-2 py-1 text-right font-medium">Spread p50</th>
            <th className="px-2 py-1 text-right font-medium">80% band</th>
            <th className="px-2 py-1 text-right font-medium">Seasonal norm</th>
            <th className="px-2 py-1 text-right font-medium">Years</th>
            <th className="px-2 py-1 text-right font-medium">Hist. BG→HU open</th>
            <th className="px-2 py-1 text-right font-medium">Forward spread</th>
          </tr>
        </thead>
        <tbody>
          {outlook.map((o) => (
            <tr key={o.month} className="border-b last:border-0">
              <td className="px-2 py-1">{o.month}</td>
              <td className={cn("px-2 py-1 text-right tabular-nums font-semibold", toneOf(o.p50))}>
                {sgn(o.p50)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                {n2(o.lo)} … {n2(o.hi)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{sgn(o.seasonal)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{o.years}</td>
              <td className="px-2 py-1 text-right tabular-nums">{pct(o.histShareBgHu)}</td>
              <td className="px-2 py-1 text-right tabular-nums">
                {o.forwardSpread === null ? (
                  <span className="text-muted-foreground">import MA</span>
                ) : (
                  sgn(o.forwardSpread)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

/** Stored forecasts scored against what cleared. */
export function ShadowScorecard({ stored, rows }: { stored: StoredForecast[]; rows: SpreadRow[] }) {
  const scored = useMemo(() => {
    const actual = new Map(rows.filter((r) => !r.provisional).map((r) => [r.date, r]));
    const out: Record<string, { lead: number; err: number; inside: boolean }[]> = {};
    for (const f of stored) {
      if (f.model !== "ensemble") continue;
      const r = actual.get(f.target_date);
      if (!r) continue;
      const a = actualOf(r, f.series);
      const lead = daysBetween(f.made_on, f.target_date);
      (out[f.series] ??= []).push({ lead, err: a - f.p50, inside: a >= f.lo && a <= f.hi });
    }
    return out;
  }, [stored, rows]);
  const buckets: [string, number, number][] = [
    ["1–2 days", 1, 2],
    ["3–7 days", 3, 7],
    ["8–14 days", 8, 14],
  ];
  const any = Object.values(scored).some((x) => x.length);
  if (!any)
    return (
      <p className="text-xs text-muted-foreground">
        Forecasts are saved each day this tab is opened; live scores appear once their delivery days
        have cleared.
      </p>
    );
  return (
    <table className="w-full text-xs">
      <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
        <tr className="border-b">
          <th className="px-2 py-1 text-left font-medium">Series</th>
          {buckets.map(([l]) => (
            <th key={l} className="px-2 py-1 text-right font-medium">
              MAE {l}
            </th>
          ))}
          <th className="px-2 py-1 text-right font-medium">Bias</th>
          <th className="px-2 py-1 text-right font-medium">Inside 80% band</th>
          <th className="px-2 py-1 text-right font-medium">n</th>
        </tr>
      </thead>
      <tbody>
        {(
          Object.entries(scored) as [Target, { lead: number; err: number; inside: boolean }[]][]
        ).map(([s, xs]) => (
          <tr key={s} className="border-b last:border-0">
            <td className="px-2 py-1">{TARGET_LABEL[s]}</td>
            {buckets.map(([l, a, b]) => {
              const v = xs.filter((x) => x.lead >= a && x.lead <= b).map((x) => Math.abs(x.err));
              return (
                <td key={l} className="px-2 py-1 text-right tabular-nums">
                  {v.length ? n2(mean(v)) : "—"}
                </td>
              );
            })}
            <td className="px-2 py-1 text-right tabular-nums">{sgn(mean(xs.map((x) => x.err)))}</td>
            <td className="px-2 py-1 text-right tabular-nums">
              {pct(xs.filter((x) => x.inside).length / xs.length)}
            </td>
            <td className="px-2 py-1 text-right tabular-nums">{xs.length}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
