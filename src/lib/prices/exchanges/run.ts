// Runs the four exchange providers independently and summarises each market for the UI.
// Pure (no server imports): used by the server function and by scripts/refresh-prices.ts.

import { fetchBgh } from "./bgh";
import { fetchBrm } from "./brm";
import { fetchCeegex } from "./ceegex";
import { fetchHenex } from "./henex";
import {
  MARKET_META,
  addDays,
  benchmarkSeries,
  daysBetween,
  dedupeObservations,
  expectedTradingDate,
  type BenchmarkPoint,
  type ExchangeMarket,
  type GasPriceObservation,
  type ObservationStatus,
  type ProviderResult,
} from "./types";

export const EXCHANGE_MARKETS: ExchangeMarket[] = ["BGH", "CEEGEX", "HENEX", "BRM"];
export const BACKFILL_DAYS = 30;
/** HEnEx files fetched per run (one subrequest each); the rest are filled on later runs. */
export const HENEX_FILES_PER_RUN = 8;

/**
 * HEnEx trading dates to fetch: the expected newest day, then the most recent days in the
 * last 30 that are not stored yet (newest first), capped per run.
 */
export function henexDatesToFetch(stored: Set<string>, at: Date = new Date()): string[] {
  const newest = expectedTradingDate(MARKET_META.HENEX, at);
  const out: string[] = [newest];
  for (let i = 1; i < BACKFILL_DAYS && out.length < HENEX_FILES_PER_RUN; i++) {
    const d = addDays(newest, -i);
    if (!stored.has(d)) out.push(d);
  }
  return out;
}

export async function runProvider(
  market: ExchangeMarket,
  opts: { henexStoredDates?: Set<string>; at?: Date } = {},
): Promise<ProviderResult> {
  try {
    switch (market) {
      case "BGH":
        return await fetchBgh();
      case "CEEGEX":
        return await fetchCeegex();
      case "HENEX":
        return await fetchHenex(henexDatesToFetch(opts.henexStoredDates ?? new Set(), opts.at));
      case "BRM":
        return await fetchBrm();
    }
  } catch (err) {
    // A bug in one provider never affects the others.
    return {
      market,
      status: "PARSE_ERROR",
      message: err instanceof Error ? err.message : "provider failed",
      observations: [],
      sourceUrl: MARKET_META[market].sourcePage,
      fetchedAt: new Date().toISOString(),
      diagnostics: {},
    };
  }
}

export interface ExchangeSummary {
  market: ExchangeMarket;
  /** Status shown to the user (STALE when the newest verified price is behind schedule). */
  status: ObservationStatus;
  /** Status of the most recent fetch attempt. */
  fetchStatus: ObservationStatus;
  message?: string;
  latest: BenchmarkPoint | null;
  previous: BenchmarkPoint | null;
  /** Latest − previous, same metric only; null when not comparable. */
  change: number | null;
  series: BenchmarkPoint[];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  sourcePage: string;
  sourceUrl: string | null;
  licence?: string;
  /** Feed diagnostics as JSON text (serialisable across the server boundary). */
  diagnostics?: string;
}

/**
 * Builds the UI summary from all known observations (stored + just fetched).
 * Stale = newest verified trading day is more than one day behind the expected one
 * (two days covers weekends where exchanges trade weekend products on Friday).
 */
export function summarise(
  market: ExchangeMarket,
  observations: GasPriceObservation[],
  fetch: {
    status: ObservationStatus;
    message?: string;
    at: string | null;
    lastSuccessAt: string | null;
    diagnostics?: Record<string, unknown>;
  },
  at: Date = new Date(),
): ExchangeSummary {
  const meta = MARKET_META[market];
  const series = benchmarkSeries(dedupeObservations(observations), meta.benchmarks);
  const latest = series.at(-1) ?? null;
  const previous = latest
    ? ([...series]
        .reverse()
        .find((p) => p.deliveryDate < latest.deliveryDate && p.metric === latest.metric) ?? null)
    : null;
  let status: ObservationStatus = fetch.status;
  if (latest) {
    const behind = daysBetween(latest.tradingDate, expectedTradingDate(meta, at));
    const okish =
      fetch.status === "OK" || fetch.status === "NOT_PUBLISHED" || fetch.status === "NO_TRADES";
    status = behind > 3 || !okish ? "STALE" : "OK";
  }
  return {
    market,
    status,
    fetchStatus: fetch.status,
    message: fetch.message,
    latest,
    previous,
    change: latest && previous ? +(latest.price - previous.price).toFixed(3) : null,
    series: series.slice(-BACKFILL_DAYS - 5),
    lastAttemptAt: fetch.at,
    lastSuccessAt: fetch.lastSuccessAt,
    sourcePage: meta.sourcePage,
    sourceUrl:
      observations.find(
        (o) => o.deliveryDate === latest?.deliveryDate && o.metric === latest?.metric,
      )?.sourceUrl ?? null,
    licence: meta.licence,
    diagnostics: fetch.diagnostics ? JSON.stringify(fetch.diagnostics).slice(0, 4000) : undefined,
  };
}
