// BRM — Bursa Română de Mărfuri (Romania) — gas Day-Ahead VWAP, converted to EUR/MWh.
//
// Verified live on 2026-11-17 in a browser:
// - BRM's official SPOT page (https://brm.ro/PIATA-SPOT-GN/, tab "Cotații") renders its
//   quotes table from https://dayaheadgas.brm.ro/gassstats/quotes (configured in
//   brm.ro/ext/configs.js as urlGasSpotHost). Plain public GET, JSON, no login.
// - Each record is one product on one trading day. Rings are separate:
//     "Ring Day Ahead"  / "Gas DAY product"  name BRMGAS_DA18_M11_2026 → gas day 2026-11-18
//     "Ring Within Day", "Ring Weekend", "Ring Monday", "Ring Balance of Month" → NOT DA.
// - Page column ↔ JSON field (checked row by row against the on-screen table):
//     Data ↔ quoteDate (trading day) · Produs ↔ nameEn · Cantitate totală ↔ qtyEn
//     Preț mediu ponderat Lei/MWh ↔ value · Nr. tranzacții ↔ numarTranzactiiEn
//     Preț Mediu Ponderat Global ↔ globalAvgPrice (blends Weekend/Monday contracts that
//     cover the same day — a different number, stored as PMP_GLOBAL, never shown as DA).
// - A DA product with no trades has qtyEn 0, numarTranzactiiEn 0, value null.
//
// Prices are RON/MWh. EUR uses the National Bank of Romania (BNR) EUR reference rate of
// the trading day. BNR moved its XML files to curs.bnr.ro on 6 Aug 2026 (the old
// www.bnr.ro/*.xml addresses now redirect to the homepage). On a business day before BNR
// has published that day's rate, the price waits rather than using an older rate; on a
// weekend/holiday trading day the latest earlier fixing is used (BNR does not fix then).
// The original RON price, rate and fixing date are kept on every observation.

import { fetchText } from "./http";
import {
  MARKET_META,
  validEurPrice,
  type GasPriceObservation,
  type ObservationStatus,
  type ProviderResult,
} from "./types";

export const BRM_QUOTES_URL =
  "https://dayaheadgas.brm.ro/gassstats/quotes?pageSize=200&sortBy=quoteDate&sortDirection=desc";
export const BNR_RECENT_URL = "https://curs.bnr.ro/nbrfxrates10days.xml";
export const bnrYearUrl = (year: number) =>
  `https://curs.bnr.ro/files/xml/years/nbrfxrates${year}.xml`;

export const BRM_DA_RING = "Ring Day Ahead";
export const BRM_DA_PRODUCT = "Gas DAY product";
/** BRM publishes one DA product per gas day for the Romanian virtual trading point. */
export const BRM_MARKET_ZONE = "Romania VTP (BRM Ring Day Ahead)";

/** BRMGAS_DA18_M11_2026 → 2026-11-18. Anything else → null (never guessed). */
export function brmDaDelivery(name: unknown): string | null {
  const m = String(name ?? "").match(/^BRMGAS_DA(\d{2})_M(\d{2})_(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** BNR XML → date → RON per 1 EUR. */
export function parseBnrRates(xml: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const cube of xml.matchAll(/<Cube\s+date="(\d{4}-\d{2}-\d{2})"\s*>([\s\S]*?)<\/Cube>/g)) {
    const m = cube[2].match(/<Rate\s+currency="EUR"(?:\s+multiplier="(\d+)")?\s*>([\d.]+)<\/Rate>/);
    if (!m) continue;
    const rate = Number(m[2]) / Number(m[1] ?? 1);
    if (rate > 3 && rate < 10) out.set(cube[1], rate);
  }
  return out;
}

const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

/**
 * BNR EUR rate for a trading day. Same-day fixing when it exists. A business day after the
 * newest fixing (rate not out yet) → null. A weekend/holiday → latest earlier fixing
 * (holiday = a weekday with no fixing although a later fixing exists).
 */
export function rateFor(
  rates: Map<string, number>,
  date: string,
): { rate: number; date: string } | null {
  if (rates.has(date)) return { rate: rates.get(date)!, date };
  const keys = [...rates.keys()].sort();
  const newest = keys.at(-1);
  if (!newest) return null;
  if (date > newest && !isWeekend(date)) return null; // today's fixing not published yet
  const prior = keys.filter((d) => d < date).at(-1);
  if (!prior) return null;
  // More than 5 days without a fixing means the rate file is missing, not a holiday.
  if ((Date.parse(date) - Date.parse(prior)) / 86400000 > 5) return null;
  return { rate: rates.get(prior)!, date: prior };
}

type Rec = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export interface BrmParsed {
  observations: GasPriceObservation[];
  noTradeDays: string[];
  pendingFx: string[];
  rejected: string[];
  daRecords: number;
}

export function parseBrm(
  records: unknown,
  ctx: { sourceUrl: string; fetchedAt: string; rates: Map<string, number> },
): BrmParsed {
  if (!Array.isArray(records)) throw new Error("BRM quotes response is not a list");
  const out: BrmParsed = {
    observations: [],
    noTradeDays: [],
    pendingFx: [],
    rejected: [],
    daRecords: 0,
  };
  for (const r of records as Rec[]) {
    if (!r || typeof r !== "object") continue;
    if (r.ringNameEn !== BRM_DA_RING || r.activSupportNameEn !== BRM_DA_PRODUCT) continue;
    out.daRecords++;
    const deliveryDate = brmDaDelivery(r.nameEn);
    const tradingDate = typeof r.quoteDate === "string" ? r.quoteDate.slice(0, 10) : null;
    if (!deliveryDate || !tradingDate || !/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) {
      out.rejected.push(`unrecognised DA record ${String(r.nameEn)} / ${String(r.quoteDate)}`);
      continue;
    }
    if (deliveryDate <= tradingDate) {
      out.rejected.push(`${String(r.nameEn)}: delivery not after trading day ${tradingDate}`);
      continue;
    }
    if (String(r.currencyCode) !== "RON" || String(r.unitCode) !== "MWh") {
      out.rejected.push(`${String(r.nameEn)}: ${String(r.currencyCode)}/${String(r.unitCode)}`);
      continue;
    }
    const ron = num(r.value);
    const volume = num(r.qtyEn);
    const trades = num(r.numarTranzactiiEn);
    if (!trades || !volume || ron === null) {
      out.noTradeDays.push(deliveryDate);
      continue;
    }
    const fx = rateFor(ctx.rates, tradingDate);
    if (!fx) {
      out.pendingFx.push(deliveryDate);
      continue;
    }
    const base = {
      market: "BRM" as const,
      country: "RO" as const,
      tradingDate,
      deliveryDate,
      product: "DA",
      originalCurrency: "RON",
      fxRate: fx.rate,
      fxDate: fx.date,
      sourceUrl: ctx.sourceUrl,
      fetchedAt: ctx.fetchedAt,
      status: "OK" as const,
    };
    const eur = +(ron / fx.rate).toFixed(3);
    if (validEurPrice(eur))
      out.observations.push({
        ...base,
        metric: "VWAP",
        priceEurMwh: eur,
        originalPrice: ron,
        volumeMwh: volume,
        trades,
      });
    else out.rejected.push(`${deliveryDate}: ${eur} EUR/MWh outside sanity bounds`);
    const global = num(r.globalAvgPrice);
    const globalEur = global === null ? null : +(global / fx.rate).toFixed(3);
    if (validEurPrice(globalEur))
      out.observations.push({
        ...base,
        metric: "PMP_GLOBAL",
        priceEurMwh: globalEur,
        originalPrice: global,
        volumeMwh: num(r.qtyGlobalAvgPrice),
        trades: null,
      });
  }
  return out;
}

async function loadRates(
  years: number[],
): Promise<{ rates: Map<string, number>; errors: string[] }> {
  const rates = new Map<string, number>();
  const errors: string[] = [];
  await Promise.all(
    [BNR_RECENT_URL, ...years.map(bnrYearUrl)].map(async (u) => {
      try {
        const xml = await fetchText(u, { attempts: 2, timeoutMs: 15_000, accept: "text/xml" });
        const parsed = xml ? parseBnrRates(xml) : new Map<string, number>();
        if (!parsed.size) errors.push(`${u}: no EUR rates (moved or format changed?)`);
        for (const [d, r] of parsed) rates.set(d, r);
      } catch (err) {
        errors.push(`${u}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
  return { rates, errors };
}

export async function fetchBrm(at: Date = new Date()): Promise<ProviderResult> {
  const fetchedAt = at.toISOString();
  const base = { market: "BRM" as const, sourceUrl: MARKET_META.BRM.sourcePage, fetchedAt };
  const year = at.getUTCFullYear();
  const [quotes, fx] = await Promise.all([
    fetchText(BRM_QUOTES_URL, { attempts: 3, timeoutMs: 25_000, accept: "application/json" })
      .then((t) => ({ ok: true as const, text: t }))
      .catch((err: unknown) => ({ ok: false as const, err })),
    loadRates(at.getUTCMonth() === 0 ? [year - 1, year] : [year]),
  ]);
  if (!quotes.ok || !quotes.text)
    return {
      ...base,
      status: "SOURCE_UNAVAILABLE",
      message: `BRM quotes did not answer (${quotes.ok ? "404" : String(quotes.err)})`,
      observations: [],
      diagnostics: {},
    };
  let parsed: BrmParsed;
  try {
    parsed = parseBrm(JSON.parse(quotes.text), {
      sourceUrl: BRM_QUOTES_URL,
      fetchedAt,
      rates: fx.rates,
    });
  } catch (err) {
    return {
      ...base,
      status: "PARSE_ERROR",
      message: err instanceof Error ? err.message : String(err),
      observations: [],
      diagnostics: { sample: quotes.text.slice(0, 600) },
    };
  }
  const diagnostics = {
    product: "DA",
    marketZone: BRM_MARKET_ZONE,
    daRecords: parsed.daRecords,
    noTradeDays: parsed.noTradeDays,
    pendingFx: parsed.pendingFx,
    rejected: parsed.rejected,
    fxFixings: fx.rates.size,
    fxErrors: fx.errors,
  };
  if (parsed.observations.length)
    return {
      ...base,
      status: "OK",
      message: MARKET_META.BRM.licence,
      observations: parsed.observations,
      diagnostics,
    };
  let status: ObservationStatus = "NOT_PUBLISHED";
  let message = "BRM returned no Day-Ahead records.";
  if (!parsed.daRecords) {
    status = "PARSE_ERROR";
    message = `No "${BRM_DA_RING}" records found; BRM may have renamed its rings.`;
  } else if (parsed.pendingFx.length && !fx.rates.size) {
    status = "SOURCE_UNAVAILABLE";
    message = "BNR exchange rates unavailable, so RON prices cannot be converted.";
  } else if (parsed.noTradeDays.length) {
    status = "NO_TRADES";
    message = "No traded Day-Ahead products in the period.";
  }
  return { ...base, status, message, observations: [], diagnostics };
}
