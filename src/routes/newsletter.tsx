import { createFileRoute } from "@tanstack/react-router";
import { pageMetadata } from "@/lib/page-metadata";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  BalkanFlowMap,
  type CountryBadge,
  type MapLayers,
} from "@/components/region/BalkanFlowMap";
import { HuStoragePanel } from "@/components/dashboard/HuStorageChart";
import { HU_STORAGE_NOTE, useHuStorage } from "@/lib/gas/use-hu-storage";
import { fetchTariffFx } from "@/lib/data/fx.functions";
import { fetchAgsiStorage } from "@/lib/data/agsi.functions";
import { fetchEntsogAllocations, fetchEntsogFlows } from "@/lib/data/entsog.functions";
import {
  fetchEntsogNetPositions,
  fetchEntsogRegionalFlows,
} from "@/lib/data/entsog-regional.functions";
import { fetchGasPrices, type HubPrices } from "@/lib/data/gas-prices.functions";
import { fetchRbpBookings } from "@/lib/data/rbp-bookings.functions";
import { fetchBelgradeTemperaturesWithBrowserFallback } from "@/lib/data/temperatures-browser";
import {
  BIH_SHARE,
  CONVERSION_MCM_TO_GWH,
  CONVERSION_MCM_TO_MWH,
  DOMESTIC_PRODUCTION_MCM,
  PALETTE,
} from "@/lib/gas/config";
import { buildBalance, dateRangeIso } from "@/lib/gas/demand";
import { splitHungaryEntry } from "@/lib/gas/met-nominations";
import {
  SIGNAL_THRESHOLD,
  arbitrageSentences,
  computeAll,
  type RouteResult,
} from "@/lib/gas/arbitrage";
import { GASTRANS_FUEL } from "@/lib/gas/tariffs/data";
import type { FlowPointName } from "@/lib/gas/types";
import {
  checkNewsletterToken,
  listNewsletterD1Forecasts,
  listNewsletterMetNominations,
  saveNewsletterD1Forecast,
} from "@/lib/newsletter/newsletter.functions";
import {
  addDaysISO,
  buildAlerts,
  d1Check,
  d1CheckSentence,
  d1Expectation,
  d1Sentence,
  netIntoSerbia,
  pickFlowDay,
  pointRows,
  priceChartRows,
  priceDayRows,
  storageRow,
  summarySentences,
  type PriceDayRow,
  type StorageRow,
} from "@/lib/newsletter/compute";
import { COUNTRY_PRICING, HUBS, type HubId } from "@/lib/prices/hubs";
import { buildLinkValues, pointSource } from "@/lib/region/map-model";
import { buildNetRows } from "@/lib/region/net-position-view";
import { CORRIDOR_BY_ID, CORRIDORS, type Corridor } from "@/lib/region/registry";
import { serbiaBalance } from "@/lib/region/serbia-balance";

/**
 * Daily gas newsletter page. The email job (.github/workflows/newsletter.yml) opens it with
 * the shared token, screenshots every section marked data-shot and mails them. It is also
 * the "view in browser" version. Every figure comes from the same server functions as the
 * dashboard; a source that fails leaves its section with a visible "not available" note.
 */
export const Route = createFileRoute("/newsletter")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
    today:
      typeof search.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.today)
        ? search.today
        : undefined,
  }),
  head: () => ({
    meta: [
      ...pageMetadata(
        "Gas daily · Serbia",
        "Daily Serbian gas balance, regional flows, storage levels and gas price report.",
      ),
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewsletterPage,
});

const PAST_DAYS = 14;
const FUTURE_DAYS = 6;
const HUB_ORDER: HubId[] = ["TTF", "CEGH", "BGH", "CEEGEX", "HENEX", "BRM"];
/** Exchanges whose next-day price the sender waits for (TTF/CEGH publish on their own schedule). */
const WAIT_FOR: HubId[] = ["BGH", "CEEGEX", "HENEX", "BRM"];
const HUB_COLORS: Record<string, string> = {
  TTF: "#94a3b8",
  CEGH: "#5fc4e8",
  BGH: "#2fb38f",
  CEEGEX: "#e5a13a",
  HENEX: "#c060d0",
  BRM: "#e06464",
};
const STORAGE_COUNTRIES = [
  { code: "rs", label: "Serbia" },
  { code: "hu", label: "Hungary" },
  { code: "bg", label: "Bulgaria" },
  { code: "ro", label: "Romania" },
  { code: "hr", label: "Croatia" },
  { code: "at", label: "Austria" },
  { code: "eu", label: "EU" },
] as const;
const POINT_LABEL: Record<FlowPointName, string> = {
  kalotina: "Kalotina / Dimitrovgrad (BG→RS)",
  kireevo: "Kireevo / Zaječar (BG→RS)",
  kiskundorozsma_hu: "Kiskundorozsma (HU→RS)",
  kiskundorozsma_2: "Kiskundorozsma 2 / Horgoš (RS→HU)",
};
/** Compact labels for the wide border-point table. */
const POINT_SHORT: Record<FlowPointName, string> = {
  kalotina: "Kalotina BG→RS",
  kireevo: "Kireevo BG→RS",
  kiskundorozsma_hu: "KKD1 HU→RS",
  kiskundorozsma_2: "KKD2 / Horgoš RS→HU",
};
const POINT_COLORS: Record<FlowPointName, string> = {
  kiskundorozsma_hu: PALETTE.huOthers,
  kireevo: PALETTE.bgImport,
  kiskundorozsma_2: PALETTE.huMet,
  kalotina: PALETTE.kalotina,
};
const MAP_LAYERS: MapLayers = {
  serbia: true,
  regional: true,
  lng: true,
  planned: false,
  labels: true,
  cities: false,
  animate: false,
  capacity: true,
  prices: true,
  netPosition: true,
};
const AXIS = { fontSize: 12, fill: "#9aa7b4" };
const GRID = "rgba(255,255,255,0.08)";
const noop = () => {};
const nothing = () => null;

const belgradeToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(new Date());
const ok = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v);
const n1 = (v: number | null | undefined) => (ok(v) ? v.toFixed(1) : "—");
const n2 = (v: number | null | undefined) => (ok(v) ? v.toFixed(2) : "—");
const signed = (v: number | null | undefined, digits = 1) =>
  ok(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}` : "—";
const pct = (v: number | null | undefined) => (ok(v) ? `${Math.round(v)}%` : "—");
const longDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const shortDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const tone = (v: number | null | undefined) =>
  !ok(v) || Math.abs(v) < 0.05
    ? "text-muted-foreground"
    : v > 0
      ? "text-[var(--status-good)]"
      : "text-[var(--status-critical)]";

const colorFor = (c: Corridor) =>
  c.group === "serbia" && c.point
    ? POINT_COLORS[c.point]
    : c.group === "model"
      ? PALETTE.demand
      : c.group === "planned"
        ? "var(--planned)"
        : "var(--flow)";

function NewsletterPage() {
  const { token, today: todayParam } = Route.useSearch();

  // The email is dark; force the dark theme on this page without saving it.
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!had) root.classList.remove("dark");
    };
  }, []);

  const access = useQuery({
    queryKey: ["newsletter-access", token],
    queryFn: () => checkNewsletterToken({ data: { token } }),
    enabled: Boolean(token),
    retry: 1,
    staleTime: Infinity,
  });

  if (!token)
    return (
      <Shell>
        <Note>This page needs the newsletter link.</Note>
      </Shell>
    );
  if (access.isError)
    return (
      <Shell>
        <Note error>Newsletter could not be opened: {String(access.error)}</Note>
      </Shell>
    );
  if (!access.data)
    return (
      <Shell>
        <Note>Checking the newsletter link…</Note>
      </Shell>
    );
  if (!access.data.ok)
    return (
      <Shell>
        <Note error>{access.data.reason}</Note>
      </Shell>
    );
  return <Newsletter today={todayParam ?? belgradeToday()} token={token} />;
}

function Shell({ children, ready }: { children: ReactNode; ready?: boolean }) {
  return (
    <main
      data-newsletter-ready={ready ? "true" : undefined}
      className="mx-auto min-h-screen w-full max-w-[760px] space-y-4 bg-background px-3 py-4 sm:px-5 sm:py-6 text-foreground [&_[data-shot]_button]:hidden"
    >
      {children}
    </main>
  );
}

function Note({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <p className={error ? "text-[15px] text-destructive" : "text-[15px] text-muted-foreground"}>
      {children}
    </p>
  );
}

function Section({
  shot,
  title,
  subtitle,
  children,
}: {
  shot: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section data-shot={shot} className="rounded-lg border bg-card p-4">
      <h2 className="text-[17px] font-semibold text-foreground">{title}</h2>
      {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
      <div className="mt-3 overflow-x-auto">{children}</div>
    </section>
  );
}

function Unavailable({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed px-3 py-2 text-[13px] text-muted-foreground">
      {children}
    </p>
  );
}

const QUERY = { retry: 1, staleTime: 10 * 60_000, refetchOnWindowFocus: false } as const;
/** ENTSOG reads on the hosted app can take minutes; retry once more after a pause. */
const ENTSOG_QUERY = { ...QUERY, retry: 2, retryDelay: 20_000 } as const;
const MIN = 60_000;

/** Rejects after `ms` so one slow source can never hold the whole newsletter. */
function deadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** An ENTSOG answer with an error and no rows counts as a failure, so it is retried. */
async function entsogRows<T extends { data?: unknown[]; error?: string | null }>(
  work: Promise<T>,
  label: string,
): Promise<T> {
  const result = await deadline(work, 8 * MIN, label);
  if (!result.data?.length) throw new Error(result.error || `${label}: no data returned`);
  return result;
}

function Newsletter({ today, token }: { today: string; token: string }) {
  const deliveryDay = addDaysISO(today, 1);
  const from = addDaysISO(today, -PAST_DAYS);
  const to = addDaysISO(today, FUTURE_DAYS);
  const dates = useMemo(
    () => dateRangeIso(new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)),
    [from, to],
  );

  const flowsQ = useQuery({
    ...ENTSOG_QUERY,
    queryKey: ["nl-flows", from, today],
    queryFn: () =>
      entsogRows(fetchEntsogFlows({ data: { from, to: today } }), "ENTSOG physical flow"),
  });
  const allocQ = useQuery({
    ...ENTSOG_QUERY,
    queryKey: ["nl-alloc", from, today],
    queryFn: () =>
      entsogRows(fetchEntsogAllocations({ data: { from, to: today } }), "ENTSOG allocation"),
  });
  const tempsQ = useQuery({
    ...QUERY,
    queryKey: ["nl-temps", from, to],
    queryFn: () =>
      deadline(fetchBelgradeTemperaturesWithBrowserFallback({ from, to }), 2 * MIN, "Temperature"),
  });
  const regionalQ = useQuery({
    ...ENTSOG_QUERY,
    queryKey: ["nl-regional", from, today],
    queryFn: async () => {
      const result = await deadline(
        fetchEntsogRegionalFlows({ data: { from, to: today, indicator: "Physical Flow" } }),
        8 * MIN,
        "Regional ENTSOG",
      );
      if (result.status === "error") throw new Error(result.reason);
      return result;
    },
  });
  // Country net positions only label the map; the slowest read, so it gets a short leash.
  const netQ = useQuery({
    ...QUERY,
    retry: 0,
    queryKey: ["nl-net", from, today],
    queryFn: () =>
      deadline(fetchEntsogNetPositions({ data: { from, to: today } }), 4 * MIN, "Net positions"),
  });
  const pricesQ = useQuery({
    ...QUERY,
    queryKey: ["nl-prices", today],
    queryFn: () => deadline(fetchGasPrices({ data: {} }), 3 * MIN, "Prices"),
  });
  const fxQ = useQuery({
    ...QUERY,
    queryKey: ["nl-fx", today],
    queryFn: () => deadline(fetchTariffFx({ data: { onOrBefore: today } }), 2 * MIN, "FX"),
  });
  const rbpQ = useQuery({
    ...QUERY,
    queryKey: ["nl-rbp", from, today],
    queryFn: () =>
      deadline(fetchRbpBookings({ data: { from, to: addDaysISO(today, 2) } }), 3 * MIN, "RBP"),
  });
  const storageQ = useQuery({
    ...QUERY,
    queryKey: ["nl-storage", today],
    queryFn: async () => {
      const settled = await Promise.allSettled(
        STORAGE_COUNTRIES.map((c) =>
          fetchAgsiStorage({ data: { country: c.code, from: addDaysISO(today, -10), to: today } }),
        ),
      );
      return STORAGE_COUNTRIES.map((c, i) => {
        const r = settled[i];
        if (r.status !== "fulfilled") return { ...c, row: null, error: String(r.reason) };
        return {
          ...c,
          row: r.value.data?.length ? storageRow(r.value.data) : null,
          error: r.value.error ?? (r.value.missingKey ? "AGSI_API_KEY not set" : undefined),
        };
      });
    },
  });

  const loadNominations = useCallback(
    (from: string, to: string) => listNewsletterMetNominations({ data: { token, from, to } }),
    [token],
  );
  const huStorage = useHuStorage(today, loadNominations, "newsletter");
  const nomsQ = useQuery({
    ...QUERY,
    queryKey: ["nl-met-noms", from, deliveryDay],
    queryFn: () => loadNominations(from, deliveryDay),
  });
  const nomByDay = useMemo(
    () => new Map((nomsQ.data ?? []).map((n) => [n.gas_day, n.nominated_mwh])),
    [nomsQ.data],
  );

  // Stored D+1 expectations of earlier newsletters, to check them against actual flows.
  const d1sQ = useQuery({
    ...QUERY,
    queryKey: ["nl-d1-forecasts", today],
    queryFn: () =>
      listNewsletterD1Forecasts({
        data: { token, from: addDaysISO(today, -7), to: addDaysISO(today, -1) },
      }),
  });

  const all = [flowsQ, allocQ, tempsQ, regionalQ, netQ, pricesQ, rbpQ, storageQ, nomsQ, fxQ, d1sQ];
  const settled = all.every((q) => q.isSuccess || q.isError) && huStorage.settled;

  // ---------------------------------------------------------------- derived data
  const flows = useMemo(
    () => [...(flowsQ.data?.data ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [flowsQ.data],
  );
  const temps = tempsQ.data?.data ?? [];
  const balance = useMemo(
    () =>
      buildBalance({
        dates,
        todayIso: today,
        flows: allocQ.data?.data ?? [],
        temps,
        usePolynomial: true,
        curveShift: 1,
        curveDistortion: 1,
        bihShare: BIH_SHARE,
        domesticProduction: DOMESTIC_PRODUCTION_MCM,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dates, today, allocQ.data, tempsQ.data],
  );

  const flowPick = useMemo(() => pickFlowDay(flows, today), [flows, today]);
  const flowDay = flowPick.date;
  const points = useMemo(() => pointRows(flows, flowDay), [flows, flowDay]);
  const net = useMemo(() => netIntoSerbia(flows, balance, flowDay), [flows, balance, flowDay]);
  // KKD1 (Kiskundorozsma HU→RS) split into MET (saved nomination) and Others (the rest).
  const kkd1Split = useMemo(() => {
    const splitOn = (date: string) => {
      const row = flows.find((r) => r.date === date);
      if (!row || pointSource(row, "kiskundorozsma_hu", "physical_flow") !== "physical_flow")
        return null;
      return splitHungaryEntry(row.kiskundorozsma_hu, nomByDay.get(date) ?? null);
    };
    const window = flowDay
      ? flows.filter((r) => r.date >= addDaysISO(flowDay, -7) && r.date < flowDay)
      : [];
    const avg = (pick: (x: ReturnType<typeof splitHungaryEntry>) => number | null) => {
      const vals = window
        .map((r) => splitOn(r.date))
        .map((x) => (x ? pick(x) : null))
        .filter((v): v is number => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const day = flowDay ? splitOn(flowDay) : null;
    const nominated = flowDay ? nomByDay.has(flowDay) : false;
    const mk = (
      key: string,
      label: string,
      value: number | null,
      avg7: number | null,
      note: string,
    ) => ({ key, label, value, avg7, change: ok(value) && ok(avg7) ? value - avg7 : null, note });
    return [
      mk(
        "met",
        "MET",
        day?.metMcm ?? null,
        avg((x) => x.metMcm),
        day?.status === "over_nomination"
          ? `nomination exceeds flow by ${n2(day.mismatchMcm)}`
          : nominated
            ? "saved MET nomination"
            : nomsQ.isError
              ? "nominations unavailable"
              : "no nomination saved (0)",
      ),
      mk(
        "others",
        "Others",
        day?.othersMcm ?? null,
        avg((x) => x.othersMcm),
        "flow − MET",
      ),
    ];
  }, [flows, flowDay, nomByDay, nomsQ.isError]);

  const pastFlows = useMemo(() => flows.filter((r) => r.date < today), [flows, today]);
  const regional = regionalQ.data?.corridors ?? null;
  const capacity = regionalQ.data?.capacity ?? null;
  const values = useMemo(
    () =>
      buildLinkValues({
        mode: "day",
        date: flowDay,
        rows: pastFlows,
        balance,
        primary: "physical_flow",
        regional,
        capacity,
      }),
    [flowDay, pastFlows, balance, regional, capacity],
  );
  // Last 14 gas days up to the flow day, for the flow-vs-technical pipes.
  const pipeHistory = useMemo(() => {
    if (!flowDay) return [];
    const days = pastFlows
      .map((r) => r.date)
      .filter((d) => d <= flowDay)
      .slice(-14);
    return days.map((date) => ({
      date,
      values: buildLinkValues({
        mode: "day",
        date,
        rows: pastFlows,
        balance,
        primary: "physical_flow",
        regional,
        capacity,
      }),
    }));
  }, [flowDay, pastFlows, balance, regional, capacity]);
  const serbia = useMemo(
    () => serbiaBalance({ mode: "day", date: flowDay, rows: pastFlows, balance }),
    [flowDay, pastFlows, balance],
  );
  const netRows = useMemo(
    () =>
      buildNetRows({
        mode: "day",
        date: flowDay,
        days: pastFlows.map((r) => r.date),
        entsog: netQ.data?.countries ?? null,
        values,
        balance,
        serbia,
      }),
    [flowDay, pastFlows, netQ.data, values, balance, serbia],
  );
  const netBadges = useMemo(
    () =>
      Object.fromEntries(
        netRows
          .filter((r) => r.c)
          .map((r) => [r.mapName, { text: `net ${r.c!.net.toFixed(1)}`, tone: "ref" as const }]),
      ),
    [netRows],
  );

  const hubs = pricesQ.data?.hubs ?? null;
  const countryBadges = useMemo(() => buildCountryBadges(hubs), [hubs]);
  const priceDays = useMemo(
    () =>
      priceDayRows(
        Object.fromEntries(HUB_ORDER.map((h) => [h, hubs?.[h]?.points ?? []])),
        today,
        deliveryDay,
      ),
    [hubs, today, deliveryDay],
  );
  const ttfRow = priceDays.find((p) => p.hub === "TTF");
  const ttfHeadline = ttfRow?.b ?? ttfRow?.a ?? null;
  const priceChart = useMemo(
    () =>
      priceChartRows(
        Object.fromEntries(HUB_ORDER.map((h) => [h, hubs?.[h]?.points ?? []])),
        addDaysISO(today, -30),
      ),
    [hubs, today],
  );
  const awaiting = WAIT_FOR.filter((h) => {
    const latest = hubs?.[h]?.exchange?.latest ?? null;
    return !latest || latest.deliveryDate < deliveryDay;
  });

  const storage = storageQ.data ?? [];
  const rsRow = storage.find((s) => s.code === "rs")?.row ?? null;
  const storageRs = rsRow?.full != null ? rsRow : null;
  // Serbia is usually absent from AGSI+; the EU aggregate is the fallback headline.
  const storageEu = storage.find((s) => s.code === "eu")?.row ?? null;
  const d1 = balance.find((b) => b.date === deliveryDay) ?? null;
  // The demand model needs a temperature; without one there is no forecast.
  const d1Temp = d1 ? (d1.avg_temperature_c ?? d1.temperature_c) : null;
  // D+1: firm capacity allocated on RBP at KKD1 (Kiskundorozsma HU→RS) for the delivery day.
  // RBP day-ahead auction results for D+1 are out (~17:30 CET) once any point carries D+1.
  const rbpD1Published = (rbpQ.data?.points ?? []).some((p) =>
    p.days.some((d) => d.date === deliveryDay && Object.keys(d.byProduct).length > 0),
  );
  const kkdBookedD1 = (() => {
    const days = (rbpQ.data?.points ?? [])
      .filter((p) => p.corridor === "hu_rs_1")
      .flatMap((p) => p.days.filter((d) => d.date === deliveryDay))
      .filter((d) => Object.keys(d.byProduct).length > 0);
    return days.length ? days.reduce((sum, d) => sum + d.total, 0) : null;
  })();
  const metNomD1 = nomByDay.has(deliveryDay)
    ? nomByDay.get(deliveryDay)! / CONVERSION_MCM_TO_MWH
    : null;
  const expectD1 = d1Expectation({
    day: deliveryDay,
    demand: d1?.demand_mcm ?? null,
    temperature: ok(d1Temp) ? d1Temp : null,
    domestic: DOMESTIC_PRODUCTION_MCM,
    kkdBooked: kkdBookedD1,
    metNominated: metNomD1,
  });

  const baseSummary = summarySentences({
    flowDay,
    flowComplete: flowPick.complete,
    net,
    points,
    deliveryDay,
    demandD1: d1 && ok(d1Temp) ? { demand: d1.demand_mcm, temperature: d1Temp } : null,
    today,
    priceDays,
    storageRs: storageRs ?? storageEu,
    storageScope: storageRs ? "rs" : "eu",
  });
  const d1Line = d1Sentence(expectD1, DOMESTIC_PRODUCTION_MCM);
  // The D+1 expectation follows the demand-forecast line.
  // Arbitrage: same delivery day for every price.
  const hubPoints = (h: "BGH" | "CEEGEX") =>
    (hubs?.[h]?.points ?? [])
      .filter((x): x is typeof x & { date: string } => !!x.date)
      .map((x) => ({ date: x.date, price: x.price, final: x.final }));
  const arbPrices = { BGH: hubPoints("BGH"), CEEGEX: hubPoints("CEEGEX") };
  // Both hubs on the same day: D+1 when both published it, else today, so no route is left
  // empty only because one exchange has not published tomorrow yet.
  const bothOn = (d: string) =>
    arbPrices.BGH.some((x) => x.date === d) && arbPrices.CEEGEX.some((x) => x.date === d);
  const arbDay = bothOn(deliveryDay) ? deliveryDay : bothOn(today) ? today : deliveryDay;
  const arb = computeAll(arbDay, arbPrices, fxQ.data?.fx ?? null);
  const arbLines = arbitrageSentences(arb);
  const check = d1Check(
    d1sQ.data?.rows.find((r) => r.forecast_for === flowDay) ?? null,
    flowDay,
    net.net,
  );
  const checkLine = d1CheckSentence(check);
  const alerts = buildAlerts({
    flowDay,
    borderPoints: CORRIDORS.filter((c) => c.group === "serbia").map((c) => ({
      name: c.name,
      flow: ok(values[c.id]?.value) ? values[c.id]!.value! : null,
      technical: ok(values[c.id]?.technical) ? values[c.id]!.technical! : null,
      booked: ok(values[c.id]?.booked) ? values[c.id]!.booked! : null,
    })),
    net,
    d1Net: expectD1.net,
    d1Day: deliveryDay,
    check,
    arbitrage: arb
      .filter(
        (r) =>
          r.netMargin !== null && r.netMargin >= SIGNAL_THRESHOLD && r.status !== "UNAVAILABLE",
      )
      .map((r) => ({ short: r.route.short, netMargin: r.netMargin!, day: r.deliveryDay })),
    priceDays,
  });
  const withD1 = d1Line
    ? (() => {
        const at = baseSummary.findIndex((l) => l.startsWith("Serbian demand forecast"));
        const out = [...baseSummary];
        out.splice(at >= 0 ? at + 1 : out.length, 0, d1Line, ...(checkLine ? [checkLine] : []));
        return out;
      })()
    : checkLine
      ? [...baseSummary, checkLine]
      : baseSummary;
  // Arbitrage lines follow the day-ahead price line.
  const summary = (() => {
    if (!arbLines.length) return withD1;
    const at = withD1.findIndex((l) => l.startsWith("Day-ahead for delivery"));
    const out = [...withD1];
    out.splice(at >= 0 ? at + 1 : out.length, 0, ...arbLines);
    return out;
  })();
  const missing = [
    flowsQ.isError ? "ENTSOG physical flow" : null,
    allocQ.isError ? "ENTSOG allocation" : null,
    tempsQ.isError || tempsQ.data?.error ? "temperature" : null,
    regionalQ.isError ? "regional ENTSOG" : null,
    pricesQ.isError ? "prices" : null,
    rbpQ.isError ? "RBP bookings" : null,
    storageQ.isError ? "AGSI storage" : null,
    huStorage.error ? "Srbijagas HU storage" : null,
    nomsQ.isError ? "MET nominations" : null,
    fxQ.isError || fxQ.data?.error ? "EUR/HUF/RSD rates" : null,
  ].filter((x): x is string => !!x);

  // Keep today's D+1 expectation for tomorrow's check (the server ignores test dates).
  const d1Save = settled && expectD1.net !== null ? expectD1 : null;
  useEffect(() => {
    if (!d1Save) return;
    saveNewsletterD1Forecast({
      data: {
        token,
        made_on: today,
        forecast_for: d1Save.day,
        net_mcm: d1Save.net!,
        demand_mcm: d1Save.demand,
        temperature_c: d1Save.temperature,
        kkd_booked_mcm: d1Save.kkdBooked,
      },
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d1Save?.net, d1Save?.kkdBooked, d1Save?.day, token, today]);

  if (!settled) {
    const done = all.filter((q) => q.isSuccess || q.isError).length;
    return (
      <Shell>
        <Note>
          Preparing today's gas newsletter… ({done}/{all.length})
        </Note>
      </Shell>
    );
  }

  const metadata = {
    today,
    deliveryDay,
    flowDay,
    summary,
    awaiting,
    waitFor: rbpD1Published ? [] : ["RBP day-ahead auction results for D+1"],
    missing,
    netIntoSerbia: net.net,
    netIntoSerbiaD1: expectD1.net,
    alerts: alerts.map((a) => `${a.level === "high" ? "▲" : "●"} ${a.text}`),
    ttf: ttfHeadline?.price ?? null,
  };

  return (
    <Shell ready>
      <span hidden data-newsletter-metadata={JSON.stringify(metadata)} />

      <section data-shot="glance" className="rounded-lg border bg-card p-4">
        <div className="text-[12px] font-semibold tracking-[2px] text-[var(--flow)] uppercase">
          Serbia gas daily
        </div>
        <h1 className="mt-1 text-[22px] font-semibold leading-tight">{longDay(today)}</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Flows for gas day {flowDay ? longDay(flowDay) : "—"}
          {!flowPick.complete && flowDay ? " (incomplete)" : ""} · demand forecast for{" "}
          {longDay(deliveryDay)}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Kpi
            label="Net into Serbia"
            value={n1(net.net)}
            unit="mcm/d"
            delta={net.change}
            deltaLabel="vs 7d avg"
          />
          <Kpi
            label="Demand D+1"
            value={ok(d1Temp) ? n1(d1?.demand_mcm) : "—"}
            unit="mcm/d"
            foot={ok(d1Temp) ? `${n1(d1Temp)} °C Belgrade` : "no temperature"}
          />
          <Kpi
            label="Net D+1 (est.)"
            value={n1(expectD1.net)}
            unit="mcm/d"
            foot={
              ok(expectD1.kkdBooked)
                ? `KKD1 ${n2(expectD1.kkdBooked)} · BG ${n1(expectD1.bgImplied)}`
                : "KKD1 RBP: not yet"
            }
          />
          <Kpi
            label={`TTF DA ${ttfHeadline?.date ? shortDay(ttfHeadline.date) : ""}`}
            value={n2(ttfHeadline?.price)}
            unit="€/MWh"
            delta={ttfRow?.change ?? null}
            deltaDigits={2}
          />
          <Kpi
            label={storageRs ? "RS storage" : "EU storage"}
            value={n1((storageRs ?? storageEu)?.full)}
            unit="% full"
            delta={(storageRs ?? storageEu)?.changeWeek ?? null}
            deltaLabel="pp w/w"
          />
        </div>
        {/* Alerts, summary and notes go into the email as text; the sender hides them in the
            screenshot so they are not shown twice. */}
        <div data-email-text>
          {flowDay && <AlertsBox alerts={alerts} />}
          {summary.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] leading-snug">
              {summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {(missing.length > 0 || awaiting.length > 0) && (
            <p className="mt-2 text-[12px] text-[var(--status-warning)]">
              {missing.length > 0 && `Unavailable at send time: ${missing.join(", ")}. `}
              {awaiting.length > 0 &&
                `No ${shortDay(deliveryDay)} day-ahead price yet: ${awaiting.join(", ")}.`}
            </p>
          )}
        </div>
      </section>

      <section data-shot="map-flows" className="overflow-hidden rounded-lg border bg-card">
        <div className="px-4 pt-4">
          <h2 className="text-[17px] font-semibold">
            Balkan physical flows · gas day {flowDay ?? "—"}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            ENTSOG physical flow, mcm/d · casing = firm technical capacity · tags: hub price €/MWh
            and country net position · grey dashed = nothing published
          </p>
        </div>
        {(regionalQ.isError || netQ.isError) && (
          <div className="px-4 pt-2">
            <Unavailable>
              {regionalQ.isError
                ? `Regional ENTSOG flows unavailable at send time (${(regionalQ.error as Error).message}); only Serbian points are drawn.`
                : "Country net positions were not ready at send time; net tags are left off."}
            </Unavailable>
          </div>
        )}
        <div className="pointer-events-none">
          <BalkanFlowMap
            values={values}
            selected={null}
            onSelect={noop}
            layers={MAP_LAYERS}
            colorFor={colorFor}
            formatValue={(v) => Math.abs(v).toFixed(1)}
            describe={nothing}
            countryBadges={countryBadges}
            netBadges={netBadges}
          />
        </div>
      </section>

      <Section
        shot="flows"
        title="Serbian border points"
        subtitle={`ENTSOG physical flow, gas day ${flowDay ?? "—"} vs the 7 days before · Booked = ENTSOG firm booked · Booked % = booked ÷ technical · Util. = flow ÷ technical · KKD1 split by saved MET nominations`}
      >
        <table className="w-full border-separate border-spacing-0 text-[13px] [&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-0 [&_th:first-child]:pl-0">
          <thead className="text-[11px] tracking-wide text-muted-foreground uppercase">
            <tr className="text-[10px]">
              <th />
              <th colSpan={3} className="border-b pb-1 text-center font-medium">
                Flow, mcm/d
              </th>
              <th className="w-3" />
              <th colSpan={4} className="border-b pb-1 text-center font-medium">
                Capacity, mcm/d
              </th>
            </tr>
            <tr className="whitespace-nowrap">
              <th className="py-1.5 text-left">Point</th>
              <th className="py-1.5 text-right">Gas day</th>
              <th className="py-1.5 text-right">7d avg</th>
              <th className="py-1.5 text-right">Δ</th>
              <th />
              <th className="py-1.5 text-right">Technical</th>
              <th className="py-1.5 text-right">Booked</th>
              <th className="py-1.5 text-right">Booked %</th>
              <th className="py-1.5 text-right">Util.</th>
            </tr>
          </thead>
          <tbody>
            {points.flatMap((p) => {
              const corridor = CORRIDORS.find((c) => c.point === p.point);
              const v = corridor ? values[corridor.id] : undefined;
              const util =
                ok(p.value) && ok(v?.technical) && v!.technical! > 0
                  ? (Math.abs(p.value) / v!.technical!) * 100
                  : null;
              const bookedPct =
                ok(v?.booked) && ok(v?.technical) && v!.technical! > 0
                  ? (v!.booked! / v!.technical!) * 100
                  : null;
              const cell = "num border-t py-2 text-right";
              const rows = [
                <tr key={p.point}>
                  <td className="border-t py-2 whitespace-nowrap">
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full"
                      style={{ background: POINT_COLORS[p.point] }}
                    />
                    {POINT_SHORT[p.point]}
                  </td>
                  <td className={`${cell} font-semibold`}>{n2(p.value)}</td>
                  <td className={cell}>{n2(p.avg7)}</td>
                  <td className={`${cell} ${tone(p.change)}`}>{signed(p.change, 2)}</td>
                  <td className="border-t" />
                  <td className={cell}>{n2(v?.technical)}</td>
                  <td className={cell}>{n2(v?.booked)}</td>
                  <td className={cell}>{pct(bookedPct)}</td>
                  <td className={`${cell} font-semibold`}>{pct(util)}</td>
                </tr>,
              ];
              if (p.point === "kiskundorozsma_hu") {
                for (const part of kkd1Split) {
                  rows.push(
                    <tr key={`kkd1-${part.key}`} className="text-muted-foreground">
                      <td className="py-1 pl-5 text-[12px]">↳ {part.label}</td>
                      <td className="num py-1 text-right text-foreground">{n2(part.value)}</td>
                      <td className="num py-1 text-right">{n2(part.avg7)}</td>
                      <td className={`num py-1 text-right ${tone(part.change)}`}>
                        {signed(part.change, 2)}
                      </td>
                      <td />
                      <td colSpan={4} className="py-1 text-[11px] italic">
                        {part.note}
                      </td>
                    </tr>,
                  );
                }
              }
              return rows;
            })}
            <tr className="font-semibold">
              <td className="border-t-2 py-2">Net into Serbia</td>
              <td className="num border-t-2 py-2 text-right">{n2(net.net)}</td>
              <td className="num border-t-2 py-2 text-right">{n2(net.avg7)}</td>
              <td className={`num border-t-2 py-2 text-right ${tone(net.change)}`}>
                {signed(net.change, 2)}
              </td>
              <td
                colSpan={5}
                className="border-t-2 py-2 text-[11px] font-normal text-muted-foreground"
              >
                entry − Horgoš exit − Bosnia (model)
              </td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 h-[220px]">
          <FlowTrend flows={pastFlows} />
        </div>
        <RegionalMovers values={values} regional={regional} flowDay={flowDay} />
      </Section>

      <Section
        shot="prices"
        title="Day-ahead hub prices"
        subtitle={`€/MWh by delivery day · every hub on the same days · Δ = ${shortDay(deliveryDay)} − ${shortDay(today)} · spread vs TTF on the same delivery day`}
      >
        {pricesQ.isError ? (
          <Unavailable>Prices unavailable: {String(pricesQ.error)}</Unavailable>
        ) : (
          <PriceTable rows={priceDays} hubs={hubs} today={today} deliveryDay={deliveryDay} />
        )}
        {priceChart.length > 1 && (
          <div className="mt-3 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={priceChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} minTickGap={24} />
                <YAxis tick={AXIS} width={40} domain={["auto", "auto"]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {HUB_ORDER.map((h) => (
                  <Line
                    key={h}
                    dataKey={h}
                    name={h}
                    stroke={HUB_COLORS[h]}
                    strokeWidth={h === "TTF" ? 2.5 : 1.8}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {(["TTF", "CEGH"] as const)
          .filter((h) => hubs?.[h]?.status === "live" && hubs[h]!.reason)
          .map((h) => (
            <p key={h} className="mt-1 text-[11px] text-muted-foreground">
              {h}: {hubs![h]!.reason}.
            </p>
          ))}
      </Section>

      <Section
        shot="arbitrage"
        title="Regional Arbitrage & Transport Economics"
        subtitle={`€/MWh for delivery ${arbDay} · daily firm capacity at reserve prices, full utilisation · BGH and CEEGEX day-ahead only, same delivery day · BGH = running VWAP of trades so far (trading for a delivery day closes ~02:00 CET; DA delivers on the next Bulgarian business day) · capacity availability not checked: results are indicative`}
      >
        <ArbitrageTable results={arb} />
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Tariffs 2026/27: Bulgartransgaz calculator, Gastrans decision 05-131 (17.07.2026), FGSZ /
          MEKH H2021/2026, AERS common Transportgas tariff (28.05.2026). Gastrans fuel = X1{" "}
          {(GASTRANS_FUEL.x1 * 100).toFixed(2)}% in kind (ESTIMATED method).{" "}
          {fxQ.data?.fx
            ? `FX: BNR fixing ${fxQ.data.fx.date} (EUR/HUF ${fxQ.data.fx.hufPerEur?.toFixed(2) ?? "—"}, EUR/RSD ${fxQ.data.fx.rsdPerEur?.toFixed(2) ?? "—"}).`
            : `FX unavailable${fxQ.data?.error ? `: ${fxQ.data.error}` : ""} — HUF/RSD legs not converted.`}{" "}
          Delivered into Serbia = up to the Transportgas entry, excluding the domestic exit charge.
        </p>
      </Section>

      <Section
        shot="balance"
        title="Serbian demand, temperature and supply"
        subtitle="mcm/d · stacked areas = supply by source (ENTSOG allocation; HU entry split by saved MET nominations; BD storage implied = model demand − other sources, within storage limits, no published data) · lines = demand from Belgrade temperature (workbook regression), dashed = forecast"
      >
        {tempsQ.data?.error && <Unavailable>{tempsQ.data.error}</Unavailable>}
        <div className="h-[260px]">
          <BalanceChart balance={balance} today={today} nominations={nomByDay} />
        </div>
        <SourceMixTable balance={balance} nominations={nomByDay} maxDay={flowDay} />
        <ForecastTable balance={balance} today={today} />
      </Section>

      <Section
        shot="hu-storage"
        title="Srbijagas storage balance in Hungary"
        subtitle={`End-of-gas-day stock, mcm · ${HU_STORAGE_NOTE}`}
      >
        {huStorage.error && <Unavailable>{huStorage.error}</Unavailable>}
        {huStorage.rows.length > 0 && <HuStoragePanel rows={huStorage.rows} compact height={240} />}
      </Section>

      <Section
        shot="capacity"
        title="Capacity and bookings"
        subtitle={`Firm technical vs firm booked capacity (ENTSOG), mcm/d, gas day ${flowDay ?? "—"} · RBP auction allocations for ${shortDay(today)} and ${shortDay(deliveryDay)}`}
      >
        <CapacityTable
          values={values}
          rbp={rbpQ.data?.points ?? []}
          today={today}
          deliveryDay={deliveryDay}
          history={pipeHistory}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Pipe = last {pipeHistory.length} gas days: filled area = flow, pipe height = firm
          technical capacity (dashed line where technical changed).
        </p>
        {rbpQ.isError && (
          <div className="mt-2">
            <Unavailable>RBP bookings unavailable.</Unavailable>
          </div>
        )}
        {rbpQ.data && !rbpQ.data.allocationPublished && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            RBP published no allocation figures for the closed auctions in this window.
          </p>
        )}
      </Section>

      <Section
        shot="storage"
        title="Gas storage (AGSI+)"
        subtitle="Latest published gas day · Δ = percentage points vs one week earlier · net = injection − withdrawal, GWh/d"
      >
        <StorageTable rows={storage} />
      </Section>

      <p className="px-1 text-[11px] text-muted-foreground">
        Sources: ENTSOG Transparency Platform, RBP, GIE AGSI+, EEX, CEGH, Balkan Gas Hub, CEEGEX,
        HEnEx, BRM, Open-Meteo. Bosnia flow is modelled ({Math.round(BIH_SHARE * 100)}% share), not
        metered. Missing values are never filled in. 1 mcm = {CONVERSION_MCM_TO_GWH} GWh.
      </p>
    </Shell>
  );
}

function Kpi({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  deltaDigits = 1,
  foot,
}: {
  label: string;
  value: string;
  unit: string;
  delta?: number | null;
  deltaLabel?: string;
  deltaDigits?: number;
  foot?: string;
}) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="num mt-0.5 text-[20px] font-semibold leading-tight">
        {value} <span className="text-[12px] font-normal text-muted-foreground">{unit}</span>
      </div>
      <div
        className={`num text-[12px] ${delta !== undefined ? tone(delta) : "text-muted-foreground"}`}
      >
        {delta !== undefined
          ? `${signed(delta, deltaDigits)} ${deltaLabel ?? "d/d"}`
          : (foot ?? "")}
      </div>
    </div>
  );
}

function FlowTrend({
  flows,
}: {
  flows: Array<
    { date: string } & Record<FlowPointName, number> & {
        published_points?: FlowPointName[];
        point_source?: Partial<Record<FlowPointName, string>>;
      }
  >;
}) {
  const data = flows.map((r) => {
    const row: Record<string, number | string | null> = { date: r.date };
    for (const p of Object.keys(POINT_LABEL) as FlowPointName[]) {
      row[p] =
        r.point_source?.[p] === "physical_flow" ||
        (!r.point_source && (!r.published_points || r.published_points.includes(p)))
          ? r[p]
          : null;
    }
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} minTickGap={24} />
        <YAxis tick={AXIS} width={40} />
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          formatter={(v: string) => POINT_LABEL[v as FlowPointName] ?? v}
        />
        {(Object.keys(POINT_LABEL) as FlowPointName[]).map((p) => (
          <Line
            key={p}
            dataKey={p}
            stroke={POINT_COLORS[p]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function RegionalMovers({
  values,
  regional,
  flowDay,
}: {
  values: ReturnType<typeof buildLinkValues>;
  regional: Record<string, { days: Array<{ date: string; net: number | null }> }> | null;
  flowDay: string | null;
}) {
  if (!regional || !flowDay) return null;
  const from = addDaysISO(flowDay, -7);
  const rows = CORRIDORS.filter((c) => c.group === "regional")
    .map((c) => {
      const v = values[c.id]?.value ?? null;
      const hist = (regional[c.id]?.days ?? [])
        .filter((d) => d.date >= from && d.date < flowDay && d.net !== null)
        .map((d) => d.net as number);
      const avg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
      return { c, v, avg, change: ok(v) && ok(avg) ? v - avg : null };
    })
    .filter((r) => ok(r.v))
    .sort((a, b) => Math.abs(b.v!) - Math.abs(a.v!))
    .slice(0, 10);
  if (!rows.length) return null;
  return (
    <div className="mt-4">
      <h3 className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
        Largest regional corridors · same gas day
      </h3>
      <table className="mt-1 w-full text-[13px]">
        <tbody className="num">
          {rows.map((r) => (
            <tr key={r.c.id} className="border-t">
              <td className="py-1">
                {r.c.name}{" "}
                <span className="text-[11px] text-muted-foreground">
                  {r.v! < 0 ? `${r.c.to}→${r.c.from}` : `${r.c.from}→${r.c.to}`}
                </span>
              </td>
              <td className="py-1 text-right font-semibold">{n2(Math.abs(r.v!))}</td>
              <td className="py-1 text-right text-muted-foreground">
                avg {n2(ok(r.avg) ? Math.abs(r.avg) : null)}
              </td>
              <td className={`py-1 text-right ${tone(r.change)}`}>{signed(r.change, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function latestPricePoint(h: HubPrices | undefined) {
  const list = (h?.points ?? [])
    .filter((p) => p.date)
    .sort((a, b) => a.date!.localeCompare(b.date!));
  return list.at(-1) ?? null;
}

function buildCountryBadges(hubs: Record<HubId, HubPrices> | null): Record<string, CountryBadge> {
  const out: Record<string, CountryBadge> = {};
  for (const [country, pricing] of Object.entries(COUNTRY_PRICING)) {
    const own = pricing.hub ? latestPricePoint(hubs?.[pricing.hub]) : null;
    if (pricing.hub && own) {
      out[country] = { text: `${pricing.hub} ${own.price.toFixed(2)}`, tone: "price" };
      continue;
    }
    const ref = (pricing.reference ?? [])
      .map((id) => ({ id, p: latestPricePoint(hubs?.[id]) }))
      .find((r) => r.p);
    out[country] = ref?.p
      ? { text: `ref ${ref.id} ${ref.p.price.toFixed(2)}`, tone: "ref" }
      : { text: pricing.hub ? `${pricing.hub} · no feed` : "no hub", tone: "none" };
  }
  return out;
}

function PriceTable({
  rows,
  hubs,
  today,
  deliveryDay,
}: {
  rows: PriceDayRow[];
  hubs: Record<HubId, HubPrices> | null;
  today: string;
  deliveryDay: string;
}) {
  const cell = (p: PriceDayRow["a"], h: HubPrices | undefined, running = false) => {
    if (p)
      return (
        <>
          {n2(p.price)}
          {(running || !p.final) && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              {running ? "so far" : "prov."}
            </span>
          )}
        </>
      );
    const label = h?.status === "unavailable" || h?.status === "error" ? "no feed" : "pending";
    return <span className="text-[11px] font-normal text-muted-foreground">{label}</span>;
  };
  const notes = rows
    .map((r) => ({ r, h: hubs?.[r.hub as HubId] }))
    .filter(({ r, h }) => !r.a && !r.b && h?.reason)
    .map(({ r, h }) => `${r.hub}: ${h!.reason}`);
  return (
    <>
      <table className="w-full text-[13px]">
        <thead className="text-left text-[11px] tracking-wide whitespace-nowrap text-muted-foreground uppercase">
          <tr>
            <th className="py-1">Hub</th>
            <th className="py-1 text-right">{shortDay(today)}</th>
            <th className="py-1 text-right">{shortDay(deliveryDay)}</th>
            <th className="py-1 text-right">Δ</th>
            <th className="py-1 text-right">vs TTF</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map((r) => {
            const h = hubs?.[r.hub as HubId];
            return (
              <tr key={r.hub} className="border-t">
                <td className="py-1.5">
                  <span
                    className="mr-2 inline-block h-2 w-2 rounded-full"
                    style={{ background: HUB_COLORS[r.hub] }}
                  />
                  {HUBS[r.hub as HubId]?.name ?? r.hub}
                </td>
                <td className="py-1.5 text-right">{cell(r.a, h)}</td>
                <td className="py-1.5 text-right font-semibold">{cell(r.b, h, r.hub === "BGH")}</td>
                <td className={`py-1.5 text-right ${tone(r.change)}`}>{signed(r.change, 2)}</td>
                <td className="py-1.5 text-right">
                  {signed(r.spreadTtf, 2)}
                  {r.spreadDay && r.spreadDay !== deliveryDay && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      ({shortDay(r.spreadDay)})
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {notes.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">{notes.join(" · ")}</p>
      )}
    </>
  );
}

function AlertsBox({ alerts }: { alerts: Array<{ level: "high" | "watch"; text: string }> }) {
  if (!alerts.length)
    return (
      <p className="mt-3 rounded-md border border-[var(--status-ok,#22c55e)]/40 px-3 py-2 text-[13px] text-muted-foreground">
        <span className="font-semibold text-[var(--status-ok,#22c55e)]">No alerts</span> · nothing
        crossed the thresholds today.
      </p>
    );
  return (
    <div className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2">
      <div className="text-[11px] font-semibold tracking-wide text-amber-400 uppercase">Alerts</div>
      <ul className="mt-1 space-y-1 text-[13.5px] leading-snug">
        {alerts.map((a) => (
          <li key={a.text} className="flex gap-2">
            <span
              className={`mt-[5px] inline-block h-2 w-2 shrink-0 rounded-full ${a.level === "high" ? "bg-red-500" : "bg-amber-400"}`}
            />
            <span>{a.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small pipe: flow as a filled area inside a tube whose height is technical capacity. */
function FlowPipe({
  points,
}: {
  points: Array<{ date: string; flow: number | null; technical: number | null }>;
}) {
  const known = points.filter((p) => p.flow != null || p.technical != null);
  if (!known.length) return <span className="text-[11px] text-muted-foreground">—</span>;
  const max = Math.max(...known.map((p) => Math.max(p.flow ?? 0, p.technical ?? 0)), 0.01);
  const techs = known.map((p) => p.technical).filter((t): t is number => t != null);
  const techVaries = techs.length > 1 && Math.max(...techs) - Math.min(...techs) > max * 0.02;
  const last = known[known.length - 1];
  const util = last.flow != null && last.technical ? last.flow / last.technical : null;
  const color =
    util == null ? "#64748b" : util >= 0.9 ? "#ef4444" : util >= 0.6 ? "#f59e0b" : "#22c55e";
  return (
    <div
      className="relative h-[18px] w-[96px] overflow-hidden rounded-full border border-slate-500/70 bg-slate-800/60"
      title={`${known[0].date} → ${last.date}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={known} margin={{ top: 1, right: 0, bottom: 0, left: 0 }}>
          <YAxis hide domain={[0, max]} />
          <XAxis hide dataKey="date" />
          <Area
            type="monotone"
            dataKey="flow"
            stroke={color}
            strokeWidth={1}
            fill={color}
            fillOpacity={0.55}
            isAnimationActive={false}
            connectNulls={false}
          />
          {techVaries && (
            <Line
              type="stepAfter"
              dataKey="technical"
              stroke="#e2e8f0"
              strokeWidth={1}
              strokeDasharray="2 2"
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function CapacityTable({
  values,
  rbp,
  today,
  deliveryDay,
  history,
}: {
  values: ReturnType<typeof buildLinkValues>;
  rbp: Array<{
    corridor: string | null;
    label: string;
    days: Array<{ date: string; total: number; byProduct: Partial<Record<string, number>> }>;
  }>;
  today: string;
  deliveryDay: string;
  history: Array<{ date: string; values: ReturnType<typeof buildLinkValues> }>;
}) {
  const rbpFor = (id: string, date: string) => {
    const days = rbp
      .filter((p) => p.corridor === id)
      .flatMap((p) => p.days.filter((d) => d.date === date));
    // A day with no allocation in force is "nothing published", not a booked zero.
    const published = days.filter((d) => Object.keys(d.byProduct).length > 0);
    return published.length ? published.reduce((s, d) => s + d.total, 0) : null;
  };
  const ids = [
    ...CORRIDORS.filter((c) => c.group === "serbia" || c.group === "model").map((c) => c.id),
    ...CORRIDORS.filter((c) => c.group === "regional" && values[c.id]?.technical != null).map(
      (c) => c.id,
    ),
  ];
  const rows = ids
    .map((id) => ({ c: CORRIDOR_BY_ID[id], v: values[id] }))
    .filter((r) => r.c && (r.v?.technical != null || r.c.group === "serbia"));
  return (
    <table className="w-full text-[13px]">
      <thead className="text-left text-[11px] tracking-wide whitespace-nowrap text-muted-foreground uppercase">
        <tr className="text-[10px]">
          <th />
          <th />
          <th colSpan={4} className="border-b border-border/60 pb-0.5 pl-3 text-center">
            ENTSOG · mcm/d
          </th>
          <th colSpan={2} className="border-b border-border/60 pb-0.5 pl-3 text-center">
            RBP allocated
          </th>
        </tr>
        <tr>
          <th className="py-1">Corridor</th>
          <th className="px-2 py-1">Flow vs tech.</th>
          <th className="py-1 pl-3 text-right">Flow</th>
          <th className="py-1 pl-3 text-right">Tech.</th>
          <th className="py-1 pl-3 text-right">Booked</th>
          <th className="py-1 pl-3 text-right">Bkd %</th>
          <th className="py-1 pl-3 text-right">{shortDay(today)}</th>
          <th className="py-1 pl-3 text-right">{shortDay(deliveryDay)}</th>
        </tr>
      </thead>
      <tbody className="num">
        {rows.map(({ c, v }) => {
          const bookedPct =
            ok(v?.booked) && ok(v?.technical) && v!.technical! > 0
              ? (v!.booked! / v!.technical!) * 100
              : null;
          return (
            <tr
              key={c.id}
              className={`border-t ${c.group === "serbia" ? "" : "text-muted-foreground"}`}
            >
              <td className="py-1.5">
                <span className={c.group === "serbia" ? "text-foreground" : ""}>{c.name}</span>
                {(v?.capacityRef || v?.capacityDate) && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {v.capacityRef ? "(GY ref)" : `(cap. ${shortDay(v.capacityDate!)})`}
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <FlowPipe
                  points={history.map((h) => {
                    const hv = h.values[c.id];
                    return {
                      date: h.date,
                      flow: ok(hv?.value) ? Math.abs(hv!.value!) : null,
                      technical: ok(hv?.technical) ? hv!.technical! : null,
                    };
                  })}
                />
              </td>
              <td className="py-1.5 pl-3 text-right">
                {n2(ok(v?.value) ? Math.abs(v!.value!) : null)}
              </td>
              <td className="py-1.5 pl-3 text-right">{n2(v?.technical)}</td>
              <td className="py-1.5 pl-3 text-right">{n2(v?.booked)}</td>
              <td className="py-1.5 pl-3 text-right">{pct(bookedPct)}</td>
              <td className="py-1.5 pl-3 text-right">{n2(rbpFor(c.id, today))}</td>
              <td className="py-1.5 pl-3 text-right">{n2(rbpFor(c.id, deliveryDay))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type BalanceRows = ReturnType<typeof buildBalance>;

const SOURCE_SERIES = [
  { key: "domestic", name: "Domestic production", color: "#5f86a8" },
  { key: "ru", name: "RU gas (BG route: Kireevo net + Kalotina)", color: PALETTE.bgImport },
  { key: "huMet", name: "HU storage · MET", color: PALETTE.huMet },
  { key: "huOthers", name: "HU storage · Others", color: PALETTE.huOthers },
  { key: "bd", name: "BD storage (implied)", color: "#94a3b8" },
] as const;

/** Supply by source for one gas day; null when the day has no complete allocation supply. */
function sourceMix(b: BalanceRows[number], nominations: Map<string, number>) {
  if (!b.supply_available || b.is_forecast) return null;
  const hu = splitHungaryEntry(b.kiskundorozsma_entry_mcm, nominations.get(b.date) ?? null);
  return {
    domestic: b.domestic_production_mcm,
    ru: b.imports_from_bulgaria_available_mcm + b.kalotina_entry_mcm,
    huMet: hu.metMcm ?? 0,
    huOthers: hu.othersMcm ?? 0,
    // Banatski Dvor has no published daily data: the model withdrawal that closes
    // demand − supply within the storage limits.
    bd: b.storage_withdrawal_mcm,
    injection: b.storage_injection_mcm,
  };
}

function BalanceChart({
  balance,
  today,
  nominations,
}: {
  balance: BalanceRows;
  today: string;
  nominations: Map<string, number>;
}) {
  const data = balance.map((b) => {
    const hasTemp = ok(b.avg_temperature_c ?? b.temperature_c);
    const mix = sourceMix(b, nominations);
    return {
      date: b.date,
      domestic: mix?.domestic ?? null,
      ru: mix?.ru ?? null,
      huMet: mix?.huMet ?? null,
      huOthers: mix?.huOthers ?? null,
      bd: mix?.bd ?? null,
      demandActual: b.is_forecast || !hasTemp ? null : b.demand_mcm,
      demandForecast: hasTemp && (b.is_forecast || b.date === today) ? b.demand_mcm : null,
      temp: b.avg_temperature_c ?? b.temperature_c,
    };
  });
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} minTickGap={20} />
        <YAxis yAxisId="m" tick={AXIS} width={36} />
        <YAxis yAxisId="t" orientation="right" tick={AXIS} width={32} unit="°" />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine yAxisId="m" x={today} stroke={PALETTE.today} strokeDasharray="3 3" />
        {SOURCE_SERIES.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            yAxisId="m"
            dataKey={s.key}
            name={s.name}
            stackId="supply"
            stroke={s.color}
            strokeWidth={1}
            fill={s.color}
            fillOpacity={0.7}
            isAnimationActive={false}
          />
        ))}
        <Line
          yAxisId="m"
          dataKey="demandActual"
          name="Demand (model)"
          stroke={PALETTE.demand}
          strokeWidth={2.2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="m"
          dataKey="demandForecast"
          name="Demand forecast"
          stroke={PALETTE.demand}
          strokeWidth={2.2}
          strokeDasharray="5 4"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="t"
          dataKey="temp"
          name="Temperature °C"
          stroke={PALETTE.temp}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Source composition of the newest gas day with complete supply: mcm/d and share. */
function SourceMixTable({
  balance,
  nominations,
  maxDay,
}: {
  balance: BalanceRows;
  nominations: Map<string, number>;
  /** Newest gas day to show: the newsletter's flow day, so every section is the same day. */
  maxDay: string | null;
}) {
  const row = [...balance]
    .reverse()
    .find((b) => (!maxDay || b.date <= maxDay) && sourceMix(b, nominations));
  if (!row) return null;
  const mix = sourceMix(row, nominations)!;
  const total = SOURCE_SERIES.reduce((sum, s) => sum + (mix[s.key] ?? 0), 0);
  return (
    <div className="mt-3">
      <h3 className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
        Source composition · gas day {row.date}
      </h3>
      <table className="mt-1 w-full text-[13px]">
        <tbody className="num">
          {SOURCE_SERIES.map((s) => (
            <tr key={s.key} className="border-t">
              <td className="py-1">
                <span
                  className="mr-2 inline-block h-2 w-2 rounded-full"
                  style={{ background: s.color }}
                />
                {s.name}
              </td>
              <td className="py-1 text-right font-semibold">{n2(mix[s.key])}</td>
              <td className="py-1 text-right text-muted-foreground">
                {total > 0 ? `${((mix[s.key] / total) * 100).toFixed(1)}%` : "—"}
              </td>
            </tr>
          ))}
          <tr className="border-t font-semibold">
            <td className="py-1">Total supply = demand (model)</td>
            <td className="py-1 text-right">{n2(total)}</td>
            <td />
          </tr>
          {mix.injection > 0 && (
            <tr className="text-muted-foreground">
              <td className="py-1 text-[12px]">BD injection (implied surplus)</td>
              <td className="py-1 text-right">{n2(mix.injection)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ForecastTable({
  balance,
  today,
}: {
  balance: ReturnType<typeof buildBalance>;
  today: string;
}) {
  const rows = balance.filter((b) => b.date >= today).slice(0, FUTURE_DAYS + 1);
  if (!rows.length) return null;
  return (
    <table className="mt-3 w-full text-[13px]">
      <thead className="text-left text-[11px] tracking-wide whitespace-nowrap text-muted-foreground uppercase">
        <tr>
          <th className="py-1">Gas day</th>
          {rows.map((b) => (
            <th key={b.date} className="py-1 text-right">
              {b.date === today ? "Today" : shortDay(b.date)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="num">
        <tr className="border-t">
          <td className="py-1.5 text-muted-foreground">Temp. °C</td>
          {rows.map((b) => (
            <td key={b.date} className="py-1.5 text-right">
              {n1(b.avg_temperature_c ?? b.temperature_c)}
            </td>
          ))}
        </tr>
        <tr className="border-t">
          <td className="py-1.5 text-muted-foreground">Demand mcm/d</td>
          {rows.map((b) => (
            <td key={b.date} className="py-1.5 text-right font-semibold">
              {ok(b.avg_temperature_c ?? b.temperature_c) ? n1(b.demand_mcm) : "—"}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function StorageTable({
  rows,
}: {
  rows: Array<{ code: string; label: string; row: StorageRow | null; error?: string }>;
}) {
  if (!rows.length) return <Unavailable>AGSI storage unavailable.</Unavailable>;
  const keyMissing = rows.every((r) => r.error === "AGSI_API_KEY not set");
  if (keyMissing) return <Unavailable>AGSI storage needs AGSI_API_KEY on the server.</Unavailable>;
  return (
    <table className="w-full text-[13px]">
      <thead className="text-left text-[11px] tracking-wide whitespace-nowrap text-muted-foreground uppercase">
        <tr>
          <th className="py-1">Country</th>
          <th className="py-1">Gas day</th>
          <th className="py-1 text-right">Full</th>
          <th className="py-1 text-right">Δ w/w</th>
          <th className="py-1 text-right">In storage TWh</th>
          <th className="py-1 text-right">Net GWh/d</th>
        </tr>
      </thead>
      <tbody className="num">
        {rows.map(({ code, label, row }) => (
          <tr key={code} className={`border-t ${code === "rs" ? "font-semibold" : ""}`}>
            <td className="py-1.5">{label}</td>
            <td className="py-1.5 text-muted-foreground">
              {row?.date ? shortDay(row.date) : code === "rs" ? "not on AGSI+" : "—"}
            </td>
            <td className="py-1.5 text-right">
              {row?.full != null ? `${row.full.toFixed(1)}%` : "—"}
            </td>
            <td className={`py-1.5 text-right ${tone(row?.changeWeek)}`}>
              {signed(row?.changeWeek)}
            </td>
            <td className="py-1.5 text-right">{n2(row?.gasInStorage)}</td>
            <td className={`py-1.5 text-right ${tone(row?.netInjection)}`}>
              {signed(row?.netInjection, 0)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const STATUS_TONE: Record<string, string> = {
  VERIFIED: "text-[var(--status-good)]",
  ESTIMATED: "text-[var(--status-warning)]",
  STALE: "text-[var(--status-warning)]",
  UNAVAILABLE: "text-muted-foreground",
};

function ArbitrageTable({ results }: { results: RouteResult[] }) {
  const transit = results.filter((r) => r.route.destination);
  const landed = results.filter((r) => !r.route.destination);
  const th = "py-1.5 px-1.5 text-right font-medium";
  const td = "num py-1.5 px-1.5 text-right";
  const price = (x: RouteResult["origin"]) =>
    x ? (
      <>
        {n2(x.price)}
        {!x.final && <span className="ml-0.5 text-[9px] text-muted-foreground">p</span>}
      </>
    ) : (
      <span className="text-[11px] text-muted-foreground">n/a</span>
    );
  return (
    <table className="w-full border-separate border-spacing-0 text-[12px]">
      <thead className="text-[10px] tracking-wide text-muted-foreground uppercase">
        <tr className="whitespace-nowrap">
          <th className="py-1.5 pr-1.5 text-left font-medium">Route</th>
          <th className={th}>Origin</th>
          <th className={th}>Dest.</th>
          <th className={th}>Gross</th>
          <th className={th}>Capacity</th>
          <th className={th}>Fuel</th>
          <th className={th}>Fees</th>
          <th className={th}>Transport</th>
          <th className={th}>Delivered</th>
          <th className={th}>Net</th>
          <th className="py-1.5 pl-1.5 text-left font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td
            colSpan={11}
            className="border-t pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Transit BG ↔ HU through Serbia
          </td>
        </tr>
        {transit.map((r) => (
          <tr key={r.route.id}>
            <td className="border-t py-1.5 pr-1.5">{r.route.short}</td>
            <td className={`${td} border-t`}>{price(r.origin)}</td>
            <td className={`${td} border-t`}>{price(r.destination)}</td>
            <td className={`${td} border-t ${tone(r.gross)}`}>{signed(r.gross, 2)}</td>
            <td className={`${td} border-t`}>{n2(r.capacityCost)}</td>
            <td className={`${td} border-t`}>{n2(r.fuelCost)}</td>
            <td className={`${td} border-t`}>{n2(r.otherFees)}</td>
            <td className={`${td} border-t font-semibold`}>{n2(r.transportCost)}</td>
            <td className={`${td} border-t`}>{n2(r.delivered)}</td>
            <td className={`${td} border-t font-semibold ${tone(r.netMargin)}`}>
              {signed(r.netMargin, 2)}
            </td>
            <td className={`border-t py-1.5 pl-1.5 text-[10px] ${STATUS_TONE[r.status]}`}>
              {r.status}
            </td>
          </tr>
        ))}
        <tr>
          <td
            colSpan={11}
            className="border-t pt-3 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Delivered into Serbia (no Serbian hub price)
          </td>
        </tr>
        {landed.map((r) => (
          <tr key={r.route.id}>
            <td className="border-t py-1.5 pr-1.5">{r.route.short}</td>
            <td className={`${td} border-t`}>{price(r.origin)}</td>
            <td className={`${td} border-t text-muted-foreground`}>—</td>
            <td className={`${td} border-t text-muted-foreground`}>—</td>
            <td className={`${td} border-t`}>{n2(r.capacityCost)}</td>
            <td className={`${td} border-t`}>{n2(r.fuelCost)}</td>
            <td className={`${td} border-t`}>{n2(r.otherFees)}</td>
            <td className={`${td} border-t font-semibold`}>{n2(r.transportCost)}</td>
            <td className={`${td} border-t font-semibold`}>{n2(r.delivered)}</td>
            <td className={`${td} border-t text-muted-foreground`}>—</td>
            <td className={`border-t py-1.5 pl-1.5 text-[10px] ${STATUS_TONE[r.status]}`}>
              {r.status}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
