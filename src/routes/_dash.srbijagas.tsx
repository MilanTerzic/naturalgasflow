import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { KpiCard } from "@/components/dashboard/KpiCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fetchHistoricalFlows, fetchEcbFx, fetchEntsoeGasGeneration } from "@/lib/data/historical.functions";
import { fetchBelgradeTemperatures } from "@/lib/data/openmeteo.functions";
import {
  aggregateMonthly,
  buildAnalysis,
  dateRangeIso,
  downloadCsv,
  monthsBetween,
  parseKvCsv,
  reconstructPrice,
  seasonalProfile,
  smoothExtremes,
  syntheticBrent,
  syntheticTtf,
  toCsv,
} from "@/lib/srbijagas/helpers";
import { useSrbijagasOverrides } from "@/lib/srbijagas/storage";
import {
  DEFAULT_OFFICIAL_PRICE_EUR_MWH,
  DEFAULT_REGULATED_PRICE_EUR_MWH,
  DEFAULT_TTF_EUR_MWH,
  DEFAULT_OIL_INDEX_EUR_MWH,
} from "@/lib/srbijagas/default-prices";
import type { DailyFlowRow } from "@/lib/srbijagas/types";
import { fmtMcm, fmtShortDate, fmtShortDateYear, fmtMonthYear, fmtTemp } from "@/lib/gas/format";
import { PALETTE } from "@/lib/gas/config";
import { useDashboard } from "@/state/dashboard-context";

export const Route = createFileRoute("/_dash/srbijagas")({
  head: () => ({
    meta: [
      { title: "Srbijagas Full Supply Analysis" },
      {
        name: "description",
        content:
          "Historical Serbian gas demand, Bosnia assumption, power generation, weather and Srbijagas pricing.",
      },
    ],
  }),
  component: SrbijagasPage,
});

// ---------------------------------------------------------------------------
// Period selector
// ---------------------------------------------------------------------------
type Preset = "1y" | "2y" | "3y" | "5y" | "10y" | "custom";

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  return { from: "2021-01-01", to: to.toISOString().slice(0, 10) };
}

function presetRange(p: Preset): { from: string; to: string } | null {
  if (p === "custom") return null;
  const years = parseInt(p, 10);
  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - years);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

// ---------------------------------------------------------------------------

function SrbijagasPage() {
  const { domesticProduction } = useDashboard();
  const { overrides, update, reset } = useSrbijagasOverrides();
  const [preset, setPreset] = useState<Preset>("5y");
  const initial = defaultRange();
  const [fromISO, setFromISO] = useState(initial.from);
  const [toISO, setToISO] = useState(initial.to);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const r = presetRange(p);
    if (r) {
      setFromISO(r.from);
      setToISO(r.to);
    }
  };

  // Data prior to 2022-01-01 is unavailable from ENTSOG, so clamp the effective
  // data window for all non-price charts. The price chart uses its own
  // hardcoded 2021–2026 month range and is unaffected.
  const DATA_FLOOR_ISO = "2022-01-01";
  const effFromISO = fromISO < DATA_FLOOR_ISO ? DATA_FLOOR_ISO : fromISO;

  // Fetch historical flows (ENTSOG ~2y window enforced upstream).
  const flowsQ = useQuery({
    queryKey: ["srbijagas-flows", effFromISO, toISO],
    queryFn: () => fetchHistoricalFlows({ data: { from: effFromISO, to: toISO } }),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const tempsQ = useQuery({
    queryKey: ["srbijagas-temps", effFromISO, toISO],
    queryFn: () => fetchBelgradeTemperatures({ data: { from: effFromISO, to: toISO } }),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const fxQ = useQuery({
    queryKey: ["srbijagas-fx", effFromISO, toISO],
    queryFn: () => fetchEcbFx({ data: { fromISO: effFromISO, toISO } }),
    staleTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const entsoeQ = useQuery({
    queryKey: ["srbijagas-entsoe-gas", effFromISO, toISO],
    queryFn: () => fetchEntsoeGasGeneration({ data: { fromISO: effFromISO, toISO } }),
    staleTime: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const dates = useMemo(() => dateRangeIso(effFromISO, toISO), [effFromISO, toISO]);

  // Adapt FlowRow → DailyFlowRow
  const flows: DailyFlowRow[] = useMemo(() => {
    const src = flowsQ.data?.data ?? [];
    return src.map((r) => ({
      date: r.date,
      kireevo: r.kireevo ?? 0,
      kkd2: r.kiskundorozsma_2 ?? 0,
      kkdHu: r.kiskundorozsma_hu ?? 0,
      kalotina: r.kalotina ?? 0,
    }));
  }, [flowsQ.data]);

  // Merge ENTSO-E gas-fired generation with any manual override (manual wins).
  const powerDailyMerged = useMemo(
    () => ({ ...(entsoeQ.data?.data ?? {}), ...overrides.manualPowerDaily }),
    [entsoeQ.data, overrides.manualPowerDaily],
  );

  const analysis = useMemo(
    () =>
      buildAnalysis({
        dates,
        flows,
        temps: tempsQ.data?.data ?? [],
        bosnia: overrides.bosnia,
        power: overrides.power,
        domesticProduction,
        manualSerbianDaily: overrides.manualSerbianDaily,
        manualBosniaDaily: overrides.manualBosniaDaily,
        manualPowerDaily: powerDailyMerged,
        manualTempDaily: overrides.manualTempDaily,
      }),
    [dates, flows, tempsQ.data, overrides, domesticProduction, powerDailyMerged],
  );

  const monthly = useMemo(() => aggregateMonthly(analysis), [analysis]);
  const seasonal = useMemo(() => seasonalProfile(monthly), [monthly]);

  // Consumption breakdown by sector (user-provided yearly shares of total consumption).
  // Consumption breakdown by sector (user-provided yearly shares of total consumption).
  const consumptionBreakdown = useMemo(() => {
    const SHARES: Record<string, { household: number; district: number; industry: number }> = {
      "2021": { household: 0.129, district: 0.227, industry: 0.644 },
      "2022": { household: 0.137, district: 0.196, industry: 0.666 },
      "2023": { household: 0.139, district: 0.196, industry: 0.665 },
      "2024": { household: 0.156, district: 0.202, industry: 0.642 },
      "2025": { household: 0.1565, district: 0.2015, industry: 0.642 },
      "2026": { household: 0.157, district: 0.201, industry: 0.642 },
    };
    const fallback = SHARES["2026"];
    return monthly.map((m) => {
      const year = m.month.slice(0, 4);
      const s = SHARES[year] ?? fallback;
      const days = m.days || 1;
      // Convert monthly totals to per-day averages so the chart reads in mcm/day,
      // consistent with the rest of the dashboard.
      const totalPerDay = (m.serbian_mcm ?? 0) / days;
      return {
        month: m.month,
        household_mcm: +(totalPerDay * s.household).toFixed(3),
        district_mcm: +(totalPerDay * s.district).toFixed(3),
        industry_mcm: +(totalPerDay * s.industry).toFixed(3),
        total_mcm: +totalPerDay.toFixed(3),
      };
    });
  }, [monthly]);

  const breakdownYearly = useMemo(() => {
    // Aggregate weighted by month length so yearly numbers stay in mcm/day.
    const acc: Record<string, { year: string; household_mcm: number; district_mcm: number; industry_mcm: number; total_mcm: number; days: number }> = {};
    for (let i = 0; i < consumptionBreakdown.length; i++) {
      const r = consumptionBreakdown[i];
      const days = monthly[i]?.days ?? 30;
      const y = r.month.slice(0, 4);
      const a = (acc[y] ??= { year: y, household_mcm: 0, district_mcm: 0, industry_mcm: 0, total_mcm: 0, days: 0 });
      a.household_mcm += r.household_mcm * days;
      a.district_mcm += r.district_mcm * days;
      a.industry_mcm += r.industry_mcm * days;
      a.total_mcm += r.total_mcm * days;
      a.days += days;
    }
    return Object.values(acc).map((a) => ({
      year: a.year,
      household_mcm: +(a.household_mcm / Math.max(1, a.days)).toFixed(3),
      district_mcm: +(a.district_mcm / Math.max(1, a.days)).toFixed(3),
      industry_mcm: +(a.industry_mcm / Math.max(1, a.days)).toFixed(3),
      total_mcm: +(a.total_mcm / Math.max(1, a.days)).toFixed(3),
    }));
  }, [consumptionBreakdown, monthly]);

  // Display-only: smooth extreme outliers (>2.5× or <0.4× prior day) by carry-forward.
  const analysisSmoothed = useMemo(
    () =>
      smoothExtremes(analysis, [
        "serbian_consumption_mcm",
        "imports_bg_net_mcm",
        "imports_total_mcm",
        "kalotina_mcm",
        "kkdHu_mcm",
        "bosnia_mcm",
      ]),
    [analysis],
  );

  // Price reconstruction
  const months = useMemo(() => monthsBetween(fromISO, toISO), [fromISO, toISO]);
  const ttfByMonth = useMemo(
    () => Object.fromEntries(months.map((m) => [m, DEFAULT_TTF_EUR_MWH[m] ?? syntheticTtf(m)])),
    [months],
  );
  const brentByMonth = useMemo(() => Object.fromEntries(months.map((m) => [m, syntheticBrent(m)])), [months]);
  const fxByMonth = fxQ.data?.data ?? {};
  const officialByMonth = useMemo(
    () => ({ ...DEFAULT_OFFICIAL_PRICE_EUR_MWH, ...overrides.manualPriceMonthly }),
    [overrides.manualPriceMonthly],
  );
  const priceRows = useMemo(
    () =>
      reconstructPrice({
        months,
        ttfByMonth,
        brentByMonth,
        fxByMonth,
        officialByMonth,
        formula: overrides.formula,
      }),
    [months, ttfByMonth, brentByMonth, fxByMonth, officialByMonth, overrides.formula],
  );
  // Price comparison chart uses ONLY the user-provided default series — no reconstruction.
  // Always show the full 2021-01 → 2026-12 horizon regardless of the dashboard date filter.
  const priceMonths = useMemo(() => {
    const out: string[] = [];
    for (let y = 2021; y <= 2026; y++) {
      for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, "0")}`);
    }
    return out;
  }, []);
  const priceRowsWithRegulated = useMemo(
    () =>
      priceMonths.map((m) => ({
        month: m,
        official_eur_mwh: DEFAULT_OFFICIAL_PRICE_EUR_MWH[m] ?? null,
        regulated_eur_mwh: DEFAULT_REGULATED_PRICE_EUR_MWH[m] ?? null,
        ttf_eur_mwh: DEFAULT_TTF_EUR_MWH[m] ?? null,
        oil_index_eur_mwh: DEFAULT_OIL_INDEX_EUR_MWH[m] ?? null,
      })),
    [priceMonths],
  );

  // ---------- KPIs ----------
  const measured = analysis.filter((r) => r.source === "measured" || r.source === "manual_override");
  const consumptionValues = measured.map((r) => r.serbian_consumption_mcm);
  const avgDaily = avg(consumptionValues);
  const maxDaily = consumptionValues.length ? Math.max(...consumptionValues) : 0;
  const minDaily = consumptionValues.length ? Math.min(...consumptionValues) : 0;
  const avgMonthly = avg(monthly.map((m) => m.serbian_mcm));
  const peakMonth = monthly.reduce(
    (best, m) => (m.serbian_mcm > (best?.serbian_mcm ?? -1) ? m : best),
    monthly[0],
  );
  const avgBosniaMonthly = avg(monthly.map((m) => m.bosnia_mcm));
  const avgPowerGasMonthly = avg(monthly.map((m) => m.power_gas_mcm));
  const totalHdd = sum(analysis.map((r) => r.hdd ?? 0));
  const avgTemp = avg(analysis.map((r) => r.temperature_c ?? null).filter((v): v is number => v != null));
  const priceWithOfficial = priceRows.filter((p) => p.official_eur_mwh != null);
  const avgPrice = avg(priceWithOfficial.map((p) => p.official_eur_mwh as number));

  // Data quality
  const dq = useMemo(() => {
    const total = analysis.length;
    const measuredCount = analysis.filter((r) => r.source === "measured").length;
    const estimatedCount = analysis.filter((r) => r.source === "estimated").length;
    const missingCount = analysis.filter((r) => r.source === "missing").length;
    const overrideCount = analysis.filter((r) => r.source === "manual_override").length;
    const tempMissing = analysis.filter((r) => r.temperature_c == null).length;
    return { total, measuredCount, estimatedCount, missingCount, overrideCount, tempMissing };
  }, [analysis]);

  // CSV uploads
  const uploadKv = (file: File, key: keyof typeof overrides) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseKvCsv(String(reader.result ?? ""));
        update({ [key]: parsed } as Partial<typeof overrides>);
      } catch (e) {
        console.warn("CSV parse error", e);
      }
    };
    reader.readAsText(file);
  };

  const loading = flowsQ.isLoading || tempsQ.isLoading || entsoeQ.isLoading;
  const flowsError = flowsQ.data?.error;
  const tempsError = tempsQ.data?.error;
  const fxError = fxQ.data?.error;
  const entsoeError = entsoeQ.data?.error;

  return (
    <div className="space-y-4">
      {/* Header / period selector */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border bg-card p-3 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold">Srbijagas Full Supply Analysis</h2>
          <p className="text-xs text-muted-foreground">
            Historical volume / weather / power / price analytics for a potential Srbijagas full-supply offer.
            Default window is 5 years — ENTSOG public history typically covers ~2 years, extend earlier periods via CSV upload.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Range</Label>
            <Select value={preset} onValueChange={(v) => applyPreset(v as Preset)}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1y" className="text-xs">Last 1 year</SelectItem>
                <SelectItem value="2y" className="text-xs">Last 2 years</SelectItem>
                <SelectItem value="3y" className="text-xs">Last 3 years</SelectItem>
                <SelectItem value="5y" className="text-xs">Last 5 years</SelectItem>
                <SelectItem value="10y" className="text-xs">Last 10 years</SelectItem>
                <SelectItem value="custom" className="text-xs">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">From</Label>
            <Input type="date" value={fromISO} className="h-8 w-[140px] text-xs"
              onChange={(e) => { setFromISO(e.target.value); setPreset("custom"); }} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">To</Label>
            <Input type="date" value={toISO} className="h-8 w-[140px] text-xs"
              onChange={(e) => { setToISO(e.target.value); setPreset("custom"); }} />
          </div>
        </div>
      </div>

      {(loading || flowsError || tempsError || fxError || entsoeError) && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {loading && <div>Loading historical data…</div>}
          {flowsError && <div>⚠ ENTSOG: {flowsError}</div>}
          {tempsError && <div>⚠ Weather: {tempsError}</div>}
          {fxError && <div>⚠ ECB FX: {fxError} (price reconstruction will skip oil-indexed component)</div>}
          {entsoeError && <div>⚠ ENTSO-E gas generation: {entsoeError}</div>}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6 xl:grid-cols-6">
        <KpiCard label="Avg daily consumption" value={`${fmtMcm(avgDaily)} mcm`} hint="Serbian, measured days" />
        <KpiCard label="Max daily consumption" value={`${fmtMcm(maxDaily)} mcm`} hint="Peak day" />
        <KpiCard label="Min daily consumption" value={`${fmtMcm(minDaily)} mcm`} hint="Lowest day" />
        <KpiCard label="Avg monthly volume" value={`${fmtMcm(avgMonthly)} mcm`} hint="Per month" />
        <KpiCard label="Peak month" value={`${fmtMcm(peakMonth?.serbian_mcm ?? 0)} mcm`} hint={peakMonth?.month ?? "–"} />
        <KpiCard label="Avg Bosnia / month" value={`${fmtMcm(avgBosniaMonthly)} mcm`} hint="Assumed flow" tone="warning" />
        <KpiCard label="Power gas / month" value={`${fmtMcm(avgPowerGasMonthly)} mcm`} hint="From electricity" tone="warning" />
        <KpiCard label="Avg temperature" value={fmtTemp(avgTemp)} hint="Belgrade" />
        <KpiCard label="Total HDD" value={`${totalHdd.toFixed(0)}`} hint="Base 18 °C" />
        <KpiCard label="Avg Srbijagas price" value={avgPrice ? `${avgPrice.toFixed(1)} €/MWh` : "–"} hint="Official entries" />
        <KpiCard label="Measured days" value={`${dq.measuredCount}/${dq.total}`} hint="Data coverage" />
        <KpiCard label="Estimated days" value={`${dq.estimatedCount + dq.overrideCount}`} hint="Carry-fwd + manual" tone={dq.estimatedCount + dq.overrideCount > 0 ? "warning" : "default"} />
      </div>

      {/* Bosnia assumption panel */}
      <div className="rounded-md border bg-card p-3 shadow-sm">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Bosnia consumption assumption</h3>
          <Badge variant="outline" className="text-[10px]">All values labelled ESTIMATED</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <Label className="text-xs">Method</Label>
            <Select
              value={overrides.bosnia.method}
              onValueChange={(v) =>
                update({ bosnia: { ...overrides.bosnia, method: v as typeof overrides.bosnia.method } })
              }
            >
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="share_of_net" className="text-xs">% of Serbia net imports</SelectItem>
                <SelectItem value="share_of_kireevo_spread" className="text-xs">% of Kireevo − KKD-2</SelectItem>
                <SelectItem value="constant" className="text-xs">Constant mcm/day</SelectItem>
                <SelectItem value="manual" className="text-xs">Manual monthly (CSV)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Bosnia share (%)</Label>
            <div className="mt-2 flex items-center gap-2">
              <Slider
                value={[overrides.bosnia.sharePct * 100]}
                min={0}
                max={25}
                step={0.5}
                onValueChange={(v) =>
                  update({ bosnia: { ...overrides.bosnia, sharePct: v[0] / 100 } })
                }
              />
              <span className="w-10 text-right text-xs tabular-nums">
                {(overrides.bosnia.sharePct * 100).toFixed(1)}%
              </span>
            </div>
          </div>
          <div>
            <Label className="text-xs">Constant (mcm/day)</Label>
            <Input
              type="number"
              step="0.1"
              className="mt-1 h-8 text-xs"
              value={overrides.bosnia.constantMcmDay}
              onChange={(e) =>
                update({ bosnia: { ...overrides.bosnia, constantMcmDay: Number(e.target.value) || 0 } })
              }
            />
          </div>
          <div>
            <Label className="text-xs">Reset all overrides</Label>
            <Button variant="outline" size="sm" className="mt-1 h-8 w-full text-xs" onClick={reset}>
              Reset to defaults
            </Button>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <Tabs defaultValue="volume" className="w-full">
        <TabsList>
          <TabsTrigger value="volume">Volume History</TabsTrigger>
          <TabsTrigger value="breakdown">Consumption Breakdown</TabsTrigger>
          <TabsTrigger value="weather">Weather &amp; Demand</TabsTrigger>
          <TabsTrigger value="power">Gas-fired Power</TabsTrigger>
          <TabsTrigger value="price">Srbijagas Price</TabsTrigger>
          <TabsTrigger value="upload">Manual Overrides</TabsTrigger>
          <TabsTrigger value="quality">Data Quality / Sources</TabsTrigger>
        </TabsList>

        {/* ---------------- VOLUME HISTORY ---------------- */}
        <TabsContent value="volume" className="space-y-4 pt-3">
          <ChartCard title="Daily Serbian gas balance" subtitle="mcm/day — stacked supply (BG net + Kalotina + KKD-HU + production) − Bosnia. Extreme spikes carried-forward." height={340}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={analysisSmoothed} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time"
                  tickFormatter={(v) => fmtMonthYear(new Date(v).toISOString().slice(0, 10))}
                  tick={{ fontSize: 11 }} stroke={PALETTE.axis} minTickGap={50} />
                <YAxis tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                <Tooltip labelFormatter={(v) => fmtMonthYear(new Date(Number(v)).toISOString().slice(0, 10))}
                  formatter={(v: unknown, n) => [typeof v === "number" ? `${fmtMcm(v)} mcm/d` : "–", n]}
                  contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="imports_bg_net_mcm" stackId="s" name="Imports BG-Kireevo (net)" fill={PALETTE.bgImport} isAnimationActive={false} />
                <Bar dataKey="kalotina_mcm" stackId="s" name="Imports BG-Kalotina" fill={PALETTE.kalotina} isAnimationActive={false} />
                <Bar dataKey="kkdHu_mcm" stackId="s" name="Imports HU-KKD" fill={PALETTE.huOthers} isAnimationActive={false} />
                <Bar dataKey="domestic_production_mcm" stackId="s" name="Domestic production" fill={PALETTE.production} isAnimationActive={false} />
                <Line type="monotone" dataKey="bosnia_mcm" name="Bosnia (deducted)" stroke={PALETTE.huMet} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Monthly volume profile" subtitle="Serbia consumption + Bosnia assumption + power-gas equivalent" height={300}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke={PALETTE.axis} tickFormatter={(m) => { const d = new Date(`${m}-01T00:00:00Z`); return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); }} />
                <YAxis tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: unknown, n) => [typeof v === "number" ? `${fmtMcm(v)} mcm` : "–", n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="serbian_mcm" stackId="m" name="Serbia (est.)" fill={PALETTE.bgImport} isAnimationActive={false} />
                <Bar dataKey="bosnia_mcm" stackId="m" name="Bosnia (assumed)" fill={PALETTE.huMet} isAnimationActive={false} />
                <Bar dataKey="power_gas_mcm" stackId="m" name="Power-gas (est.)" fill={PALETTE.kalotina} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Seasonal profile (avg by calendar month)" height={260}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={seasonal} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                <XAxis dataKey="m" tick={{ fontSize: 11 }} stroke={PALETTE.axis}
                  tickFormatter={(m) => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m, 10) - 1]} />
                <YAxis tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="avg" name="Avg" fill={PALETTE.bgImport} isAnimationActive={false}>
                  {seasonal.map((d, i) => (
                    <Cell key={i} fill={["12","01","02"].includes(d.m) ? PALETTE.demand : PALETTE.bgImport} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="max" name="Max" stroke={PALETTE.demand} dot={false} strokeDasharray="4 3" />
                <Line type="monotone" dataKey="min" name="Min" stroke={PALETTE.production} dot={false} strokeDasharray="4 3" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="rounded-md border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Monthly summary</h3>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => downloadCsv("srbijagas-monthly.csv", toCsv(monthly as unknown as Record<string, unknown>[]))}>
                Export CSV
              </Button>
            </div>
            <div className="max-h-[300px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Month</TableHead>
                    <TableHead className="text-right text-xs">Serbia (mcm)</TableHead>
                    <TableHead className="text-right text-xs">Bosnia (mcm)</TableHead>
                    <TableHead className="text-right text-xs">Power gas (mcm)</TableHead>
                    <TableHead className="text-right text-xs">Total potential (mcm)</TableHead>
                    <TableHead className="text-right text-xs">Avg T °C</TableHead>
                    <TableHead className="text-right text-xs">HDD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthly.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="text-xs">{m.month}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtMcm(m.serbian_mcm)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-amber-700">{fmtMcm(m.bosnia_mcm)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-amber-700">{fmtMcm(m.power_gas_mcm)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-semibold">{fmtMcm(m.total_potential_mcm)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{m.avg_temp_c?.toFixed(1) ?? "–"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{m.hdd}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ---------------- CONSUMPTION BREAKDOWN ---------------- */}
        <TabsContent value="breakdown" className="space-y-4 pt-3">
          <div className="rounded-md border bg-card p-3 text-xs text-muted-foreground shadow-sm">
            Serbian consumption split by sector using year-specific shares: <strong>Households</strong>, <strong>District heating</strong>, and <strong>Industry &amp; other</strong>. Shares: 2021 (12.9/22.7/64.4), 2022 (13.7/19.6/66.6), 2023 (13.9/19.6/66.5), 2024 (15.6/20.2/64.2), 2026 est. (15.7/20.1/64.2). 2025 interpolated.
          </div>

          <ChartCard title="Monthly consumption breakdown" subtitle="Stacked area — mcm/day (monthly avg)" height={340}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={consumptionBreakdown} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke={PALETTE.axis}
                  tickFormatter={(m) => { const d = new Date(`${m}-01T00:00:00Z`); return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); }} />
                <YAxis tick={{ fontSize: 11 }} stroke={PALETTE.axis} unit=" mcm/d" />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: unknown, n) => [typeof v === "number" ? `${fmtMcm(v)} mcm/d` : "–", n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="industry_mcm" stackId="b" name="Industry & other" stroke={PALETTE.bgImport} fill={PALETTE.bgImport} fillOpacity={0.85} isAnimationActive={false} />
                <Area type="monotone" dataKey="district_mcm" stackId="b" name="District heating" stroke={PALETTE.huMet} fill={PALETTE.huMet} fillOpacity={0.85} isAnimationActive={false} />
                <Area type="monotone" dataKey="household_mcm" stackId="b" name="Households" stroke={PALETTE.demand} fill={PALETTE.demand} fillOpacity={0.85} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Yearly consumption by sector" subtitle="Stacked bar — mcm/day (yearly avg)" height={280}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdownYearly} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                <YAxis tick={{ fontSize: 11 }} stroke={PALETTE.axis} unit=" mcm/d" />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: unknown, n) => [typeof v === "number" ? `${fmtMcm(v)} mcm/d` : "–", n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="industry_mcm" stackId="y" name="Industry & other" fill={PALETTE.bgImport} isAnimationActive={false} />
                <Bar dataKey="district_mcm" stackId="y" name="District heating" fill={PALETTE.huMet} isAnimationActive={false} />
                <Bar dataKey="household_mcm" stackId="y" name="Households" fill={PALETTE.demand} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="rounded-md border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Yearly breakdown</h3>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => downloadCsv("srbijagas-breakdown.csv", toCsv(breakdownYearly as unknown as Record<string, unknown>[]))}>
                Export CSV
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Year</TableHead>
                  <TableHead className="text-right text-xs">Households (mcm/d)</TableHead>
                  <TableHead className="text-right text-xs">District heating (mcm/d)</TableHead>
                  <TableHead className="text-right text-xs">Industry &amp; other (mcm/d)</TableHead>
                  <TableHead className="text-right text-xs">Total (mcm/d)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdownYearly.map((r) => (
                  <TableRow key={r.year}>
                    <TableCell className="text-xs">{r.year}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{fmtMcm(r.household_mcm)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{fmtMcm(r.district_mcm)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{fmtMcm(r.industry_mcm)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-semibold">{fmtMcm(r.total_mcm)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>



        {/* ---------------- WEATHER & DEMAND ---------------- */}
        <TabsContent value="weather" className="space-y-4 pt-3">
          <ChartCard title="Temperature vs. Serbian gas demand" subtitle="Scatter — daily" height={360}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 16, left: 4, bottom: 20 }}>
                <CartesianGrid stroke={PALETTE.grid} />
                <XAxis type="number" dataKey="temperature_c" name="Temperature" unit="°C"
                  tick={{ fontSize: 11 }} stroke={PALETTE.axis}
                  label={{ value: "Avg daily temperature (°C)", position: "insideBottom", offset: -8, style: { fontSize: 11 } }} />
                <YAxis type="number" dataKey="serbian_consumption_mcm" name="Demand" unit=" mcm"
                  tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }}
                  formatter={(v: unknown, n) => [typeof v === "number" ? v.toFixed(2) : "–", n]}
                  labelFormatter={() => ""} contentStyle={{ fontSize: 12 }} />
                <Scatter data={analysis.filter((r) => r.temperature_c != null)} fill={PALETTE.bgImport} />
              </ScatterChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="HDD vs. Serbian gas demand" height={300}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 16, left: 4, bottom: 20 }}>
                <CartesianGrid stroke={PALETTE.grid} />
                <XAxis type="number" dataKey="hdd" name="HDD" tick={{ fontSize: 11 }} stroke={PALETTE.axis}
                  label={{ value: "Heating degree days (base 18°C)", position: "insideBottom", offset: -8, style: { fontSize: 11 } }} />
                <YAxis type="number" dataKey="serbian_consumption_mcm" tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ fontSize: 12 }} />
                <Scatter data={analysis.filter((r) => r.hdd != null)} fill={PALETTE.demand} />
              </ScatterChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Daily temperature" subtitle="Belgrade — Open-Meteo / Visual Crossing fallback" height={220}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analysis} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time"
                  tickFormatter={(v) => fmtMonthYear(new Date(v).toISOString().slice(0, 10))}
                  tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                <YAxis tick={{ fontSize: 11 }} stroke={PALETTE.axis} unit="°C" />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <ReferenceLine y={18} stroke={PALETTE.huMet} strokeDasharray="3 3" />
                <Line type="monotone" dataKey="temperature_c" stroke={PALETTE.temp} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </TabsContent>

        {/* ---------------- POWER ---------------- */}
        <TabsContent value="power" className="space-y-4 pt-3">
          <div className="rounded-md border bg-card p-3 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold">Power assumptions</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Gas-fired generation (Fossil Gas, B04) pulled from ENTSO-E Transparency for Serbia (10YCS-SERBIATSOV).
              Manual CSV uploads in the Overrides tab take priority over API values.
              Conversion: <code className="rounded bg-muted px-1">gas (mcm) = electricity (GWh) ÷ efficiency ÷ CV (kWh/m³ × 10⁻³)</code>
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="text-xs">Plant efficiency: {(overrides.power.efficiencyPct * 100).toFixed(0)}%</Label>
                <Slider className="mt-2" value={[overrides.power.efficiencyPct * 100]} min={30} max={65} step={1}
                  onValueChange={(v) => update({ power: { ...overrides.power, efficiencyPct: v[0] / 100 } })} />
              </div>
              <div>
                <Label className="text-xs">Gas calorific value (kWh/m³)</Label>
                <Input type="number" step="0.01" className="mt-1 h-8 text-xs"
                  value={overrides.power.gasCvKwhM3}
                  onChange={(e) => update({ power: { ...overrides.power, gasCvKwhM3: Number(e.target.value) || 10.55 } })} />
              </div>
            </div>
          </div>

          <ChartCard title="Power generation vs. gas equivalent" subtitle="Daily (from uploaded GWh series)" height={300}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={analysis.filter((r) => r.power_gwh != null)}
                margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time"
                  tickFormatter={(v) => fmtMonthYear(new Date(v).toISOString().slice(0, 10))}
                  tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                <YAxis yAxisId="g" tick={{ fontSize: 11 }} stroke={PALETTE.axis} label={{ value: "GWh", angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
                <YAxis yAxisId="m" orientation="right" tick={{ fontSize: 11 }} stroke={PALETTE.axis} label={{ value: "mcm", angle: 90, position: "insideRight", style: { fontSize: 11 } }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="g" dataKey="power_gwh" name="Power (GWh)" fill={PALETTE.kalotina} isAnimationActive={false} />
                <Line yAxisId="m" type="monotone" dataKey="power_gas_equiv_mcm" name="Gas equiv. (mcm)" stroke={PALETTE.demand} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </TabsContent>

        {/* ---------------- PRICE ---------------- */}
        <TabsContent value="price" className="space-y-4 pt-3">
          <div className="rounded-md border bg-card p-3 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold">Srbijagas price &amp; formula reconstruction</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              <strong>Official price:</strong> manually entered or uploaded (CSV in Manual Overrides).{" "}
              <strong>Reconstructed:</strong> oil-indexed (lagged Brent → EUR/MWh) and TTF weighted blend + fixed adder.{" "}
              <strong>Sources:</strong> EUR/USD = ECB (live), TTF + Brent = calibrated monthly series (override via CSV).
            </p>
            <div className="grid gap-3 md:grid-cols-5">
              <div>
                <Label className="text-xs">Oil weight: {(overrides.formula.oilWeight * 100).toFixed(0)}%</Label>
                <Slider className="mt-2" value={[overrides.formula.oilWeight * 100]} min={0} max={100} step={5}
                  onValueChange={(v) => update({ formula: { ...overrides.formula, oilWeight: v[0] / 100 } })} />
              </div>
              <div>
                <Label className="text-xs">TTF weight: {(overrides.formula.ttfWeight * 100).toFixed(0)}%</Label>
                <Slider className="mt-2" value={[overrides.formula.ttfWeight * 100]} min={0} max={100} step={5}
                  onValueChange={(v) => update({ formula: { ...overrides.formula, ttfWeight: v[0] / 100 } })} />
              </div>
              <div>
                <Label className="text-xs">Oil lag (months)</Label>
                <Input type="number" min={0} max={12} className="mt-1 h-8 text-xs"
                  value={overrides.formula.oilLagMonths}
                  onChange={(e) => update({ formula: { ...overrides.formula, oilLagMonths: Number(e.target.value) || 0 } })} />
              </div>
              <div>
                <Label className="text-xs">Adder (€/MWh)</Label>
                <Input type="number" step="0.1" className="mt-1 h-8 text-xs"
                  value={overrides.formula.addEurMwh}
                  onChange={(e) => update({ formula: { ...overrides.formula, addEurMwh: Number(e.target.value) || 0 } })} />
              </div>
              <div>
                <Label className="text-xs">Brent→EUR/MWh factor</Label>
                <Input type="number" step="0.01" className="mt-1 h-8 text-xs"
                  value={overrides.formula.brentToEurMwhFactor}
                  onChange={(e) => update({ formula: { ...overrides.formula, brentToEurMwhFactor: Number(e.target.value) || 0.55 } })} />
              </div>
            </div>
          </div>

          <ChartCard title="Price comparison" subtitle="€/MWh monthly" height={320}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={priceRowsWithRegulated} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={PALETTE.grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke={PALETTE.axis} tickFormatter={(m) => { const d = new Date(`${m}-01T00:00:00Z`); return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); }} />
                <YAxis tick={{ fontSize: 11 }} stroke={PALETTE.axis} unit=" €" />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="official_eur_mwh" name="Srbijagas Sales" stroke={PALETTE.demand} strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="ttf_eur_mwh" name="TTF reference" stroke={PALETTE.bgImport} strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="regulated_eur_mwh" name="Srbijagas Source" stroke={PALETTE.kalotina} strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="oil_index_eur_mwh" name="Oil price" stroke={PALETTE.huMet} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="rounded-md border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Pricing table</h3>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => downloadCsv("srbijagas-price.csv", toCsv(priceRowsWithRegulated as unknown as Record<string, unknown>[]))}>
                Export CSV
              </Button>
            </div>
            <div className="max-h-[320px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Month</TableHead>
                    <TableHead className="text-right text-xs">Srbijagas Sales</TableHead>
                    <TableHead className="text-right text-xs">Srbijagas Source</TableHead>
                    <TableHead className="text-right text-xs">Oil price</TableHead>
                    <TableHead className="text-right text-xs">TTF reference</TableHead>
                    <TableHead className="text-right text-xs">Sales − Source</TableHead>
                    <TableHead className="text-right text-xs">TTF − Oil</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {priceRowsWithRegulated.map((p) => {
                    const salesMinusSource =
                      p.official_eur_mwh != null && p.regulated_eur_mwh != null
                        ? p.official_eur_mwh - p.regulated_eur_mwh
                        : null;
                    const ttfMinusOil =
                      p.ttf_eur_mwh != null && p.oil_index_eur_mwh != null
                        ? p.ttf_eur_mwh - p.oil_index_eur_mwh
                        : null;
                    return (
                      <TableRow key={p.month}>
                        <TableCell className="text-xs">{p.month}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{p.official_eur_mwh?.toFixed(1) ?? "–"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{p.regulated_eur_mwh?.toFixed(1) ?? "–"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{p.oil_index_eur_mwh?.toFixed(1) ?? "–"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{p.ttf_eur_mwh?.toFixed(1) ?? "–"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{salesMinusSource?.toFixed(1) ?? "–"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{ttfMinusOil?.toFixed(1) ?? "–"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

          </div>
        </TabsContent>

        {/* ---------------- MANUAL OVERRIDES ---------------- */}
        <TabsContent value="upload" className="space-y-4 pt-3">
          <div className="rounded-md border bg-card p-3 shadow-sm">
            <h3 className="mb-1 text-sm font-semibold">Manual data upload / overrides</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              CSV format: two columns. First column = date (<code>YYYY-MM-DD</code>) or month (<code>YYYY-MM</code>), second = numeric value.
              First row may be a header. Uploads override API-derived values for matching keys; everything labelled as <strong>manual override</strong>.
            </p>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <CsvUpload label="Serbian consumption (mcm/d)" count={Object.keys(overrides.manualSerbianDaily).length}
                onFile={(f) => uploadKv(f, "manualSerbianDaily")}
                onClear={() => update({ manualSerbianDaily: {} })} />
              <CsvUpload label="Bosnia consumption (mcm/d)" count={Object.keys(overrides.manualBosniaDaily).length}
                onFile={(f) => uploadKv(f, "manualBosniaDaily")}
                onClear={() => update({ manualBosniaDaily: {} })} />
              <CsvUpload label="Gas-fired power (GWh/d)" count={Object.keys(overrides.manualPowerDaily).length}
                onFile={(f) => uploadKv(f, "manualPowerDaily")}
                onClear={() => update({ manualPowerDaily: {} })} />
              <CsvUpload label="Srbijagas price (€/MWh, monthly)" count={Object.keys(overrides.manualPriceMonthly).length}
                onFile={(f) => uploadKv(f, "manualPriceMonthly")}
                onClear={() => update({ manualPriceMonthly: {} })} />
              <CsvUpload label="Custom temperature (°C/d)" count={Object.keys(overrides.manualTempDaily).length}
                onFile={(f) => uploadKv(f, "manualTempDaily")}
                onClear={() => update({ manualTempDaily: {} })} />
            </div>
          </div>

          <div className="rounded-md border bg-card p-3 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold">Manual Srbijagas monthly price entry</h3>
            <ManualPriceEditor
              months={months}
              values={overrides.manualPriceMonthly}
              onChange={(map) => update({ manualPriceMonthly: map })}
            />
          </div>
        </TabsContent>

        {/* ---------------- DATA QUALITY ---------------- */}
        <TabsContent value="quality" className="space-y-4 pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border bg-card p-3 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold">Data quality</h3>
              <Table>
                <TableBody>
                  <Row k="Total days in window" v={dq.total} />
                  <Row k="Measured (ENTSOG)" v={dq.measuredCount} />
                  <Row k="Estimated / carried" v={dq.estimatedCount} />
                  <Row k="Missing flows" v={dq.missingCount} tone={dq.missingCount > 0 ? "warning" : undefined} />
                  <Row k="Manual overrides applied" v={dq.overrideCount} />
                  <Row k="Days without temperature" v={dq.tempMissing} tone={dq.tempMissing > 0 ? "warning" : undefined} />
                </TableBody>
              </Table>
            </div>
            <div className="rounded-md border bg-card p-3 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold">Data sources</h3>
              <ul className="space-y-1 text-xs">
                <li>✅ <strong>ENTSOG Transparency Platform</strong> — gas flows (Kireevo, KKD-2, Kalotina, Kiskundorozsma HU). Public, ~2y depth.</li>
                <li>✅ <strong>Open-Meteo</strong> + <strong>Visual Crossing</strong> fallback — Belgrade temperatures.</li>
                <li>✅ <strong>ECB Statistical Data Warehouse</strong> — EUR/USD daily reference rate.</li>
                <li>⚠ <strong>TTF / Brent</strong> — calibrated monthly series; override via CSV upload. <em>To be connected to ICE/Argus feed.</em></li>
                <li>⚠ <strong>Gas-fired power generation</strong> — not connected. Upload daily GWh via CSV. <em>ENTSO-E integration to be added.</em></li>
                <li>⚠ <strong>Srbijagas official price</strong> — manual upload / entry only.</li>
                <li>ℹ <strong>Bosnia consumption</strong> — always assumed (no public direct measurement).</li>
              </ul>
            </div>
          </div>

          <div className="rounded-md border bg-card p-3 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold">Commercial insights</h3>
            <CommercialInsights
              avgMonthly={avgMonthly}
              peakMonth={peakMonth?.month}
              peakMonthVol={peakMonth?.serbian_mcm ?? 0}
              avgBosnia={avgBosniaMonthly}
              avgPowerGas={avgPowerGasMonthly}
              dq={dq}
            />
          </div>

          <div className="rounded-md border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Daily dataset (head)</h3>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => downloadCsv("srbijagas-daily.csv", toCsv(analysis as unknown as Record<string, unknown>[]))}>
                Export CSV
              </Button>
            </div>
            <div className="max-h-[300px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="text-right text-xs">Imports tot</TableHead>
                    <TableHead className="text-right text-xs">BG net</TableHead>
                    <TableHead className="text-right text-xs">Bosnia (est)</TableHead>
                    <TableHead className="text-right text-xs">Serbia cons.</TableHead>
                    <TableHead className="text-right text-xs">T °C</TableHead>
                    <TableHead className="text-right text-xs">HDD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.slice(0, 200).map((r) => (
                    <TableRow key={r.date}>
                      <TableCell className="text-xs">{r.date}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={r.source === "measured" ? "secondary" : "outline"}
                          className={r.source === "missing" ? "text-red-700" : r.source === "manual_override" ? "text-blue-700" : ""}>
                          {r.source}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtMcm(r.imports_total_mcm)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtMcm(r.imports_bg_net_mcm)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-amber-700">{fmtMcm(r.bosnia_mcm)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-semibold">{fmtMcm(r.serbian_consumption_mcm)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.temperature_c?.toFixed(1) ?? "–"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.hdd?.toFixed(0) ?? "–"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {analysis.length > 200 && (
                <p className="mt-2 text-xs text-muted-foreground">Showing first 200 of {analysis.length} rows — export CSV for the full dataset.</p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- helper components ----------

function CsvUpload({
  label,
  count,
  onFile,
  onClear,
}: {
  label: string;
  count: number;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <Label className="text-xs font-medium">{label}</Label>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {count > 0 ? `${count} rows loaded` : "No data — using API"}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Input type="file" accept=".csv,text/csv" className="h-8 text-xs"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} />
        {count > 0 && (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onClear}>Clear</Button>
        )}
      </div>
    </div>
  );
}

function ManualPriceEditor({
  months,
  values,
  onChange,
}: {
  months: string[];
  values: Record<string, number>;
  onChange: (m: Record<string, number>) => void;
}) {
  const set = (m: string, v: string) => {
    const next = { ...values };
    if (v === "" || Number.isNaN(Number(v))) delete next[m];
    else next[m] = Number(v);
    onChange(next);
  };
  return (
    <div className="grid max-h-[300px] grid-cols-2 gap-2 overflow-auto md:grid-cols-3 lg:grid-cols-4">
      {months.map((m) => (
        <div key={m} className="flex items-center gap-2">
          <span className="w-16 text-xs tabular-nums text-muted-foreground">{m}</span>
          <Input type="number" step="0.1" className="h-7 text-xs" placeholder="€/MWh"
            value={values[m] ?? ""} onChange={(e) => set(m, e.target.value)} />
        </div>
      ))}
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: number | string; tone?: "warning" }) {
  return (
    <TableRow>
      <TableCell className="text-xs">{k}</TableCell>
      <TableCell className={`text-right text-xs tabular-nums ${tone === "warning" ? "text-amber-700 font-semibold" : ""}`}>{v}</TableCell>
    </TableRow>
  );
}

function CommercialInsights({
  avgMonthly, peakMonth, peakMonthVol, avgBosnia, avgPowerGas, dq,
}: {
  avgMonthly: number; peakMonth?: string; peakMonthVol: number;
  avgBosnia: number; avgPowerGas: number;
  dq: { measuredCount: number; estimatedCount: number; missingCount: number; total: number };
}) {
  const coverage = dq.total > 0 ? (dq.measuredCount / dq.total) * 100 : 0;
  return (
    <ul className="space-y-1 text-xs leading-relaxed">
      <li>Average monthly Serbian demand over the selected window: <strong>{fmtMcm(avgMonthly)} mcm/month</strong>.</li>
      <li>Winter peak reached <strong>{fmtMcm(peakMonthVol)} mcm</strong> in <strong>{peakMonth ?? "–"}</strong> — full-supply offers must size for this exposure.</li>
      <li>Bosnia-related assumed flow adds approximately <strong>{fmtMcm(avgBosnia)} mcm/month</strong> under the current assumption — adjust the share/method to test sensitivity.</li>
      {avgPowerGas > 0 && (
        <li>Gas-fired power consumption adds <strong>{fmtMcm(avgPowerGas)} mcm/month</strong> on average. Confirm if this is part of the offer scope.</li>
      )}
      <li>ENTSOG coverage on this window: <strong>{coverage.toFixed(0)}%</strong> of days measured;
        {dq.missingCount > 0 && <> <span className="text-amber-700">{dq.missingCount} days have no flow record</span></>}.
      </li>
      <li className="text-muted-foreground">⚠ Confirm Srbijagas official price series, gas-fired generation feed, and Bosnia consumption assumption before binding an offer.</li>
    </ul>
  );
}

// ---------- math helpers ----------
function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}
function sum(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0);
}
