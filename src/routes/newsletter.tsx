import { createFileRoute } from "@tanstack/react-router";
import { pageMetadata } from "@/lib/page-metadata";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import {
  Area,
  Bar,
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
  DOMESTIC_PRODUCTION_MCM,
  PALETTE,
} from "@/lib/gas/config";
import { buildBalance, dateRangeIso } from "@/lib/gas/demand";
import { splitHungaryEntry } from "@/lib/gas/met-nominations";
import type { FlowPointName } from "@/lib/gas/types";
import {
  checkNewsletterToken,
  listNewsletterMetNominations,
} from "@/lib/newsletter/newsletter.functions";
import {
  addDaysISO,
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

  const all = [flowsQ, allocQ, tempsQ, regionalQ, netQ, pricesQ, rbpQ, storageQ, nomsQ];
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
  const storageRs = storage.find((s) => s.code === "rs")?.row ?? null;
  // Serbia is usually absent from AGSI+; the EU aggregate is the fallback headline.
  const storageEu = storage.find((s) => s.code === "eu")?.row ?? null;
  const d1 = balance.find((b) => b.date === deliveryDay) ?? null;
  // The demand model needs a temperature; without one there is no forecast.
  const d1Temp = d1 ? (d1.avg_temperature_c ?? d1.temperature_c) : null;

  const summary = summarySentences({
    flowDay,
    flowComplete: flowPick.complete,
    net,
    points,
    deliveryDay,
    demandD1: d1 && ok(d1Temp) ? { demand: d1.demand_mcm, temperature: d1Temp } : null,
    today,
    priceDays,
    storageRs: storageRs ?? storageEu,
  });
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
  ].filter((x): x is string => !!x);

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
    missing,
    netIntoSerbia: net.net,
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
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
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
        subtitle={`ENTSOG physical flow, mcm/d · gas day ${flowDay ?? "—"} against the 7 days before · booked = ENTSOG firm booked capacity · util. = flow ÷ technical · KKD1 split by saved MET nominations`}
      >
        <table className="w-full text-[13px]">
          <thead className="text-left text-[11px] tracking-wide whitespace-nowrap text-muted-foreground uppercase">
            <tr>
              <th className="py-1">Point</th>
              <th className="py-1 text-right">Flow</th>
              <th className="py-1 text-right">7d avg</th>
              <th className="py-1 text-right">Δ</th>
              <th className="py-1 text-right">Tech. cap.</th>
              <th className="py-1 text-right">Booked</th>
              <th className="py-1 text-right">Booked %</th>
              <th className="py-1 text-right">Util.</th>
            </tr>
          </thead>
          <tbody className="num">
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
              const rows = [
                <tr key={p.point} className="border-t">
                  <td className="py-1.5">
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full"
                      style={{ background: POINT_COLORS[p.point] }}
                    />
                    {POINT_LABEL[p.point]}
                  </td>
                  <td className="py-1.5 text-right font-semibold">{n2(p.value)}</td>
                  <td className="py-1.5 text-right">{n2(p.avg7)}</td>
                  <td className={`py-1.5 text-right ${tone(p.change)}`}>{signed(p.change, 2)}</td>
                  <td className="py-1.5 text-right">{n2(v?.technical)}</td>
                  <td className="py-1.5 text-right">{n2(v?.booked)}</td>
                  <td className="py-1.5 text-right">{pct(bookedPct)}</td>
                  <td className="py-1.5 text-right">{pct(util)}</td>
                </tr>,
              ];
              if (p.point === "kiskundorozsma_hu") {
                for (const part of kkd1Split) {
                  rows.push(
                    <tr key={`kkd1-${part.key}`} className="text-muted-foreground">
                      <td className="py-1 pl-6 text-[12px]">↳ {part.label}</td>
                      <td className="py-1 text-right text-foreground">{n2(part.value)}</td>
                      <td className="py-1 text-right">{n2(part.avg7)}</td>
                      <td className={`py-1 text-right ${tone(part.change)}`}>
                        {signed(part.change, 2)}
                      </td>
                      <td colSpan={4} className="py-1 text-[11px]">
                        {part.note}
                      </td>
                    </tr>,
                  );
                }
              }
              return rows;
            })}
            <tr className="border-t font-semibold">
              <td className="py-1.5">Net into Serbia (entry − Horgoš − Bosnia model)</td>
              <td className="py-1.5 text-right">{n2(net.net)}</td>
              <td className="py-1.5 text-right">{n2(net.avg7)}</td>
              <td className={`py-1.5 text-right ${tone(net.change)}`}>{signed(net.change, 2)}</td>
              <td colSpan={4} />
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
        />
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
        shot="balance"
        title="Serbian demand, temperature and supply"
        subtitle="mcm/d · bars = supply by source (ENTSOG allocation; HU entry split by saved MET nominations; BD storage implied = model demand − other sources, within storage limits, no published data) · lines = demand from Belgrade temperature (workbook regression), dashed = forecast"
      >
        {tempsQ.data?.error && <Unavailable>{tempsQ.data.error}</Unavailable>}
        <div className="h-[260px]">
          <BalanceChart balance={balance} today={today} nominations={nomByDay} />
        </div>
        <SourceMixTable balance={balance} nominations={nomByDay} />
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
  const cell = (p: PriceDayRow["a"], h: HubPrices | undefined) => {
    if (p)
      return (
        <>
          {n2(p.price)}
          {!p.final && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">prov.</span>
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
                <td className="py-1.5 text-right font-semibold">{cell(r.b, h)}</td>
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

function CapacityTable({
  values,
  rbp,
  today,
  deliveryDay,
}: {
  values: ReturnType<typeof buildLinkValues>;
  rbp: Array<{
    corridor: string | null;
    label: string;
    days: Array<{ date: string; total: number; byProduct: Partial<Record<string, number>> }>;
  }>;
  today: string;
  deliveryDay: string;
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
        <tr>
          <th className="py-1">Corridor</th>
          <th className="py-1 text-right">Flow</th>
          <th className="py-1 text-right">Technical</th>
          <th className="py-1 text-right">Booked</th>
          <th className="py-1 text-right">Booked %</th>
          <th className="py-1 text-right">RBP {shortDay(today)}</th>
          <th className="py-1 text-right">RBP {shortDay(deliveryDay)}</th>
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
              <td className="py-1.5 text-right">{n2(ok(v?.value) ? Math.abs(v!.value!) : null)}</td>
              <td className="py-1.5 text-right">{n2(v?.technical)}</td>
              <td className="py-1.5 text-right">{n2(v?.booked)}</td>
              <td className="py-1.5 text-right">{pct(bookedPct)}</td>
              <td className="py-1.5 text-right">{n2(rbpFor(c.id, today))}</td>
              <td className="py-1.5 text-right">{n2(rbpFor(c.id, deliveryDay))}</td>
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
          <Bar
            key={s.key}
            yAxisId="m"
            dataKey={s.key}
            name={s.name}
            stackId="supply"
            fill={s.color}
            fillOpacity={0.85}
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
}: {
  balance: BalanceRows;
  nominations: Map<string, number>;
}) {
  const row = [...balance].reverse().find((b) => sourceMix(b, nominations));
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
