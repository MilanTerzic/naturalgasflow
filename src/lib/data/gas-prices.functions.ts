// Public gas spot prices for the Balkan map. No API keys: only public files / pages.
//   TTF  — EEX Neutral Gas Price CSVs (final 60-day history + 15-minute current file)
//   CEGH — CEGHIX day-ahead table on the CEGH homepage
// Every hub reports its own status; a failed or changed source never produces a number.
import { createServerFn } from "@tanstack/react-start";
import { HUBS, type HubId } from "@/lib/prices/hubs";
import { parseCeghDayAhead, parseEexNgpCsv, type PricePoint } from "@/lib/prices/parsers";
import {
  BACKFILL_DAYS,
  EXCHANGE_MARKETS,
  runProvider,
  summarise,
  type ExchangeSummary,
} from "@/lib/prices/exchanges/run";
import {
  MARKET_META,
  addDays,
  dedupeObservations,
  expectedTradingDate,
  localNow,
  type ExchangeMarket,
  type GasPriceObservation,
  type ProviderResult,
} from "@/lib/prices/exchanges/types";

export type PriceStatus = "live" | "cache" | "stale" | "error" | "unavailable";

export interface HubPrices {
  hub: HubId;
  status: PriceStatus;
  reason?: string;
  /** Ascending by date. €/MWh. */
  points: PricePoint[];
  fetchedAt: string;
  sourceUrl: string;
  /** Exchange feeds (BGH, CEEGEX, HEnEx, BRM): benchmark, delivery day, volume, freshness. */
  exchange?: ExchangeSummary;
}

export interface GasPricesResponse {
  hubs: Record<HubId, HubPrices>;
  fetchedAt: string;
  /** Where exchange observations are kept: the database, or this server's memory only. */
  storage: { mode: "database" | "memory"; note?: string };
}

const TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const cache = new Map<HubId, { at: number; res: HubPrices }>();

const EEX_HISTORY = "https://gasandregistry.eex.com/Gas/NGP/TTF_NGP_60_Days.csv";
const EEX_CURRENT = "https://gasandregistry.eex.com/Gas/NGP/TTF_NGP_15_Mins.csv";
const CEGH_HOME = "https://www.cegh.at/";

async function getText(url: string, referer: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SerbiaGasDashboard/1.0)",
        accept: "text/csv,text/html,application/xhtml+xml,*/*",
        referer,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function belgradeToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(new Date());
}

async function withCache(
  hub: HubId,
  load: () => Promise<PricePoint[]>,
  sourceUrl: string,
): Promise<HubPrices> {
  const cached = cache.get(hub);
  if (cached && Date.now() - cached.at < TTL_MS) return { ...cached.res, status: "cache" };
  try {
    const points = await load();
    if (!points.length)
      throw new Error("source answered but no prices could be read (format may have changed)");
    const res: HubPrices = {
      hub,
      status: "live",
      points,
      fetchedAt: new Date().toISOString(),
      sourceUrl,
    };
    cache.set(hub, { at: Date.now(), res });
    return res;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "request failed";
    console.warn(`[gas-prices] ${hub}: ${reason}`);
    if (cached)
      return { ...cached.res, status: "stale", reason: `Last good fetch kept: ${reason}` };
    return {
      hub,
      status: "error",
      reason,
      points: [],
      fetchedAt: new Date().toISOString(),
      sourceUrl,
    };
  }
}

async function loadTtf(): Promise<PricePoint[]> {
  const [history, current] = await Promise.allSettled([
    getText(EEX_HISTORY, "https://www.eex.com/"),
    getText(EEX_CURRENT, "https://www.eex.com/"),
  ]);
  const finals = history.status === "fulfilled" ? parseEexNgpCsv(history.value, true) : [];
  const provisional = current.status === "fulfilled" ? parseEexNgpCsv(current.value, false) : [];
  // Final prices win; the 15-minute file only adds days without a final value yet.
  const byDate = new Map<string, PricePoint>();
  for (const p of provisional) if (p.date) byDate.set(p.date, p);
  for (const p of finals) if (p.date) byDate.set(p.date, p);
  if (!byDate.size && history.status === "rejected") throw history.reason;
  return [...byDate.values()].sort((a, b) => (a.date! < b.date! ? -1 : 1));
}

async function loadCegh(): Promise<PricePoint[]> {
  return parseCeghDayAhead(await getText(CEGH_HOME, CEGH_HOME), belgradeToday());
}

// ------------------------------------------------------------------ exchange feeds

/** In-memory fallback when the database is not available (migration not applied, no session). */
const memObservations = new Map<string, GasPriceObservation>();
const memStatus = new Map<
  ExchangeMarket,
  { at: string; lastSuccessAt: string | null; result: ProviderResult }
>();

/**
 * When a market is due for a new fetch. Before today's publication time, or once today's
 * data is in, check rarely; while the expected day is missing, retry every few minutes.
 */
export function nextFetchDue(
  market: ExchangeMarket,
  lastAttemptAt: string | null,
  newestTradingDate: string | null,
  at: Date = new Date(),
): number {
  if (!lastAttemptAt) return 0;
  const meta = MARKET_META[market];
  const last = Date.parse(lastAttemptAt);
  const haveExpected =
    newestTradingDate !== null && newestTradingDate >= expectedTradingDate(meta, at);
  // Markets blocked by licence/registration are re-checked twice a day only.
  const blocked = memStatus.get(market)?.result.status === "LICENCE_REQUIRED";
  const minutes = haveExpected || blocked ? 6 * 60 : meta.retryMinutes;
  return last + minutes * 60_000;
}

async function sessionAllowsDatabase(): Promise<boolean> {
  try {
    const { useAppSession: readAppSession } = await import("@/lib/auth-session.server");
    const session = await readAppSession();
    return session.data.authenticated === true;
  } catch {
    return false;
  }
}

async function loadExchanges(force: boolean): Promise<{
  summaries: Record<ExchangeMarket, ExchangeSummary>;
  storage: GasPricesResponse["storage"];
}> {
  const now = new Date();
  const since = addDays(localNow("Europe/Belgrade", now).date, -(BACKFILL_DAYS + 10));
  const store = await import("@/lib/prices/exchanges/store.server");
  let storage: GasPricesResponse["storage"] = { mode: "memory" };
  let stored: GasPriceObservation[] = [...memObservations.values()];
  let feed = new Map<
    ExchangeMarket,
    { at: string | null; lastSuccessAt: string | null; status?: string; message?: string | null }
  >();
  for (const [m, v] of memStatus) feed.set(m, { at: v.at, lastSuccessAt: v.lastSuccessAt });

  const dbAllowed = await sessionAllowsDatabase();
  if (dbAllowed) {
    const loaded = await store.loadObservations(since);
    if (loaded.ok) {
      storage = { mode: "database" };
      stored = dedupeObservations([...loaded.rows, ...stored]);
      const rows = await store.loadFeedStatus();
      feed = new Map(
        EXCHANGE_MARKETS.map((m) => {
          const r = rows.get(m);
          const mem = memStatus.get(m);
          const at = [r?.last_attempt_at, mem?.at].filter(Boolean).sort().at(-1) ?? null;
          return [
            m,
            {
              at,
              lastSuccessAt: r?.last_success_at ?? mem?.lastSuccessAt ?? null,
              status: r?.status,
              message: r?.message,
            },
          ];
        }),
      );
    } else {
      storage = { mode: "memory", note: `Database not used: ${loaded.reason}` };
    }
  } else {
    storage = { mode: "memory", note: "Not signed in: prices kept in server memory only." };
  }

  const newestTrading = (m: ExchangeMarket) =>
    stored
      .filter((o) => o.market === m)
      .map((o) => o.tradingDate)
      .sort()
      .at(-1) ?? null;
  const due = EXCHANGE_MARKETS.filter(
    (m) => force || Date.now() >= nextFetchDue(m, feed.get(m)?.at ?? null, newestTrading(m), now),
  );

  const henexStoredDates = new Set(
    stored.filter((o) => o.market === "HENEX" && o.metric === "HGSIDA").map((o) => o.tradingDate),
  );
  // Independent: one failing exchange never blocks the others.
  const results = await Promise.all(due.map((m) => runProvider(m, { henexStoredDates, at: now })));

  const fresh: GasPriceObservation[] = [];
  for (const r of results) {
    const prevSuccess = feed.get(r.market)?.lastSuccessAt ?? null;
    const lastSuccessAt = r.observations.length ? r.fetchedAt : prevSuccess;
    memStatus.set(r.market, { at: r.fetchedAt, lastSuccessAt, result: r });
    for (const o of r.observations)
      memObservations.set(
        `${o.market}|${o.product}|${o.metric}|${o.tradingDate}|${o.deliveryDate}`,
        o,
      );
    fresh.push(...r.observations);
    if (r.status !== "OK")
      console.warn(`[exchange-prices] ${r.market}: ${r.status} ${r.message ?? ""}`);
    if (storage.mode === "database") {
      const err = await store.saveResult(r, prevSuccess);
      if (err) storage = { mode: "database", note: `Last save failed: ${err}` };
    }
  }

  const all = dedupeObservations([...stored, ...fresh]);
  const summaries = {} as Record<ExchangeMarket, ExchangeSummary>;
  for (const m of EXCHANGE_MARKETS) {
    const mem = memStatus.get(m);
    const f = feed.get(m);
    const fetchState = mem
      ? {
          status: mem.result.status,
          message: mem.result.message,
          at: mem.at,
          lastSuccessAt: mem.lastSuccessAt,
          diagnostics: mem.result.diagnostics,
        }
      : {
          status: (f?.status as ProviderResult["status"]) ?? "NOT_PUBLISHED",
          message: f?.message ?? undefined,
          at: f?.at ?? null,
          lastSuccessAt: f?.lastSuccessAt ?? null,
        };
    summaries[m] = summarise(
      m,
      all.filter((o) => o.market === m),
      fetchState,
      now,
    );
  }
  return { summaries, storage };
}

function exchangeToHub(hub: HubId, s: ExchangeSummary): HubPrices {
  const status: PriceStatus =
    s.latest === null
      ? s.status === "LICENCE_REQUIRED"
        ? "unavailable"
        : "error"
      : s.status === "STALE"
        ? "stale"
        : "live";
  return {
    hub,
    status,
    reason: s.latest ? undefined : `${s.status}: ${s.message ?? ""}`.trim(),
    points: s.series.map((p) => ({
      date: p.deliveryDate,
      label: `${p.metric}${p.product !== "DA" && p.product !== "GLOBAL" ? ` ${p.product}` : ""}`,
      price: p.price,
      final: true,
    })),
    fetchedAt: s.lastAttemptAt ?? new Date().toISOString(),
    sourceUrl: s.sourceUrl ?? s.sourcePage,
    exchange: s,
  };
}

export const fetchGasPrices = createServerFn({ method: "GET" })
  .inputValidator((d: { force?: boolean } | undefined) => ({ force: d?.force === true }))
  .handler(async ({ data }): Promise<GasPricesResponse> => {
    const [ttf, cegh, ex] = await Promise.all([
      withCache("TTF", loadTtf, HUBS.TTF.url),
      withCache("CEGH", loadCegh, HUBS.CEGH.url),
      loadExchanges(data.force),
    ]);
    const now = new Date().toISOString();
    const none = (hub: HubId): HubPrices => ({
      hub,
      status: "unavailable",
      reason: HUBS[hub].reason,
      points: [],
      fetchedAt: now,
      sourceUrl: HUBS[hub].url,
    });
    return {
      fetchedAt: now,
      storage: ex.storage,
      hubs: {
        TTF: ttf,
        CEGH: cegh,
        BGH: exchangeToHub("BGH", ex.summaries.BGH),
        CEEGEX: exchangeToHub("CEEGEX", ex.summaries.CEEGEX),
        HENEX: exchangeToHub("HENEX", ex.summaries.HENEX),
        BRM: exchangeToHub("BRM", ex.summaries.BRM),
        EPIAS: none("EPIAS"),
      },
    };
  });
