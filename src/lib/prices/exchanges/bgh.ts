// Balkan Gas Hub (Bulgaria).
// The public pages (balkangashub.bg/en, /public) carry a "Gas day | Traded Volume (MWh/d) |
// Trades | VWAP (EUR/MWh) | VWAP Relative (%) | Reference Price / BGHSPOTIndex (EUR/MWh)"
// table, but the server HTML ships it EMPTY — rows are filled by script after load.
// The free public-data API (balkangashub.bg/en/products/api-services) publishes no
// endpoint URLs; access is via a registration form and an "Agreement for use of API
// Service". No endpoint is guessed here.
//
// This provider therefore parses the server HTML table (works if BGH ever renders rows
// server-side) and otherwise reports LICENCE_REQUIRED with the exact blocker.
// Since 15.07.2025 the BGH DA product delivers on the next Bulgarian business day; the
// delivery day is read from the "Gas day" column, never derived from the trading day.

import { fetchText } from "./http";
import { findHeader, htmlTables } from "./table";
import {
  MARKET_META,
  addDays,
  findDate,
  parseNum,
  parsePrice,
  validEurPrice,
  type GasPriceObservation,
  type ProviderResult,
} from "./types";

export const BGH_URL = "https://www.balkangashub.bg/en";

const COLUMNS = {
  gasDay: { match: /^gas day/, required: true },
  volume: { match: /^traded volume/ },
  trades: { match: /^trades/ },
  vwap: { match: /^vwap/, exclude: /relative/, required: true },
  index: { match: /bghspot|reference price/ },
};

export function previousWeekday(date: string): string {
  let d = addDays(date, -1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1);
  return d;
}

export function parseBghHome(
  html: string,
  ctx: { sourceUrl: string; fetchedAt: string },
): { rows: number; observations: GasPriceObservation[]; currency: string | null } {
  for (const t of htmlTables(html)) {
    const header = findHeader(t, COLUMNS, 3);
    if (!header) continue;
    const headerText = t[header.headerRow].join(" ");
    // Only EUR tables are accepted (the test site publishes BGN).
    const currency = /EUR\/MWh/i.test(headerText) ? "EUR" : /BGN/i.test(headerText) ? "BGN" : null;
    const c = header.cols;
    const cell = (row: string[], k: keyof typeof COLUMNS) =>
      c[k] === undefined ? "" : (row[c[k]!] ?? "");
    const out: GasPriceObservation[] = [];
    const body = t.slice(header.headerRow + 1);
    if (currency !== "EUR") return { rows: body.length, observations: [], currency };
    for (const row of body) {
      const gasDay = findDate(cell(row, "gasDay"));
      if (!gasDay) continue;
      const volume = parseNum(cell(row, "volume"));
      const trades = parseNum(cell(row, "trades"));
      const base = {
        market: "BGH" as const,
        country: "BG" as const,
        // The table states the gas day only. BGH DA delivers on the next business day, so
        // the trading day is the previous weekday (Bulgarian holidays not modelled).
        tradingDate: previousWeekday(gasDay),
        deliveryDate: gasDay,
        product: "DA",
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
      // BGHSPOT needs ≥3 trades and ≥300 MWh; an empty cell stays empty.
      const index = parsePrice(cell(row, "index"));
      if (validEurPrice(index))
        out.push({
          ...base,
          metric: "BGHSPOT",
          priceEurMwh: index,
          originalPrice: index,
          status: "OK",
        });
    }
    return { rows: body.length, observations: out, currency };
  }
  return { rows: 0, observations: [], currency: null };
}

export async function fetchBgh(): Promise<ProviderResult> {
  const fetchedAt = new Date().toISOString();
  const base = { market: "BGH" as const, sourceUrl: BGH_URL, fetchedAt };
  let html: string | null;
  try {
    html = await fetchText(BGH_URL, { attempts: 2, timeoutMs: 15_000, accept: "text/html" });
  } catch (err) {
    return {
      ...base,
      status: "SOURCE_UNAVAILABLE",
      message: err instanceof Error ? err.message : "request failed",
      observations: [],
      diagnostics: {},
    };
  }
  const parsed = html ? parseBghHome(html, { sourceUrl: BGH_URL, fetchedAt }) : null;
  if (parsed?.observations.length)
    return {
      ...base,
      status: "OK",
      observations: parsed.observations,
      diagnostics: { rows: parsed.rows },
    };
  return {
    ...base,
    status: "LICENCE_REQUIRED",
    message:
      "BGH fills its price table in the browser; the server page has no rows. " +
      MARKET_META.BGH.licence,
    observations: [],
    diagnostics: { serverTableRows: parsed?.rows ?? 0, currency: parsed?.currency ?? null },
  };
}
