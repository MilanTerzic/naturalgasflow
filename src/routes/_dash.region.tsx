import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronLeft, ChevronRight, Globe2, Pause, Play, RefreshCw } from "lucide-react";
import {
  BalkanFlowMap,
  type CountryBadge,
  type MapLayers,
} from "@/components/region/BalkanFlowMap";
import {
  fetchGasPrices,
  type GasPricesResponse,
  type HubPrices,
} from "@/lib/data/gas-prices.functions";
import { ExchangeDetail } from "@/components/region/ExchangeDetail";
import { NetPositionPanel } from "@/components/region/NetPositionPanel";
import { buildNetRows } from "@/lib/region/net-position-view";
import { COUNTRY_PRICING, HUBS, type HubId } from "@/lib/prices/hubs";
import type { PricePoint } from "@/lib/prices/parsers";
import { Switch } from "@/components/ui/switch";
import {
  fetchEntsogNetPositions,
  fetchEntsogRegionalFlows,
  type RegionalStatus,
} from "@/lib/data/entsog-regional.functions";
import { CONVERSION_MCM_TO_GWH, PALETTE } from "@/lib/gas/config";
import { fmtShortDateYear } from "@/lib/gas/format";
import { isGastransResidualOutlier } from "@/lib/gas/flow-metrics";
import { fetchAgsiStorage } from "@/lib/data/agsi.functions";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { FlowsChart } from "@/components/dashboard/FlowsChart";
import { gastransResidualStats, serbiaBalance } from "@/lib/region/serbia-balance";
import { fetchRbpBookings } from "@/lib/data/rbp-bookings.functions";
import type { FlowPointName, FlowRow } from "@/lib/gas/types";
import {
  buildLinkValues,
  pointSource,
  sharePct,
  type LinkValue,
  type MapMode,
} from "@/lib/region/map-model";
import { CORRIDOR_BY_ID, CORRIDORS, type Corridor } from "@/lib/region/registry";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/state/dashboard-context";
import { useDashboardData } from "@/state/use-dashboard-data";

export const Route = createFileRoute("/_dash/region")({
  head: () => ({
    meta: [
      { title: "Balkan Flow Map — Serbia Gas Dashboard" },
      {
        name: "description",
        content:
          "Regional natural gas flows across Balkan interconnection points from ENTSOG, centred on Serbia.",
      },
    ],
  }),
  component: RegionPage,
});

const SERBIA_COLORS: Record<FlowPointName, string> = {
  kiskundorozsma_hu: PALETTE.huOthers,
  kireevo: PALETTE.bgImport,
  kiskundorozsma_2: PALETTE.huMet,
  kalotina: PALETTE.kalotina,
};

/** Serbian points keep the dashboard palette; regional flows share one teal role colour. */
const colorFor = (c: Corridor) =>
  c.group === "serbia" && c.point
    ? SERBIA_COLORS[c.point]
    : c.group === "model"
      ? PALETTE.demand
      : c.group === "planned"
        ? "var(--planned)"
        : "var(--flow)";

type Unit = "mcm" | "gwh";
const LAYER_KEY = "gas-dashboard.region.layers.v1";
const UNIT_KEY = "gas-dashboard.region.unit";
const DEFAULT_LAYERS: MapLayers = {
  serbia: true,
  regional: true,
  lng: true,
  planned: true,
  labels: true,
  cities: true,
  animate: true,
  capacity: true,
  prices: true,
  netPosition: true,
};

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

const STATUS_STYLE: Record<string, string> = {
  live: "border-[color-mix(in_oklab,var(--status-good)_40%,transparent)] text-[var(--status-good)]",
  cache:
    "border-[color-mix(in_oklab,var(--status-good)_40%,transparent)] text-[var(--status-good)]",
  stale:
    "border-[color-mix(in_oklab,var(--status-warning)_45%,transparent)] text-[var(--status-warning)]",
  empty: "border-border text-muted-foreground",
  error:
    "border-[color-mix(in_oklab,var(--status-critical)_45%,transparent)] text-[var(--status-critical)]",
  demo: "border-[color-mix(in_oklab,var(--status-serious)_45%,transparent)] text-[var(--status-serious)]",
  off: "border-border text-muted-foreground",
  loading: "border-border text-muted-foreground",
  actual:
    "border-[color-mix(in_oklab,var(--status-good)_40%,transparent)] text-[var(--status-good)]",
  provisional:
    "border-[color-mix(in_oklab,var(--status-warning)_45%,transparent)] text-[var(--status-warning)]",
  model: "border-[color-mix(in_oklab,var(--model)_45%,transparent)] text-[var(--model)]",
  missing: "border-border text-muted-foreground",
  planned: "border-[color-mix(in_oklab,var(--planned)_45%,transparent)] text-[var(--planned)]",
};

function StatusPill({
  state,
  children,
  title,
}: {
  state: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
        STATUS_STYLE[state] ?? STATUS_STYLE.empty,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

const STATUS_TEXT: Record<string, string> = {
  actual: "Reported",
  provisional: "Nomination",
  model: "Model",
  missing: "No data",
  planned: "Planned",
};

function RegionPage() {
  const s = useDashboard();
  const { flows, allocations, balance, dates, today } = useDashboardData();
  const [series, setSeries] = useState<"allocation" | "physical_flow">("physical_flow");
  const [mode, setMode] = useState<MapMode>("day");
  const [unit, setUnit] = useState<Unit>(() => readLocal(UNIT_KEY, { u: "mcm" as Unit }).u);
  const [layers, setLayers] = useState<MapLayers>(() => readLocal(LAYER_KEY, DEFAULT_LAYERS));
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(700);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYER_KEY, JSON.stringify(layers));
      window.localStorage.setItem(UNIT_KEY, JSON.stringify({ u: unit }));
    } catch {
      /* storage unavailable: settings stay for this visit only */
    }
  }, [layers, unit]);

  const rows = useMemo<FlowRow[]>(
    () =>
      [...(series === "allocation" ? allocations : flows)]
        .filter((r) => r.date <= today)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [series, allocations, flows, today],
  );
  const days = useMemo(() => rows.map((r) => r.date), [rows]);
  const latest = days.at(-1) ?? null;
  const [date, setDate] = useState<string | null>(latest);
  useEffect(() => {
    if (!date || !days.includes(date)) setDate(latest);
  }, [days, date, latest]);
  const idx = date ? days.indexOf(date) : -1;

  // Timeline playback.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setDate((current) => {
        const i = current ? days.indexOf(current) : -1;
        if (i < 0 || i >= days.length - 1) {
          setPlaying(false);
          return current;
        }
        return days[i + 1];
      });
    }, speed);
    return () => clearInterval(t);
  }, [playing, days, speed]);

  const regionalIndicator = series === "allocation" ? "Allocation" : "Physical Flow";
  const regionalRange = { from: dates[0], to: today, indicator: regionalIndicator } as const;
  const regionalQuery = useQuery({
    queryKey: ["entsog-regional", regionalRange.from, regionalRange.to, regionalIndicator],
    queryFn: () => fetchEntsogRegionalFlows({ data: regionalRange }),
    enabled: s.mode === "live" && Boolean(regionalRange.from),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const regional = s.mode === "live" ? (regionalQuery.data?.corridors ?? null) : null;
  const capacity = s.mode === "live" ? (regionalQuery.data?.capacity ?? null) : null;
  const pricesQuery = useQuery({
    queryKey: ["gas-prices"],
    queryFn: () => fetchGasPrices({ data: {} }),
    enabled: s.mode === "live",
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const queryClient = useQueryClient();
  const [pricesRefreshing, setPricesRefreshing] = useState(false);
  const refreshPrices = async () => {
    setPricesRefreshing(true);
    try {
      const fresh = await fetchGasPrices({ data: { force: true } });
      queryClient.setQueryData<GasPricesResponse>(["gas-prices"], fresh);
    } finally {
      setPricesRefreshing(false);
    }
  };
  const hubPrices = s.mode === "live" ? (pricesQuery.data?.hubs ?? null) : null;
  const countryBadges = useMemo(() => buildCountryBadges(hubPrices), [hubPrices]);
  const regionalState: RegionalStatus | "demo" | "loading" =
    s.mode !== "live"
      ? "demo"
      : regionalQuery.isLoading
        ? "loading"
        : regionalQuery.isError
          ? "error"
          : (regionalQuery.data?.status ?? "loading");

  const values = useMemo(
    () => buildLinkValues({ mode, date, rows, balance, primary: series, regional, capacity }),
    [mode, date, rows, balance, series, regional, capacity],
  );

  // Serbia's cross-border balance: one source for the balance card, net row and map tag.
  const serbia = useMemo(
    () => serbiaBalance({ mode, date, rows, balance }),
    [mode, date, rows, balance],
  );

  const netQuery = useQuery({
    queryKey: ["entsog-net", dates[0], today],
    queryFn: () => fetchEntsogNetPositions({ data: { from: dates[0], to: today } }),
    enabled: s.mode === "live" && Boolean(dates[0]),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const netRows = useMemo(
    () =>
      buildNetRows({
        mode,
        date,
        days,
        entsog: s.mode === "live" ? (netQuery.data?.countries ?? null) : null,
        values,
        balance,
        serbia,
      }),
    [mode, date, days, s.mode, netQuery.data, values, balance, serbia],
  );
  const netBadges = useMemo(
    () =>
      s.mode !== "live"
        ? undefined
        : Object.fromEntries(
            netRows
              .filter((r) => r.c)
              .map((r) => [
                r.mapName,
                {
                  text: `net ${(unit === "gwh" ? r.c!.net * CONVERSION_MCM_TO_GWH : r.c!.net).toFixed(unit === "gwh" ? 0 : 1)}`,
                  tone: "ref" as const,
                  title:
                    r.code === "RS"
                      ? "Serbia net (same as the Serbia balance card): Kalotina + Kireevo + Kiskundorozsma − Horgoš − Bosnia flow (model)"
                      : `${r.label} net position (${r.source}): imports + storage + production + LNG − exports`,
                },
              ]),
          ),
    [netRows, s.mode, unit],
  );

  const toUnit = (mcm: number) => (unit === "gwh" ? mcm * CONVERSION_MCM_TO_GWH : mcm);
  const unitLabel = unit === "gwh" ? "GWh/d" : "mcm/d";
  const fmt = (mcm: number | null | undefined, digits = 2) =>
    mcm == null || !Number.isFinite(mcm)
      ? "—"
      : toUnit(mcm).toLocaleString("en-US", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });
  const fmtShort = (mcm: number) =>
    unit === "gwh" ? toUnit(mcm).toFixed(0) : toUnit(mcm).toFixed(1);

  // Capacity booked via RBP auctions (Gastrans, Transportgas) per corridor, for the map view.
  const rbpTo = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const rbpQuery = useQuery({
    queryKey: ["rbp-bookings", dates[0], rbpTo, 0],
    queryFn: () => fetchRbpBookings({ data: { from: dates[0], to: rbpTo } }),
    enabled: s.mode === "live" && Boolean(dates[0]),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const rbpByCorridor = useMemo(() => {
    const out: Record<string, { total: number; byProduct: Record<string, number>; label: string }> =
      {};
    for (const p of rbpQuery.data?.points ?? []) {
      if (!p.corridor) continue;
      const pool =
        mode === "day"
          ? p.days.filter((d) => d.date === date)
          : p.days.filter((d) => days.includes(d.date));
      if (!pool.length) continue;
      const n = pool.length;
      const byProduct: Record<string, number> = {};
      for (const d of pool)
        for (const [k, v] of Object.entries(d.byProduct))
          byProduct[k] = (byProduct[k] ?? 0) + v / n;
      out[p.corridor] = {
        total: pool.reduce((a, d) => a + d.total, 0) / n,
        byProduct,
        label: p.label,
      };
    }
    return out;
  }, [rbpQuery.data, mode, date, days]);

  // Moved from the former Flow Details page: Gastrans residual and Serbian storage.
  const selectedRow = useMemo(() => rows.find((r) => r.date === date), [rows, date]);
  const residualOutlier = mode === "day" && isGastransResidualOutlier(selectedRow);
  const residual = useMemo(() => {
    const period = gastransResidualStats(rows);
    if (mode !== "day") return period;
    const day = gastransResidualStats(selectedRow ? [selectedRow] : []);
    return { ...period, latest: day.latest, latestDate: day.latestDate };
  }, [rows, mode, selectedRow]);

  const storageQuery = useQuery({
    queryKey: ["agsi-serbia-latest", today],
    queryFn: () =>
      fetchAgsiStorage({
        data: {
          country: "rs",
          from: new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          to: today,
        },
      }),
    enabled: s.mode === "live",
    staleTime: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const latestStorage = storageQuery.data?.data?.at(-1);
  const storageMcm =
    latestStorage?.gasInStorage == null
      ? null
      : (latestStorage.gasInStorage * 1000) / CONVERSION_MCM_TO_GWH;

  const reportedCount = CORRIDORS.filter(
    (c) => (c.group === "serbia" || c.group === "regional") && values[c.id]?.value != null,
  ).length;
  const regionalWithData = Object.keys(regional ?? {}).length;

  const describe = (id: string) => {
    const c = CORRIDOR_BY_ID[id];
    if (!c) return null;
    const v: LinkValue | undefined = values[id];
    const status = c.group === "planned" ? "planned" : (v?.status ?? "missing");
    return (
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold leading-tight">{c.name}</div>
          <StatusPill state={status}>{STATUS_TEXT[status]}</StatusPill>
        </div>
        {c.from && (
          <div className="text-muted-foreground">
            {v?.value != null && v.value < 0
              ? `${c.to} → ${c.from} (reverse)`
              : `${c.from === "LNG" ? "LNG" : c.from} → ${c.to}`}
          </div>
        )}
        {v?.value != null && (
          <div className="num text-base font-semibold text-foreground">
            {fmt(Math.abs(v.value))}{" "}
            <span className="text-xs font-normal text-muted-foreground">{unitLabel}</span>
          </div>
        )}
        {v?.label && (
          <div className="text-[11px] text-muted-foreground">
            {mode === "average" ? `Average ${v.label}` : `Gas day ${v.label}`}
          </div>
        )}
        {v?.technical != null && (
          <CapacityBars
            value={v.value}
            technical={v.technical}
            booked={v.booked ?? null}
            fmt={fmt}
          />
        )}
        {v?.technical != null && v.capacityRef && (
          <div className="text-[10px] text-muted-foreground">
            Capacity: {v.capacityRef} (gas-year reference table, not daily ENTSOG data)
          </div>
        )}
        {v?.technical != null && v.capacityDate && (
          <div className="text-[10px] text-muted-foreground">
            Capacity as of gas day {v.capacityDate} (latest ENTSOG publication)
          </div>
        )}
        {v?.value != null && v.status !== "model" && v.technical == null && (
          <div className="text-[10px] text-muted-foreground">
            No firm technical / booked capacity published by ENTSOG for this day
          </div>
        )}
        {rbpByCorridor[c.id] && (
          <div className="text-[11px] leading-snug">
            <span className="font-medium text-foreground">
              Booked via RBP: {fmt(rbpByCorridor[c.id].total)} {unitLabel}
            </span>
            {Object.keys(rbpByCorridor[c.id].byProduct).length > 0 && (
              <span className="text-muted-foreground">
                {" "}
                (
                {Object.entries(rbpByCorridor[c.id].byProduct)
                  .map(([k, v]) => `${k} ${fmt(v)}`)
                  .join(" · ")}
                )
              </span>
            )}
            <div className="text-[10px] text-muted-foreground">
              RBP auction allocations only; long-term contracts outside RBP not included
            </div>
          </div>
        )}
        {c.note && <div className="text-[11px] leading-snug text-muted-foreground">{c.note}</div>}
        <div className="text-[10px] text-muted-foreground">Click to inspect</div>
      </div>
    );
  };

  const sel = selected ? CORRIDOR_BY_ID[selected] : null;
  const history = useMemo(() => {
    if (!sel) return [];
    const capDays = new Map((capacity?.[sel.id]?.days ?? []).map((d) => [d.date, d]));
    const withCap = (list: Array<{ date: string; v: number | null }>) =>
      list.map((p) => {
        const d = capDays.get(p.date);
        const reverse = (p.v ?? 0) < 0;
        const t = d ? (reverse ? d.reverseTechnical : d.forwardTechnical) : null;
        const b = d ? (reverse ? d.reverseBooked : d.forwardBooked) : null;
        return { ...p, t: t == null ? null : toUnit(t), b: b == null ? null : toUnit(b) };
      });
    if (sel.group === "serbia" && sel.point) {
      return withCap(
        rows.map((r) => ({
          date: r.date,
          v: pointSource(r, sel.point!, series) ? toUnit(r[sel.point!]) : null,
        })),
      );
    }
    if (sel.group === "model") {
      return balance
        .filter((b) => !b.is_forecast)
        .map((b) => ({ date: b.date, v: toUnit(b.bosnia_consumption_mcm) }));
    }
    if (sel.group === "regional" && regional?.[sel.id]) {
      return withCap(
        regional[sel.id].days.map((d) => ({
          date: d.date,
          v: d.net === null ? null : toUnit(d.net),
        })),
      );
    }
    if (sel.group === "regional" && capDays.size) {
      return withCap([...capDays.keys()].sort().map((date) => ({ date, v: null })));
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, rows, series, balance, regional, capacity, unit]);

  const regionalRows = useMemo(
    () =>
      CORRIDORS.filter(
        (c) => c.group === "serbia" || c.group === "model" || c.group === "regional",
      ).map((c) => {
        const hist: Array<number> =
          c.group === "serbia" && c.point
            ? rows
                .filter((r) => pointSource(r, c.point!, series) === series)
                .map((r) => r[c.point!])
            : c.group === "model"
              ? balance.filter((b) => !b.is_forecast).map((b) => b.bosnia_consumption_mcm)
              : (regional?.[c.id]?.days ?? [])
                  .filter((d) => d.net !== null)
                  .map((d) => d.net as number);
        return {
          c,
          v: values[c.id],
          avg: hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : null,
          min: hist.length ? Math.min(...hist) : null,
          max: hist.length ? Math.max(...hist) : null,
          n: hist.length,
        };
      }),
    [rows, series, balance, regional, values],
  );

  const toggleLayer = (k: keyof MapLayers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  const pill = (active: boolean) =>
    cn(
      "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
      active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-4">
      {/* Command bar */}
      <section className="rounded-xl border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Globe2 className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">Balkan gas flow map</h2>
              <StatusPill
                state={s.mode === "live" ? "live" : "demo"}
                title="Serbian border points: the dashboard's ENTSOG series"
              >
                Serbia ·{" "}
                {s.mode === "live"
                  ? series === "allocation"
                    ? "Allocation"
                    : "Physical flow"
                  : "Demo"}
              </StatusPill>
              <StatusPill
                state={regionalState}
                title={
                  regionalQuery.data?.reason ??
                  `Regional interconnection points: ENTSOG ${regionalIndicator}`
                }
              >
                Region ·{" "}
                {regionalState === "demo"
                  ? "off in demo"
                  : regionalState === "loading"
                    ? "loading…"
                    : `${regionalIndicator === "Allocation" ? "Allocation" : "Physical flow"} · ${regionalState} · ${regionalWithData} corridors`}
              </StatusPill>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Width ∝ volume · animated = direction of flow · grey dashed = nothing published ·
              values never filled in.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-lg border bg-muted/50 p-0.5"
              role="group"
              aria-label="Map mode"
            >
              <button
                type="button"
                className={pill(mode === "day")}
                onClick={() => setMode("day")}
                aria-pressed={mode === "day"}
              >
                Gas day
              </button>
              <button
                type="button"
                className={pill(mode === "average")}
                onClick={() => {
                  setMode("average");
                  setPlaying(false);
                }}
                aria-pressed={mode === "average"}
              >
                Period avg
              </button>
            </div>
            <div
              className="inline-flex rounded-lg border bg-muted/50 p-0.5"
              role="group"
              aria-label="Units"
            >
              <button
                type="button"
                className={pill(unit === "mcm")}
                onClick={() => setUnit("mcm")}
                aria-pressed={unit === "mcm"}
              >
                mcm/d
              </button>
              <button
                type="button"
                className={pill(unit === "gwh")}
                onClick={() => setUnit("gwh")}
                aria-pressed={unit === "gwh"}
              >
                GWh/d
              </button>
            </div>
            <label className="sr-only" htmlFor="region-series">
              ENTSOG indicator
            </label>
            <select
              id="region-series"
              value={series}
              onChange={(e) => setSeries(e.target.value as "allocation" | "physical_flow")}
              className="h-8 rounded-md border bg-background px-2 text-xs font-medium text-foreground"
            >
              <option value="physical_flow">Physical flow</option>
              <option value="allocation">Allocation</option>
            </select>
            <button
              type="button"
              onClick={() => void regionalQuery.refetch()}
              disabled={s.mode !== "live" || regionalQuery.isFetching}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              title="Refresh regional ENTSOG data"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", regionalQuery.isFetching && "animate-spin")}
              />
              Refresh
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        {/* Map */}
        <section className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <BalkanFlowMap
            values={values}
            selected={selected}
            onSelect={setSelected}
            layers={layers}
            colorFor={colorFor}
            formatValue={fmtShort}
            describe={describe}
            countryBadges={countryBadges}
            netBadges={netBadges}
            overlay={
              <>
                <div className="pointer-events-none absolute top-3 left-3 rounded-lg border bg-card/90 px-3 py-2 shadow-sm backdrop-blur">
                  <div className="eyebrow">{mode === "day" ? "Gas day" : "Period average"}</div>
                  <div className="num mt-0.5 text-sm font-semibold text-foreground">
                    {mode === "day"
                      ? date
                        ? fmtShortDateYear(date)
                        : "No data"
                      : days.length
                        ? `${fmtShortDateYear(days[0])} – ${fmtShortDateYear(days.at(-1)!)}`
                        : "No data"}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {reportedCount} corridors reporting · {unitLabel}
                  </div>
                </div>
                <div className="pointer-events-none absolute bottom-3 left-3 hidden space-y-1 rounded-lg border bg-card/90 px-3 py-2 text-[10px] text-muted-foreground shadow-sm backdrop-blur sm:block">
                  <LegendRow
                    swatch={
                      <line
                        x1="2"
                        y1="5"
                        x2="30"
                        y2="5"
                        stroke="var(--flow)"
                        strokeWidth="4"
                        strokeLinecap="round"
                      />
                    }
                  >
                    Reported flow
                  </LegendRow>
                  <LegendRow
                    swatch={
                      <line
                        x1="2"
                        y1="5"
                        x2="30"
                        y2="5"
                        stroke={PALETTE.demand}
                        strokeWidth="3"
                        strokeDasharray="6 3"
                      />
                    }
                  >
                    Model / nomination
                  </LegendRow>
                  <LegendRow
                    swatch={
                      <line
                        x1="2"
                        y1="5"
                        x2="30"
                        y2="5"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeDasharray="4 4"
                      />
                    }
                  >
                    No data published
                  </LegendRow>
                  <LegendRow
                    swatch={
                      <line
                        x1="2"
                        y1="5"
                        x2="30"
                        y2="5"
                        stroke="var(--planned)"
                        strokeWidth="2"
                        strokeDasharray="1 5"
                        strokeLinecap="round"
                      />
                    }
                  >
                    Planned project
                  </LegendRow>
                  <LegendRow
                    swatch={
                      <>
                        <line
                          x1="3"
                          y1="5"
                          x2="29"
                          y2="5"
                          stroke="var(--flow)"
                          strokeWidth="9"
                          strokeLinecap="round"
                          opacity="0.13"
                        />
                        <line
                          x1="3"
                          y1="5"
                          x2="29"
                          y2="5"
                          stroke="var(--flow)"
                          strokeWidth="6"
                          strokeLinecap="round"
                          opacity="0.3"
                        />
                        <line
                          x1="3"
                          y1="5"
                          x2="29"
                          y2="5"
                          stroke="var(--flow)"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                      </>
                    }
                  >
                    Technical ▸ booked ▸ flow
                  </LegendRow>
                  <LegendRow swatch={<circle cx="16" cy="5" r="4" fill="var(--status-warning)" />}>
                    LNG terminal
                  </LegendRow>
                  <div className="pt-0.5">
                    Ctrl/⌘ + scroll or double-click to zoom · drag to pan
                  </div>
                </div>
              </>
            }
          />

          {/* Timeline */}
          <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
            <button
              type="button"
              onClick={() => {
                if (mode !== "day") setMode("day");
                if (idx >= days.length - 1) setDate(days[0]);
                setPlaying((p) => !p);
              }}
              disabled={days.length < 2}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-foreground transition-colors hover:bg-accent disabled:opacity-40"
              aria-label={playing ? "Pause playback" : "Play through the period"}
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => idx > 0 && setDate(days[idx - 1])}
              disabled={idx <= 0 || mode !== "day"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent disabled:opacity-40"
              aria-label="Previous gas day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, days.length - 1)}
              value={Math.max(0, idx)}
              onChange={(e) => {
                setMode("day");
                setDate(days[Number(e.target.value)]);
              }}
              className="min-w-[160px] flex-1 accent-[var(--flow)]"
              aria-label="Gas day timeline"
              aria-valuetext={date ?? undefined}
            />
            <button
              type="button"
              onClick={() => idx < days.length - 1 && setDate(days[idx + 1])}
              disabled={idx < 0 || idx >= days.length - 1 || mode !== "day"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent disabled:opacity-40"
              aria-label="Next gas day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("day");
                setDate(latest);
              }}
              disabled={date === latest && mode === "day"}
              className="h-8 rounded-md border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-40"
            >
              Latest
            </button>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="h-8 rounded-md border bg-background px-2 text-xs"
              aria-label="Playback speed"
            >
              <option value={1200}>0.5×</option>
              <option value={700}>1×</option>
              <option value={300}>2×</option>
              <option value={120}>5×</option>
            </select>
            <span className="num ml-auto text-[11px] text-muted-foreground">
              {days[0] ?? "—"} → {latest ?? "—"} · change the window in Gas Balance → Data view
            </span>
          </div>
        </section>

        {/* Inspector */}
        <aside className="space-y-4">
          <section className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between">
              <h3 className="eyebrow">Serbia balance</h3>
              <span className="text-[10px] text-muted-foreground">
                {mode === "day" ? date : "period avg"} · {unitLabel}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat
                label="Gross entry"
                value={fmt(serbia.gross)}
                hint="Kireevo + Kalotina + Kiskundorozsma"
              />
              <Stat
                label="Transit to Hungary"
                value={fmt(serbia.exit)}
                hint="Kiskundorozsma 2 / Horgoš"
              />
              <Stat
                label="Bosnia flow"
                value={fmt(serbia.bosnia)}
                hint="Model, not metered"
                tone="model"
              />
              <Stat
                label="Net in Serbia"
                value={fmt(serbia.net)}
                hint="Entry − Hungary − Bosnia"
                tone="strong"
              />
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Net is shown only when all four points reported
              {mode === "average" ? `; averaged over ${serbia.days} complete gas days` : ""}. The
              same figure is Serbia&apos;s net in the country table and on the map. Production and
              storage are not included.
            </p>

            <div className="mt-3 border-t pt-3">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-[11px] font-medium text-foreground">
                  Kireevo − Horgoš residual
                </h4>
                <span className="text-[10px] text-muted-foreground">
                  {series === "allocation" ? "allocation" : "physical flow"}
                </span>
              </div>
              <div className="num mt-1.5 grid grid-cols-4 gap-1.5 text-center">
                {(
                  [
                    [mode === "day" ? "Day" : "Latest", residual.latest],
                    ["Avg", residual.avg],
                    ["Max", residual.max],
                    ["Min", residual.min],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded-md border bg-background px-1 py-1.5">
                    <div className="text-[10px] text-muted-foreground">{k}</div>
                    <div
                      className={cn(
                        "text-xs font-semibold",
                        v == null
                          ? "text-muted-foreground"
                          : v >= 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-red-700 dark:text-red-400",
                      )}
                    >
                      {fmt(v, 1)}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                Kireevo entry − Kiskundorozsma 2 exit. Positive: more allocated in at Kireevo than
                out at Horgoš. A cross-TSO residual, not a measure of Serbian domestic imports;
                linepack, measurement or reporting timing can move it. Avg/Max/Min over the loaded
                window.
              </p>
              {residualOutlier && (
                <div
                  role="alert"
                  className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-950"
                >
                  <strong>Reconciliation warning:</strong> the residual exceeds the indicative
                  Gastrans Serbian-network exit reference (~11.5 mcm/d). It is not verified Serbian
                  imports; compare the same gas day and indicator at both TSOs.
                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
              <Stat
                label="Serbia storage"
                value={latestStorage?.full == null ? "—" : `${latestStorage.full.toFixed(1)}%`}
                hint={
                  latestStorage
                    ? `AGSI+ · ${latestStorage.gasDayStart}`
                    : storageQuery.data?.missingKey
                      ? "AGSI_API_KEY not configured"
                      : s.mode !== "live"
                        ? "Live data only"
                        : "AGSI+ latest available"
                }
              />
              <Stat
                label="Gas in storage"
                value={storageMcm == null ? "—" : fmt(storageMcm, 0)}
                hint={`${unitLabel === "GWh/d" ? "GWh" : "mcm"} · latest AGSI+ day, not the map day`}
              />
            </div>
          </section>

          <NetPositionPanel
            rows={netRows}
            fmt={fmt}
            unitLabel={unitLabel}
            heading={mode === "day" ? `gas day ${date ?? ""}` : "period avg"}
            loading={netQuery.isLoading}
            demo={s.mode !== "live"}
            failed={netQuery.data?.failedCountries ?? []}
            indicator={series === "allocation" ? "allocation" : "physical flow"}
          />

          <HubPricesPanel
            hubs={hubPrices}
            loading={pricesQuery.isLoading}
            demo={s.mode !== "live"}
            storage={pricesQuery.data?.storage}
            refreshing={pricesRefreshing}
            onRefresh={refreshPrices}
          />

          {sel && (
            <section className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{sel.name}</h3>
                  {sel.from && (
                    <div className="text-xs text-muted-foreground">
                      {sel.from} → {sel.to}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSelected(null)}
                >
                  Close
                </button>
              </div>
              {history.some((h) => h.v !== null || ("t" in h && h.t != null)) ? (
                <div className="mt-3 h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={history}
                      margin={{ top: 4, right: 4, left: -18, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="sel-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={colorFor(sel)} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={colorFor(sel)} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                        tickFormatter={(d: string) => d.slice(5)}
                        minTickGap={24}
                      />
                      <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={44} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          fontSize: 11,
                        }}
                        formatter={(v, name) => [
                          `${typeof v === "number" ? v.toFixed(2) : "—"} ${unitLabel}`,
                          name === "t" ? "Firm technical" : name === "b" ? "Firm booked" : "Flow",
                        ]}
                      />
                      {date && (
                        <ReferenceLine
                          x={date}
                          stroke="var(--muted-foreground)"
                          strokeDasharray="3 3"
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="v"
                        stroke={colorFor(sel)}
                        strokeWidth={1.8}
                        fill="url(#sel-fill)"
                        connectNulls={false}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="t"
                        stroke="var(--muted-foreground)"
                        strokeDasharray="5 4"
                        strokeWidth={1.4}
                        dot={false}
                        connectNulls={false}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="b"
                        stroke={colorFor(sel)}
                        strokeOpacity={0.6}
                        strokeDasharray="2 3"
                        strokeWidth={1.4}
                        dot={false}
                        connectNulls={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-3 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  {sel.group === "planned"
                    ? "Planned project — shown for context only."
                    : "No published values for this corridor in the selected window."}
                </p>
              )}
              {values[sel.id]?.technical != null && (
                <div className="mt-3 rounded-lg border bg-background p-3">
                  <div className="eyebrow mb-2">
                    Capacity · {mode === "day" ? `gas day ${date}` : "period avg"}
                  </div>
                  <CapacityBars
                    value={values[sel.id].value}
                    technical={values[sel.id].technical!}
                    booked={values[sel.id].booked ?? null}
                    fmt={fmt}
                    unitLabel={unitLabel}
                  />
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Chart: dashed grey = firm technical, dotted = firm booked.
                  </p>
                </div>
              )}
              {sel.note && (
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{sel.note}</p>
              )}
              {sel.group === "regional" && regional?.[sel.id] && (
                <details className="mt-2 text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer">
                    ENTSOG points used ({regional[sel.id].points.length})
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {regional[sel.id].points.map((p) => (
                      <li key={p.pointDirection} className="num break-all">
                        {p.label} · {p.side} · {p.role} side · {p.pointDirection}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}

          <section className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between">
              <h3 className="eyebrow">Corridors</h3>
              <span className="text-[10px] text-muted-foreground">{unitLabel}</span>
            </div>
            <CorridorList
              values={values}
              selected={selected}
              onSelect={setSelected}
              fmtShort={fmtShort}
            />
          </section>

          <section className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <h3 className="eyebrow">Layers</h3>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
              {(
                [
                  ["serbia", "Serbian points"],
                  ["regional", "Regional points"],
                  ["lng", "LNG terminals"],
                  ["planned", "Planned projects"],
                  ["labels", "Value labels"],
                  ["cities", "Cities & storage"],
                  ["animate", "Flow animation"],
                  ["capacity", "Capacity casings"],
                  ["prices", "Gas prices"],
                  ["netPosition", "Net position"],
                ] as Array<[keyof MapLayers, string]>
              ).map(([k, label]) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
                >
                  <Switch
                    checked={layers[k]}
                    onCheckedChange={() => toggleLayer(k)}
                    aria-label={label}
                  />
                  {label}
                </label>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {/* Per-point Serbian flows (moved from the former Flow Details page) */}
      <ChartCard
        title="Serbian border points — physical flows (mcm/day)"
        subtitle="ENTSOG Physical Flow per point over the loaded window; may differ from the Allocation values used for the gas balance. Missing observations stay blank."
        height={420}
      >
        <FlowsChart flows={flows} dates={dates} today={today} />
      </ChartCard>

      {/* Corridor table */}
      <section className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Corridor statistics & capacity
            </h3>
            <p className="text-xs text-muted-foreground">
              Signed values: negative = reverse of the listed direction. Statistics use reported
              days only. Capacity: ENTSOG firm technical / firm booked in the direction of the flow.
            </p>
          </div>
          {regionalQuery.data && (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Feed diagnostics</summary>
              <div className="num mt-1 space-y-0.5 text-right">
                <div>
                  window {regionalQuery.data.from} → {regionalQuery.data.to}
                </div>
                <div>
                  {regionalQuery.data.diagnostics.referentialRecords} ENTSOG point directions
                  scanned
                </div>
                <div>{regionalQuery.data.diagnostics.candidatePoints} matched to map corridors</div>
                <div>
                  {regionalQuery.data.diagnostics.requests} requests ·{" "}
                  {regionalQuery.data.diagnostics.failedRequests} failed
                </div>
                <div>
                  capacity: {regionalQuery.data.diagnostics.capacityRequests} requests ·{" "}
                  {regionalQuery.data.diagnostics.failedCapacityRequests} failed ·{" "}
                  {Object.keys(regionalQuery.data.capacity ?? {}).length} corridors with data
                </div>
                {Object.keys(regionalQuery.data.diagnostics.droppedUnits).length > 0 && (
                  <div>
                    dropped units:{" "}
                    {Object.entries(regionalQuery.data.diagnostics.droppedUnits)
                      .map(([u, n]) => `${u} ×${n}`)
                      .join(", ")}
                  </div>
                )}
                <div>
                  fetched{" "}
                  {new Date(regionalQuery.data.fetchedAt).toLocaleString("en-GB", {
                    timeZone: "Europe/Belgrade",
                  })}
                </div>
              </div>
            </details>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                {[
                  "Corridor",
                  "Direction",
                  mode === "day" ? `Gas day ${date ?? ""}` : "Period avg",
                  "Avg",
                  "Min",
                  "Max",
                  "Days",
                  "Technical",
                  "Booked",
                  "Booked %",
                  "Flow % tech",
                  "Status",
                ].map((h, i) => (
                  <th
                    key={h}
                    className={cn(
                      "eyebrow px-3 py-2 whitespace-nowrap",
                      i >= 2 && i <= 10 && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {regionalRows.map(({ c, v, avg, min, max, n }) => (
                <tr
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  className={cn(
                    "cursor-pointer border-b last:border-0 transition-colors hover:bg-accent/50",
                    selected === c.id && "bg-accent/60",
                  )}
                >
                  <td className="px-3 py-2">
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                      style={{ background: colorFor(c) }}
                    />
                    <span className="font-medium text-foreground">{c.name}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {c.from} → {c.to}
                  </td>
                  <td className="num px-3 py-2 text-right font-semibold text-foreground">
                    {fmt(v?.value)}
                  </td>
                  <td className="num px-3 py-2 text-right">{fmt(avg)}</td>
                  <td className="num px-3 py-2 text-right">{fmt(min)}</td>
                  <td className="num px-3 py-2 text-right">{fmt(max)}</td>
                  <td className="num px-3 py-2 text-right text-muted-foreground">{n}</td>
                  <td className="num px-3 py-2 text-right">{fmt(v?.technical)}</td>
                  <td className="num px-3 py-2 text-right">{fmt(v?.booked)}</td>
                  <td className="num px-3 py-2 text-right">
                    <PctCell pct={sharePct(v?.booked, v?.technical)} />
                  </td>
                  <td className="num px-3 py-2 text-right">
                    <PctCell
                      pct={sharePct(v?.value == null ? null : Math.abs(v.value), v?.technical)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill state={v?.status ?? "missing"}>
                      {STATUS_TEXT[v?.status ?? "missing"]}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-[11px] text-muted-foreground">
        Serbian points use the dashboard&apos;s ENTSOG series (Serbia balance: entry − Horgoš −
        modelled Bosnia flow). Regional points: the same ENTSOG indicator as selected above
        (Physical Flow by default, or Allocation), exit side of the sending TSO (entry side only
        when the exit side publishes nothing). Basemap: Natural Earth. Pipeline routes are
        schematic.
      </p>
    </div>
  );
}

function LegendRow({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <svg width="32" height="10" aria-hidden="true">
        {swatch}
      </svg>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "model" | "strong";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-background px-3 py-2",
        tone === "strong" &&
          "border-[color-mix(in_oklab,var(--flow)_45%,transparent)] bg-[color-mix(in_oklab,var(--flow)_8%,var(--card))]",
      )}
    >
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "num mt-0.5 text-lg font-semibold",
          tone === "strong"
            ? "text-[var(--flow)]"
            : tone === "model"
              ? "text-[var(--model)]"
              : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] leading-tight text-muted-foreground">{hint}</div>
    </div>
  );
}

function CorridorList({
  values,
  selected,
  onSelect,
  fmtShort,
}: {
  values: Record<string, LinkValue>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  fmtShort: (v: number) => string;
}) {
  const groups: Array<[Corridor["group"], string]> = [
    ["serbia", "Serbia"],
    ["model", "Modelled"],
    ["regional", "Region · ENTSOG"],
    ["planned", "Planned"],
  ];
  const max = Math.max(
    1,
    ...Object.values(values).map((v) => (v.value === null ? 0 : Math.abs(v.value))),
  );
  return (
    <div className="mt-2 max-h-[420px] space-y-0.5 overflow-y-auto pr-1">
      {groups.map(([g, title]) => {
        const items = CORRIDORS.filter((c) => c.group === g).sort(
          (a, b) => Math.abs(values[b.id]?.value ?? 0) - Math.abs(values[a.id]?.value ?? 0),
        );
        return (
          <div key={g}>
            <div className="eyebrow mt-2 mb-1 !text-[10px]">{title}</div>
            {items.map((c) => {
              const v = values[c.id];
              const has = v?.value != null;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(selected === c.id ? null : c.id)}
                  className={cn(
                    "grid w-full grid-cols-[10px_1fr_auto] items-center gap-x-2 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                    selected === c.id && "bg-accent",
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: colorFor(c), opacity: has || g === "planned" ? 1 : 0.35 }}
                  />
                  <span className="min-w-0 truncate text-foreground">
                    {c.name}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {c.from ? `${c.from}→${c.to}` : ""}
                      {has && v!.value! < 0 ? " · reverse" : ""}
                    </span>
                  </span>
                  <span className="num text-right text-foreground">
                    {g === "planned" ? (
                      ""
                    ) : has ? (
                      `${v!.value! < 0 ? "⇄ " : ""}${fmtShort(Math.abs(v!.value!))}`
                    ) : (
                      <span className="text-[10px] text-muted-foreground">no data</span>
                    )}
                  </span>
                  {has && (
                    <span className="col-span-2 col-start-2 mt-1 h-[3px] overflow-hidden rounded bg-border">
                      <span
                        className="block h-full rounded"
                        style={{
                          width: `${(Math.abs(v!.value!) / max) * 100}%`,
                          background: colorFor(c),
                        }}
                      />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function utilTone(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 95) return "text-[var(--status-critical)]";
  if (pct >= 80) return "text-[var(--status-warning)]";
  return "text-foreground";
}

function PctCell({ pct }: { pct: number | null }) {
  return <span className={utilTone(pct)}>{pct === null ? "—" : `${pct.toFixed(0)}%`}</span>;
}

/** Technical capacity as the full bar, booked and flow as shares of it. */
function CapacityBars({
  value,
  technical,
  booked,
  fmt,
  unitLabel,
}: {
  value: number | null;
  technical: number;
  booked: number | null;
  fmt: (mcm: number | null | undefined, digits?: number) => string;
  unitLabel?: string;
}) {
  const flow = value === null ? null : Math.abs(value);
  const rows: Array<[string, number | null, string]> = [
    ["Technical", technical, "var(--muted-foreground)"],
    ["Booked", booked, "var(--flow)"],
    ["Flow", flow, "var(--foreground)"],
  ];
  return (
    <div className="space-y-1.5">
      {rows.map(([label, v, color]) => {
        const pct = label === "Technical" ? 100 : sharePct(v, technical);
        return (
          <div
            key={label}
            className="grid grid-cols-[62px_1fr_auto] items-center gap-2 text-[11px]"
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.min(100, pct ?? 0)}%`,
                  background: color,
                  opacity: label === "Technical" ? 0.35 : 0.9,
                }}
              />
            </span>
            <span className="num text-right text-foreground">
              {fmt(v)}
              {unitLabel ? ` ${unitLabel}` : ""}
              {label !== "Technical" && (
                <span className={cn("ml-1", utilTone(pct))}>
                  {pct === null ? "" : `${pct.toFixed(0)}%`}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Latest published point: newest date, ties resolved by publication order. */
function latestPoint(points: PricePoint[] | undefined): PricePoint | null {
  if (!points?.length) return null;
  return points.reduce((best, p) => ((p.date ?? "") > (best.date ?? "") ? p : best), points[0]);
}

const fmtEur = (v: number) => v.toFixed(2);

function buildCountryBadges(hubs: Record<HubId, HubPrices> | null): Record<string, CountryBadge> {
  const out: Record<string, CountryBadge> = {};
  for (const [country, pricing] of Object.entries(COUNTRY_PRICING)) {
    const own = pricing.hub ? latestPoint(hubs?.[pricing.hub]?.points) : null;
    if (pricing.hub && own) {
      out[country] = {
        text: `${pricing.hub} ${fmtEur(own.price)}`,
        tone: "price",
        title: `${HUBS[pricing.hub].name}: ${fmtEur(own.price)} €/MWh · ${own.label} · ${own.date ?? ""}`,
      };
      continue;
    }
    const ref = (pricing.reference ?? [])
      .map((id) => ({ id, p: latestPoint(hubs?.[id]?.points) }))
      .find((r) => r.p);
    if (ref?.p) {
      out[country] = {
        text: `${pricing.hub ? `${pricing.hub} n/a` : "no hub"} · ref ${ref.id}`,
        tone: "ref",
        title: `${pricing.hub ? `${HUBS[pricing.hub].name}: no public feed.` : "No traded hub."} Reference only: ${HUBS[ref.id].name} ${fmtEur(ref.p.price)} €/MWh (${ref.p.date ?? ""}). Not a local price.`,
      };
      continue;
    }
    out[country] = {
      text: pricing.hub ? `${pricing.hub} · no feed` : "no hub",
      tone: "none",
      title: pricing.hub ? HUBS[pricing.hub].reason : "No traded gas hub.",
    };
  }
  return out;
}

function HubPricesPanel({
  hubs,
  loading,
  demo,
  storage,
  refreshing,
  onRefresh,
}: {
  hubs: Record<HubId, HubPrices> | null;
  loading: boolean;
  demo: boolean;
  storage?: GasPricesResponse["storage"];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const order: HubId[] = ["TTF", "CEGH", "BGH", "CEEGEX", "HENEX", "BRM", "EPIAS"];
  const ttf = latestPoint(hubs?.TTF.points);
  const cegh = latestPoint(hubs?.CEGH.points);
  return (
    <section className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between">
        <h3 className="eyebrow">Hub spot prices</h3>
        <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
          €/MWh · latest published
          {!demo && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-accent disabled:opacity-50"
              title="Fetch all exchanges now"
            >
              <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
              Refresh
            </button>
          )}
        </span>
      </div>
      {demo ? (
        <p className="mt-2 text-xs text-muted-foreground">Prices are fetched in live mode only.</p>
      ) : (
        <div className="mt-2 space-y-1">
          {order.map((id) => {
            const h = hubs?.[id];
            const p = latestPoint(h?.points);
            const state = loading ? "loading" : (h?.status ?? "loading");
            return (
              <div
                key={id}
                className="grid grid-cols-[1fr_auto] items-center gap-x-2 rounded-md px-1.5 py-1 text-xs"
              >
                <a
                  href={h?.exchange?.sourceUrl ?? HUBS[id].url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-foreground hover:underline"
                  title={h?.exchange?.licence ?? h?.reason ?? HUBS[id].reason ?? HUBS[id].name}
                >
                  {HUBS[id].name}
                </a>
                <span className="num text-right font-semibold text-foreground">
                  {p ? (
                    fmtEur(p.price)
                  ) : (
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {h?.exchange
                        ? "n/a"
                        : state === "unavailable"
                          ? "no feed"
                          : state === "loading"
                            ? "…"
                            : state}
                    </span>
                  )}
                </span>
                {h?.exchange && <ExchangeDetail ex={h.exchange} />}
                {p && !h?.exchange && (
                  <span className="col-span-2 text-[10px] text-muted-foreground">
                    {p.label === p.date ? p.date : `${p.label} · ${p.date}`}
                    {!p.final && " · provisional"}
                    {h?.status === "stale" && " · stale"}
                  </span>
                )}
              </div>
            );
          })}
          {ttf && cegh && (
            <div className="mt-2 rounded-md border bg-background px-2.5 py-2 text-xs">
              <span className="text-muted-foreground">CEGH − TTF spread </span>
              <span className="num font-semibold text-foreground">
                {(cegh.price - ttf.price >= 0 ? "+" : "") + (cegh.price - ttf.price).toFixed(2)}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {" "}
                · CEGH {cegh.date} vs TTF {ttf.date}
              </span>
            </div>
          )}
          <p className="pt-1 text-[10px] leading-snug text-muted-foreground">
            Only public, key-free sources, as published: a missing price stays missing. BRM is
            converted from RON at the BNR fixing shown. CEEREP and BRM data may need a licence for
            redistribution. Countries without a hub show a reference hub, never as a local price.
            {storage && (
              <span className="block">
                Stored in {storage.mode}
                {storage.note ? ` · ${storage.note}` : ""}
              </span>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
