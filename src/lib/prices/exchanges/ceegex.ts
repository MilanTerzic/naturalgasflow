// CEEGEX (Hungary) — public "Daily data" page:
//   https://ceegex.hu/en/market-data/daily-data
// Published columns: Trading Day, Contract, Start of Delivery, End of Delivery,
// Traded Volume (MWh), Number of Trades, Volume Weighted Average Price (EUR/MWh), CEEREP,
// CEEREP Change (%). Parsed by header label. VWAP and CEEREP are kept as separate metrics.
// Delivery days come from the Start/End of Delivery columns only — the trading day is never
// assumed to be the delivery day. If the table is not in the server HTML (rendered by
// script), the provider reports PARSE_ERROR instead of guessing an endpoint.

import { fetchText } from "./http";
import { findHeader, htmlTables } from "./table";
import {
  MARKET_META,
  findDate,
  parseNum,
  parsePrice,
  validEurPrice,
  type GasPriceObservation,
  type ObservationStatus,
  type ProviderResult,
} from "./types";

export const CEEGEX_URL = "https://ceegex.hu/en/market-data/daily-data";

const COLUMNS = {
  tradingDay: { match: /^trading (day|date)/, required: true },
  contract: { match: /^contract|^product/, required: true },
  start: { match: /^start of delivery|^delivery start|^delivery from/ },
  end: { match: /^end of delivery|^delivery end|^delivery to/ },
  volume: { match: /^traded volume/ },
  trades: { match: /^number of trades|^trades/ },
  vwap: { match: /volume weighted average price|^vwap/, required: true },
  ceerep: { match: /^ceerep/, exclude: /change/ },
};

/** Normalises CEEGEX spot contract names. Intraday / within-day contracts return null. */
export function ceegexProduct(raw: string): string | null {
  const t = raw.toUpperCase().replace(/\s+/g, " ").trim();
  if (/WITHIN|INTRA|\bWD\b|\bID\b|HOUR/.test(t)) return null;
  if (/W\/?END|WEEKEND|\bWE\b/.test(t)) return "WE";
  if (/SATURDAY|\bSAT\b/.test(t)) return "SAT";
  if (/SUNDAY|\bSUN\b/.test(t)) return "SUN";
  if (/DAY.?AHEAD|\bDA\b/.test(t)) return "DA";
  if (/HOLIDAY|BANK/.test(t)) return "HOL";
  return null;
}

export function parseCeegexDaily(
  html: string,
  ctx: { sourceUrl: string; fetchedAt: string },
): {
  status: ObservationStatus;
  message?: string;
  observations: GasPriceObservation[];
  diagnostics: Record<string, unknown>;
} {
  const tables = htmlTables(html);
  let header = null;
  let rows: string[][] = [];
  for (const t of tables) {
    header = findHeader(t, COLUMNS, 5);
    if (header) {
      rows = t;
      break;
    }
  }
  if (!header) {
    return {
      status: "PARSE_ERROR",
      message:
        tables.length === 0
          ? "No data table in the server HTML (page renders it with script)"
          : "Daily data table found but its column labels changed",
      observations: [],
      diagnostics: { tables: tables.length, firstHeaders: tables.map((t) => t[0]).slice(0, 3) },
    };
  }
  const c = header.cols;
  const cell = (row: string[], k: keyof typeof COLUMNS) =>
    c[k] === undefined ? "" : (row[c[k]!] ?? "");
  const out: GasPriceObservation[] = [];
  let spotRows = 0;
  let noDelivery = 0;
  for (const row of rows.slice(header.headerRow + 1)) {
    const product = ceegexProduct(cell(row, "contract"));
    if (!product) continue;
    spotRows++;
    const tradingDate = findDate(cell(row, "tradingDay"));
    const start = findDate(cell(row, "start"));
    const end = findDate(cell(row, "end"));
    if (!tradingDate || !start) {
      noDelivery++;
      continue;
    }
    const volume = parseNum(cell(row, "volume"));
    const trades = parseNum(cell(row, "trades"));
    const base = {
      market: "CEEGEX" as const,
      country: "HU" as const,
      tradingDate,
      deliveryDate: start,
      ...(end && end > start ? { deliveryEndDate: end } : {}),
      product,
      volumeMwh: volume,
      trades,
      sourceUrl: ctx.sourceUrl,
      fetchedAt: ctx.fetchedAt,
      originalCurrency: "EUR",
      fxRate: null,
    };
    const vwap = parsePrice(cell(row, "vwap"));
    if (trades && volume && validEurPrice(vwap))
      out.push({ ...base, metric: "VWAP", priceEurMwh: vwap, originalPrice: vwap, status: "OK" });
    const ceerep = parsePrice(cell(row, "ceerep"));
    if (validEurPrice(ceerep))
      out.push({
        ...base,
        metric: "CEEREP",
        priceEurMwh: ceerep,
        originalPrice: ceerep,
        status: "OK",
      });
  }
  const diagnostics = {
    spotRows,
    rowsWithoutDeliveryDates: noDelivery,
    columnsMissing: header.missing,
  };
  if (out.length) return { status: "OK", observations: out, diagnostics };
  if (spotRows && noDelivery === spotRows)
    return {
      status: "PARSE_ERROR",
      message: "Spot rows have no readable delivery dates",
      observations: [],
      diagnostics,
    };
  return {
    status: spotRows ? "NO_TRADES" : "NOT_PUBLISHED",
    message: spotRows
      ? "Spot contracts listed without trades or reference price"
      : "No spot contracts in the table",
    observations: [],
    diagnostics,
  };
}

export async function fetchCeegex(): Promise<ProviderResult> {
  const fetchedAt = new Date().toISOString();
  const base = { market: "CEEGEX" as const, sourceUrl: CEEGEX_URL, fetchedAt };
  let html: string | null;
  try {
    html = await fetchText(CEEGEX_URL, { attempts: 3, timeoutMs: 20_000, accept: "text/html" });
  } catch (err) {
    return {
      ...base,
      status: "SOURCE_UNAVAILABLE",
      message: err instanceof Error ? err.message : "request failed",
      observations: [],
      diagnostics: {},
    };
  }
  if (!html)
    return {
      ...base,
      status: "SOURCE_UNAVAILABLE",
      message: "Daily data page returned 404",
      observations: [],
      diagnostics: {},
    };
  const parsed = parseCeegexDaily(html, { sourceUrl: CEEGEX_URL, fetchedAt });
  return {
    ...base,
    status: parsed.status,
    message: parsed.message ?? (parsed.status === "OK" ? MARKET_META.CEEGEX.licence : undefined),
    observations: parsed.observations,
    diagnostics: parsed.diagnostics,
  };
}
