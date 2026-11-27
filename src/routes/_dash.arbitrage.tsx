import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { pageMetadata } from "@/lib/page-metadata";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { Switch } from "@/components/ui/switch";
import {
  BasisChart,
  RangePicker,
  RouteEconomics,
  SpreadHistoryChart,
  WindowGrid,
} from "@/components/arbitrage/HistorySections";
import { n2, pct, sgn } from "@/components/arbitrage/format";
import { ChartCard } from "@/components/dashboard/ChartCard";
import {
  DriversPanel,
  ForecastChart,
  ModelNotes,
  MonthlyOutlookTable,
  OpenWindowTable,
  ScoreTable,
  ShadowScorecard,
  TechnicalPanel,
} from "@/components/arbitrage/ForecastSections";
import { AiBrief, ImportPanel } from "@/components/arbitrage/ImportAndBrief";
import {
  HORIZON,
  TARGET_LABEL,
  useArbitrageData,
  type Target,
} from "@/components/arbitrage/useArbitrageData";
import { saveArbitrageForecast, type StoredForecast } from "@/lib/data/arbitrage.functions";
import { windowStats } from "@/lib/gas/arb/history";
import { addDays } from "@/lib/gas/arb/series";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_dash/arbitrage")({
  head: () => ({
    meta: pageMetadata(
      "HU ↔ BG Arbitrage — Serbia Gas Dashboard",
      "Hungary–Bulgaria gas arbitrage through Serbia: route economics, spread history, forecasts and signals.",
    ),
  }),
  component: ArbitragePage,
});

function Section({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ArbitragePage() {
  const [excludeCrisis, setExcludeCrisis] = useState(true);
  const [range, setRange] = useState("1y");
  const [target, setTarget] = useState<Target>("spread");
  const [showModels, setShowModels] = useState(false);
  const d = useArbitrageData({ excludeCrisis });

  const bgHu = d.routes.find((r) => r.route.id === "bg-rs-hu");
  const huBg = d.routes.find((r) => r.route.id === "hu-rs-bg");
  const last30 = useMemo(
    () => windowStats(d.rows.filter((r) => r.date >= addDays(d.today, -30))),
    [d.rows, d.today],
  );
  const bundle = d.forecasts[target];
  const next7 = d.openProbs.slice(0, 7);
  const bestP = next7.reduce(
    (b, p) => {
      const cand = [
        { dir: "BG→HU", p: p.pBgHu ?? 0, date: p.date },
        { dir: "HU→BG", p: p.pHuBg ?? 0, date: p.date },
      ];
      return cand.reduce((x, y) => (y.p > x.p ? y : x), b);
    },
    { dir: "—", p: 0, date: "" },
  );

  // Save today's forecasts once per session for live (shadow) scoring.
  const saved = useRef(false);
  useEffect(() => {
    if (saved.current) return;
    const rows: StoredForecast[] = [];
    for (const t of ["spread", "BGH", "CEEGEX"] as Target[]) {
      const b = d.forecasts[t];
      if (!b || b.observations < 60) continue;
      for (const p of b.result.ensemble)
        rows.push({
          made_on: d.today,
          target_date: p.date,
          series: t,
          model: "ensemble",
          p50: p.p50,
          lo: p.lo,
          hi: p.hi,
        });
      for (const m of b.result.models)
        if (m.status === "ok")
          for (const p of m.path)
            rows.push({
              made_on: d.today,
              target_date: p.date,
              series: t,
              model: m.id,
              p50: p.p50,
              lo: p.lo,
              hi: p.hi,
            });
    }
    if (!rows.length) return;
    saved.current = true;
    saveArbitrageForecast({ data: { rows } }).catch(() => {
      saved.current = false;
    });
  }, [d.forecasts, d.today]);

  const facts = useMemo(() => {
    const lines: string[] = [];
    for (const r of d.routes)
      lines.push(
        `${r.route.short} for ${r.deliveryDay}: origin ${n2(r.origin?.price)}, destination ${n2(r.destination?.price)}, transport ${n2(r.transportCost)}, net ${sgn(r.netMargin)} (${r.status}).`,
      );
    lines.push(
      `Last 30 days: BG→HU open ${pct(last30.shareBgHu)} of ${last30.days} days (avg net when open ${n2(last30.avgOpenBgHu)}); HU→BG open ${pct(last30.shareHuBg)}; mean spread ${n2(last30.meanSpread)}.`,
    );
    for (const t of ["spread", "BGH", "CEEGEX"] as Target[]) {
      const b = d.forecasts[t];
      if (!b) continue;
      const e = b.result.ensemble;
      const ens = b.result.scores.find((s) => s.id === "ensemble");
      lines.push(
        `${TARGET_LABEL[t]} forecast (${b.observations} obs): D+1 ${n2(e[0]?.p50)} [${n2(e[0]?.lo)}–${n2(e[0]?.hi)}], D+7 ${n2(e[6]?.p50)}, D+14 ${n2(e[13]?.p50)}; ensemble skill vs random walk at 7d ${pct(ens?.skill[6])}; technical score ${sgn(b.score)} (${b.signals.map((s) => `${s.name} ${s.value} ${s.bias}`).join("; ")}).`,
      );
      const fm = b.result.models.find((m) => m.id === "fundamental");
      if (fm?.status === "ok" && "contrib" in fm)
        lines.push(
          `${TARGET_LABEL[t]} driver pushes: ${(
            fm as { contrib: { name: string; contribution: number }[] }
          ).contrib
            .map((c) => `${c.name} ${sgn(c.contribution)}`)
            .join(", ")}.`,
        );
    }
    for (const p of next7)
      lines.push(`${p.date}: P(BG→HU open) ${pct(p.pBgHu)}, P(HU→BG open) ${pct(p.pHuBg)}.`);
    for (const o of d.outlook.outlook)
      lines.push(
        `Month ${o.month}: spread p50 ${sgn(o.p50)} [${n2(o.lo)}–${n2(o.hi)}], historical BG→HU open ${pct(o.histShareBgHu)}${o.forwardSpread !== null ? `, forward spread ${sgn(o.forwardSpread)}` : ""}.`,
      );
    lines.push(
      `Gastrans commercial reverse (HU→BG) only exists while Gastrans flows BG→HU. Capacity availability and auction premiums are not checked.`,
    );
    return lines.join("\n");
  }, [d.routes, d.forecasts, d.outlook, last30, next7]);

  const thin = d.rows.length < 120;

  return (
    <div className="space-y-4">
      {(d.status.historyError || d.status.fxError) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {d.status.historyError && <div>⚠ Stored history: {d.status.historyError}</div>}
          {d.status.fxError && <div>⚠ FX (EUR/HUF for FGSZ tariffs): {d.status.fxError}</div>}
        </div>
      )}
      {thin && !d.status.loading && (
        <div className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Only {d.rows.length} days with both BGH and CEEGEX prices. Forecast models need 60+ days
          and seasonal views need years — import history in <b>Data &amp; import</b> at the bottom
          of this page.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label={`Spread CEEGEX − BGH · ${bgHu?.deliveryDay ?? ""}`}
          value={sgn(bgHu?.gross ?? null)}
          unit="€/MWh"
          hint={`BGH ${n2(bgHu?.origin?.price)} · CEEGEX ${n2(bgHu?.destination?.price)}`}
          variant="primary"
        />
        <KpiCard
          label="BG → HU net (Gastrans)"
          value={sgn(bgHu?.netMargin ?? null)}
          unit="€/MWh"
          hint={`break-even ${n2(bgHu?.breakEven)}`}
          tone={(bgHu?.netMargin ?? 0) > 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="HU → BG net (reverse)"
          value={sgn(huBg?.netMargin ?? null)}
          unit="€/MWh"
          hint={`break-even ${n2(huBg?.breakEven)}`}
          tone={(huBg?.netMargin ?? 0) > 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Open days, last 30"
          value={`${pct(last30.shareBgHu)} / ${pct(last30.shareHuBg)}`}
          hint="BG→HU / HU→BG"
        />
        <KpiCard
          label="Best window next 7 days"
          value={bestP.p > 0 ? pct(bestP.p) : "—"}
          hint={bestP.p > 0 ? `${bestP.dir} on ${bestP.date}` : "needs forecast history"}
          tone={bestP.p >= 0.7 ? "positive" : bestP.p >= 0.4 ? "warning" : "default"}
        />
      </div>

      <RouteEconomics routes={d.routes} />

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Spread vs break-even"
          description="CEEGEX − BGH against what transport costs each way. Above the green line BG→HU pays; below the orange line HU→BG pays."
          height={300}
          action={<RangePicker value={range} onChange={setRange} />}
        >
          <SpreadHistoryChart rows={d.rows} range={range} />
        </ChartCard>
        <ChartCard
          title="Basis to TTF"
          description="Each hub's premium over TTF. The arbitrage is the gap between the BGH and CEEGEX lines."
          height={300}
          action={<RangePicker value={range} onChange={setRange} />}
        >
          <BasisChart rows={d.rows} range={range} />
        </ChartCard>
      </div>

      <WindowGrid rows={d.rows} />

      <Section
        title="Forecast"
        subtitle={`${HORIZON}-day ensemble of random walk, mean reversion, damped trend and a fundamentals regression (weather, storage vs normal${target === "spread" ? "" : ", TTF"}, weekends), weighted by backtest accuracy.`}
        action={
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="inline-flex rounded-md border p-0.5">
              {(["spread", "BGH", "CEEGEX"] as Target[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTarget(t)}
                  className={cn(
                    "rounded px-2 py-0.5",
                    target === t
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {t === "spread" ? "Spread" : t}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5">
              <Switch checked={showModels} onCheckedChange={setShowModels} /> models
            </label>
            <label
              className="flex items-center gap-1.5"
              title="Sep 2021 – Mar 2023 spreads were an order of magnitude wider"
            >
              <Switch checked={excludeCrisis} onCheckedChange={setExcludeCrisis} /> exclude 2021–23
              crisis
            </label>
          </div>
        }
      >
        {bundle ? (
          <div className="space-y-4">
            <div style={{ height: 300 }}>
              <ForecastChart bundle={bundle} rows={d.rows} showModels={showModels} />
            </div>
            {target === "spread" && <OpenWindowTable probs={d.openProbs} />}
            <div className="grid gap-4 xl:grid-cols-2">
              <div>
                <h4 className="mb-1 text-xs font-semibold">Model scorecard</h4>
                <ScoreTable bundle={bundle} />
                <h4 className="mt-3 mb-1 text-xs font-semibold">Models</h4>
                <ModelNotes bundle={bundle} />
              </div>
              <div className="space-y-4">
                <div>
                  <h4 className="mb-1 text-xs font-semibold">Fundamental drivers</h4>
                  <DriversPanel bundle={bundle} />
                  {(d.status.weatherError || d.status.storageError) && (
                    <p className="mt-1 text-[11px] text-amber-700">
                      {d.status.weatherError && `Weather: ${d.status.weatherError}. `}
                      {d.status.storageError && `Storage: ${d.status.storageError}.`}
                    </p>
                  )}
                </div>
                <div>
                  <h4 className="mb-1 text-xs font-semibold">Technical analysis</h4>
                  <TechnicalPanel bundle={bundle} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {d.status.loading
              ? "Loading prices…"
              : "Not enough overlapping BGH / CEEGEX days to forecast yet."}
          </p>
        )}
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Monthly outlook (spread)"
          subtitle="For monthly / quarterly capacity decisions: seasonal norm, today's deviation fading, and month-ahead prices when imported."
        >
          <MonthlyOutlookTable outlook={d.outlook.outlook} note={d.outlook.note} />
        </Section>
        <Section
          title="Live track record"
          subtitle="Ensemble forecasts saved on earlier days, scored against the prices that cleared."
        >
          <ShadowScorecard stored={d.shadow} rows={d.rows} />
        </Section>
      </div>

      <Section title="AI trader brief" subtitle="A short read of everything above, on demand.">
        <AiBrief facts={facts} />
      </Section>

      <Section
        title="Data & import"
        subtitle="What the analysis is built on, and where to add longer history."
      >
        <ImportPanel imported={d.status.imported} onImported={() => void d.refetchHistory()} />
      </Section>
    </div>
  );
}
