// Balkan Gas Hub (Bulgaria) — Day-Ahead VWAP in EUR/MWh.
//
// Verified live on 2026-11-17 in a browser:
// - https://www.balkangashub.bg/public has Intraday / Day Ahead / Weeks / Months / Quarters
//   tabs (`a[data-market-type]` = WD / DA / WEEK / MONTH / QUARTER). "Day Ahead" (DA) is the
//   active tab on load. There is NO market-zone / trading-point selector on the page: it
//   publishes one DA table for the BGH exchange.
// - The table is filled by the page's own request
//     POST /ajax/spotMarketData  date_from, date_to, type=DA, currency=EUR, year
//   with the page's CSRF token (meta[name=csrf-token]) and session cookie. Intraday uses
//   the same URL with type=WD and returns different numbers, so `type` is checked.
// - Response rows: {day, volume, trades_cnt, vwa_price, relative, reference_price,
//   reference_price_unrounded?, currency}. A day without trades has "-" in every field.
//   reference_price is the BGHSPOTIndex, a different number from the DA VWAP; it stays
//   "-" for the gas day still being traded.
//
// This provider replays exactly that page request (one GET + one POST per refresh, no
// login, nothing bypassed). If BGH changes the page (tab markup, CSRF meta, endpoint) the
// fetch fails with PARSE_ERROR instead of guessing. BGH website terms restrict commercial
// reuse without written consent: see MARKET_META.BGH.licence.
//
// Delivery day = the "Gas day" BGH displays (never computed). Since 15.07.2025 the DA
// product delivers on the next Bulgarian business day, so the trading day is not
// published; it is derived as the previous weekday and marked as derived in diagnostics.

import { fetchWithRetry } from "./http";
import {
  MARKET_META,
  addDays,
  findDate,
  localNow,
  parseNum,
  parsePrice,
  validEurPrice,
  type GasPriceObservation,
  type ProviderResult,
} from "./types";

export const BGH_PAGE_URL = "https://www.balkangashub.bg/public";
export const BGH_DATA_URL = "https://www.balkangashub.bg/ajax/spotMarketData";
export const BGH_PRODUCT = "DA";
/** No zone selector exists on the BGH public page; this is the single published DA market. */
export const BGH_MARKET_ZONE = "BGH exchange (single public DA table, no zone selector)";
export const BGH_HISTORY_DAYS = 35;

export function previousWeekday(date: string): string {
  let d = addDays(date, -1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1);
  return d;
}

export interface BghPageInfo {
  csrf: string;
  dataUrl: string;
  activeTab: string | null;
  tabs: string[];
  holidays: string[];
}

/** Checks the public page still has the structure verified above. Throws on any change. */
export function parseBghPage(html: string): BghPageInfo {
  const csrf = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i)?.[1];
  if (!csrf) throw new Error("BGH page changed: no csrf-token meta tag");
  const tabs = [...html.matchAll(/data-market-type=["']([A-Z]+)["']/g)].map((m) => m[1]);
  if (!tabs.includes("DA") || !tabs.includes("WD"))
    throw new Error(`BGH page changed: market tabs found [${tabs.join(", ")}], expected DA and WD`);
  const active =
    html.match(
      /<a[^>]*class=["'][^"']*\bactive\b[^"']*["'][^>]*data-market-type=["']([A-Z]+)["']/,
    )?.[1] ?? null;
  const dataUrl = html.match(/reports\.url\s*=\s*["']([^"']*spotMarketData)["']/)?.[1];
  if (!dataUrl) throw new Error("BGH page changed: spotMarketData request not found");
  if (new URL(dataUrl).origin !== new URL(BGH_DATA_URL).origin)
    throw new Error(`BGH page changed: data URL moved to ${dataUrl}`);
  if (/zone|trading[- ]point|vtp/i.test(html.match(/<select[\s\S]*?<\/select>/gi)?.join(" ") ?? ""))
    throw new Error("BGH page now has a zone selector; choose the zone explicitly before use");
  const holidays = [
    ...(html.match(/bulHolidays\s*=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"(\d{4}-\d{2}-\d{2})"/g),
  ].map((m) => m[1]);
  return { csrf, dataUrl, activeTab: active, tabs, holidays };
}

interface BghRow {
  day?: unknown;
  volume?: unknown;
  trades_cnt?: unknown;
  vwa_price?: unknown;
  reference_price?: unknown;
  reference_price_unrounded?: unknown;
  currency?: unknown;
}

export interface BghParsed {
  observations: GasPriceObservation[];
  noTradeDays: string[];
  provisionalDays: string[];
  rejected: string[];
}

/**
 * Parses a DA response. VWAP and BGHSPOT are separate metrics; "-" stays empty.
 * A gas day after today (Sofia) whose reference price is still "-" is being traded: its
 * VWAP is kept as a provisional (running) price until BGH closes the session.
 */
export function parseBghDa(
  json: unknown,
  ctx: { sourceUrl: string; fetchedAt: string; today: string },
): BghParsed {
  if (!Array.isArray(json)) throw new Error("BGH response is not a list of rows");
  const out: BghParsed = { observations: [], noTradeDays: [], provisionalDays: [], rejected: [] };
  for (const raw of json as BghRow[]) {
    if (!raw || typeof raw !== "object") continue;
    const deliveryDate = findDate(raw.day);
    if (!deliveryDate || String(raw.day).trim() !== deliveryDate) {
      out.rejected.push(`bad gas day ${String(raw.day)}`);
      continue;
    }
    if (String(raw.currency ?? "").toUpperCase() !== "EUR") {
      out.rejected.push(`${deliveryDate}: currency ${String(raw.currency)}`);
      continue;
    }
    const trades = parseNum(raw.trades_cnt);
    const volume = parseNum(raw.volume);
    const vwap = parsePrice(raw.vwa_price);
    if (!trades || !volume || vwap === null) {
      out.noTradeDays.push(deliveryDate);
      continue;
    }
    // A future gas day is final once BGH publishes its reference price (session closed,
    // ~02:00 CET on the delivery day). Until then its VWAP is the running average of the
    // trades so far: kept, but marked provisional so it is never shown as final.
    const provisional = deliveryDate > ctx.today && !validEurPrice(parsePrice(raw.reference_price));
    if (provisional) out.provisionalDays.push(deliveryDate);
    const base = {
      market: "BGH" as const,
      country: "BG" as const,
      tradingDate: previousWeekday(deliveryDate),
      deliveryDate,
      product: BGH_PRODUCT,
      volumeMwh: volume,
      trades,
      sourceUrl: ctx.sourceUrl,
      fetchedAt: ctx.fetchedAt,
      originalCurrency: "EUR",
      fxRate: null,
    };
    if (validEurPrice(vwap))
      out.observations.push({
        ...base,
        metric: "VWAP",
        priceEurMwh: vwap,
        originalPrice: vwap,
        status: "OK",
        ...(provisional ? { provisional: true } : {}),
      });
    else out.rejected.push(`${deliveryDate}: VWAP ${vwap} outside sanity bounds`);
    const index = parsePrice(raw.reference_price);
    if (validEurPrice(index))
      out.observations.push({
        ...base,
        metric: "BGHSPOT",
        priceEurMwh: index,
        originalPrice: index,
        status: "OK",
      });
  }
  return out;
}

/** Cookie header from Set-Cookie response headers (name=value pairs only). */
function cookieHeader(res: Response): string {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof h.getSetCookie === "function"
      ? h.getSetCookie()
      : (res.headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  return list
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="))
    .join("; ");
}

export async function fetchBgh(at: Date = new Date()): Promise<ProviderResult> {
  const fetchedAt = at.toISOString();
  const base = { market: "BGH" as const, sourceUrl: BGH_PAGE_URL, fetchedAt };
  const today = localNow(MARKET_META.BGH.timeZone, at).date;
  const from = addDays(today, -BGH_HISTORY_DAYS);
  const to = addDays(today, 7); // covers the next business day across weekends/holidays

  let page: BghPageInfo;
  let cookies: string;
  try {
    const res = await fetchWithRetry(BGH_PAGE_URL, {
      attempts: 2,
      timeoutMs: 15_000,
      accept: "text/html",
    });
    if (res.status === 404) throw new Error("BGH public page returned 404");
    cookies = cookieHeader(res);
    const html = await res.text();
    try {
      page = parseBghPage(html);
    } catch (err) {
      return {
        ...base,
        status: "PARSE_ERROR",
        message: err instanceof Error ? err.message : String(err),
        observations: [],
        diagnostics: { htmlSample: html.slice(0, 600) },
      };
    }
  } catch (err) {
    return {
      ...base,
      status: "SOURCE_UNAVAILABLE",
      message: err instanceof Error ? err.message : "request failed",
      observations: [],
      diagnostics: {},
    };
  }

  let json: unknown;
  try {
    const xsrf = cookies.match(/XSRF-TOKEN=([^;]+)/)?.[1];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(page.dataUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        accept: "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        "x-csrf-token": page.csrf,
        ...(xsrf ? { "x-xsrf-token": decodeURIComponent(xsrf) } : {}),
        ...(cookies ? { cookie: cookies } : {}),
        referer: BGH_PAGE_URL,
        origin: "https://www.balkangashub.bg",
      },
      body: new URLSearchParams({
        date_from: from,
        date_to: to,
        type: BGH_PRODUCT,
        currency: "EUR",
        year: today.slice(0, 4),
      }).toString(),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`HTTP ${res.status} from BGH spotMarketData`);
    json = await res.json();
  } catch (err) {
    return {
      ...base,
      status: "SOURCE_UNAVAILABLE",
      message: err instanceof Error ? err.message : "request failed",
      observations: [],
      diagnostics: { activeTab: page.activeTab },
    };
  }

  let parsed: BghParsed;
  try {
    parsed = parseBghDa(json, { sourceUrl: BGH_PAGE_URL, fetchedAt, today });
  } catch (err) {
    return {
      ...base,
      status: "PARSE_ERROR",
      message: err instanceof Error ? err.message : String(err),
      observations: [],
      diagnostics: { sample: JSON.stringify(json).slice(0, 600) },
    };
  }
  const diagnostics = {
    product: BGH_PRODUCT,
    marketZone: BGH_MARKET_ZONE,
    activeTabOnPage: page.activeTab,
    requested: { from, to },
    rows: Array.isArray(json) ? json.length : 0,
    noTradeDays: parsed.noTradeDays,
    provisionalDays: parsed.provisionalDays,
    rejected: parsed.rejected,
    tradingDate: "derived as previous weekday (BGH displays the gas day only)",
    bulgarianHolidaysOnPage: page.holidays,
  };
  if (parsed.observations.length)
    return { ...base, status: "OK", observations: parsed.observations, diagnostics };
  return {
    ...base,
    status: parsed.noTradeDays.length ? "NO_TRADES" : "NOT_PUBLISHED",
    message: "BGH returned no traded Day-Ahead rows for the requested period.",
    observations: [],
    diagnostics,
  };
}
