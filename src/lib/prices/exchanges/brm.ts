// BRM (Romania) — public Gas Spot statistics endpoints documented in BRM's
// "Public API – Excel step by step" guide:
//   quotes : https://dayaheadgas.brm.ro/gassstats/quotes?pageSize=65535&sortBy=quoteDate&sortDirection=desc
//   assets : https://dayaheadgas.brm.ro/gassstats/assets/?&pageIndex=1&pageSize=65535&sortBy=limitDate&sortDirection=desc
//   grp-144: https://dayaheadgas.brm.ro/gassstats/grp-144/?&pageIndex=1&pageSize=65535&sortDirection=asc
// These are NOT BRM's authenticated trading API.
//
// The JSON field names could not be inspected from the build environment, so fields are
// discovered by name and every assumption is reported in diagnostics. If a price or a
// delivery day cannot be identified, the provider reports PARSE_ERROR with the keys it saw
// — it never guesses a number.
//
// Prices are in RON/MWh unless the record states a currency. Conversion to EUR uses the
// official National Bank of Romania (BNR) EUR fixing for the trading date (latest fixing on
// or before it); original price, rate and fixing date are kept on every observation.

import { fetchText } from "./http";
import {
  MARKET_META,
  findDate,
  parseNum,
  validEurPrice,
  type GasPriceObservation,
  type ObservationStatus,
  type ProviderResult,
} from "./types";

export const BRM_QUOTES_URL =
  "https://dayaheadgas.brm.ro/gassstats/quotes?pageSize=65535&sortBy=quoteDate&sortDirection=desc";
export const BRM_ASSETS_URL =
  "https://dayaheadgas.brm.ro/gassstats/assets/?&pageIndex=1&pageSize=65535&sortBy=limitDate&sortDirection=desc";
export const BRM_PMP_URL =
  "https://dayaheadgas.brm.ro/gassstats/grp-144/?&pageIndex=1&pageSize=65535&sortDirection=asc";
export const BNR_RECENT_URL = "https://www.bnr.ro/nbrfxrates10days.xml";
export const bnrYearUrl = (year: number) =>
  `https://www.bnr.ro/files/xml/years/nbrfxrates${year}.xml`;

type Rec = Record<string, unknown>;

/** Finds the array of records in a JSON payload (root array or first array property). */
export function jsonRecords(payload: unknown): Rec[] {
  if (Array.isArray(payload)) return payload.filter((r) => r && typeof r === "object") as Rec[];
  if (payload && typeof payload === "object") {
    const obj = payload as Rec;
    for (const k of [
      "items",
      "data",
      "content",
      "results",
      "rows",
      "records",
      "list",
      "quotes",
      "assets",
    ]) {
      if (Array.isArray(obj[k])) return jsonRecords(obj[k]);
    }
    for (const v of Object.values(obj))
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return jsonRecords(v);
  }
  return [];
}

/** Flattens one level of nesting: {asset:{name}} → "asset.name". Keys lower-cased. */
function flat(rec: Rec, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(rec)) {
    const key = (prefix + k).toLowerCase();
    if (v && typeof v === "object" && !Array.isArray(v) && !prefix) {
      for (const [k2, v2] of flat(v as Rec, `${k}.`)) out.set(k2, v2);
    } else out.set(key, v);
  }
  return out;
}

function pick(keys: string[], patterns: RegExp[], exclude?: RegExp): string | null {
  for (const p of patterns) {
    const k = keys.find((key) => p.test(key) && !(exclude && exclude.test(key)));
    if (k) return k;
  }
  return null;
}

export interface BrmFieldMap {
  tradingDate: string | null;
  delivery: string | null;
  product: string | null;
  price: string | null;
  volume: string | null;
  trades: string | null;
  currency: string | null;
}

/** Chooses fields by name from a sample of records. Exported for tests and diagnostics. */
export function brmFieldMap(sample: Rec[]): BrmFieldMap {
  const keys = [...new Set(sample.flatMap((r) => [...flat(r).keys()]))];
  return {
    tradingDate: pick(keys, [/^quotedate$/, /quote.?date/, /trad(e|ing).?date/, /^date$/]),
    delivery: pick(keys, [/deliver/, /gas.?day/, /flow.?date/, /limitdate/, /(start|from).?date/]),
    product: pick(keys, [
      /asset.*(name|code|symbol)/,
      /^asset$/,
      /product/,
      /contract/,
      /instrument/,
      /symbol/,
      /name/,
    ]),
    price: pick(
      keys,
      [/pmp/, /weighted/, /vwap/, /average.?price/, /avg.?price/, /^price$/, /price/],
      /min|max|start|open|last|previous|change|limit/,
    ),
    volume: pick(keys, [/quantity/, /volume/, /mwh/], /value|amount/),
    trades: pick(keys, [/trades/, /transactions/, /no.?of/, /count/]),
    currency: pick(keys, [/currency/, /ccy/, /moneda/]),
  };
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

/** Latest fixing on or before `date` (BNR does not fix on weekends/holidays). */
export function rateFor(
  rates: Map<string, number>,
  date: string,
): { rate: number; date: string } | null {
  let best: string | null = null;
  for (const d of rates.keys()) if (d <= date && (!best || d > best)) best = d;
  if (!best) return null;
  // More than 5 days without a fixing means the rate file is missing, not a holiday.
  if ((Date.parse(date) - Date.parse(best)) / 86400000 > 5) return null;
  return { rate: rates.get(best)!, date: best };
}

export function parseBrm(
  records: Rec[],
  ctx: {
    metric: "VWAP" | "PMP_GLOBAL";
    sourceUrl: string;
    fetchedAt: string;
    rates: Map<string, number>;
    assets?: Map<string, string>;
  },
): {
  status: ObservationStatus;
  message?: string;
  observations: GasPriceObservation[];
  diagnostics: Record<string, unknown>;
} {
  const sample = records.slice(0, 50);
  const fields = brmFieldMap(sample);
  const sampleKeys = [...new Set(sample.flatMap((r) => [...flat(r).keys()]))];
  const diagnostics: Record<string, unknown> = { records: records.length, fields, sampleKeys };
  if (!records.length)
    return {
      status: "NOT_PUBLISHED",
      message: "Endpoint returned no records",
      observations: [],
      diagnostics,
    };
  if (!fields.price || (!fields.tradingDate && !fields.delivery))
    return {
      status: "PARSE_ERROR",
      message: `Price or date field not identifiable (keys: ${sampleKeys.slice(0, 15).join(", ")})`,
      observations: [],
      diagnostics,
    };

  const out: GasPriceObservation[] = [];
  let noDelivery = 0;
  let noFx = 0;
  let currencyStated = 0;
  for (const rec of records) {
    const f = flat(rec);
    const get = (k: string | null) => (k ? f.get(k) : undefined);
    const productRaw = String(get(fields.product) ?? "");
    // Asset id → asset name, when the quotes reference assets by id.
    const productName = ctx.assets?.get(productRaw) ?? productRaw;
    if (/intra|within|\bid\b/i.test(productName)) continue;
    const tradingDate = findDate(get(fields.tradingDate));
    const delivery = findDate(get(fields.delivery)) ?? findDate(productName);
    if (!delivery) {
      noDelivery++;
      continue;
    }
    const original = parseNum(get(fields.price), "decimal");
    if (original === null || original <= 0) continue;
    const volume = parseNum(get(fields.volume));
    const trades = parseNum(get(fields.trades));
    if (volume === 0 || trades === 0) continue; // no trades → no price
    const stated = String(get(fields.currency) ?? "").toUpperCase();
    if (stated) currencyStated++;
    const currency = /EUR/.test(stated) ? "EUR" : /RON|LEI/.test(stated) || !stated ? "RON" : null;
    if (!currency) continue; // unknown currency → reject
    let price: number | null = original;
    let fx: { rate: number; date: string } | null = null;
    if (currency === "RON") {
      fx = rateFor(ctx.rates, tradingDate ?? delivery);
      if (!fx) {
        noFx++;
        continue;
      }
      price = +(original / fx.rate).toFixed(3);
    }
    if (!validEurPrice(price)) continue;
    const product = /weekend|w\/?e\b/i.test(productName)
      ? "WE"
      : /mon(day)?|luni/i.test(productName)
        ? "MON"
        : "DA";
    out.push({
      market: "BRM",
      country: "RO",
      tradingDate: tradingDate ?? delivery,
      deliveryDate: delivery,
      product: ctx.metric === "PMP_GLOBAL" ? "GLOBAL" : product,
      metric: ctx.metric,
      priceEurMwh: price,
      originalPrice: original,
      originalCurrency: currency,
      fxRate: fx?.rate ?? null,
      fxDate: fx?.date ?? null,
      volumeMwh: volume,
      trades,
      sourceUrl: ctx.sourceUrl,
      fetchedAt: ctx.fetchedAt,
      status: "OK",
    });
  }
  Object.assign(diagnostics, {
    skippedNoDeliveryDate: noDelivery,
    skippedNoFxRate: noFx,
    currencyField: currencyStated ? "stated" : "absent → RON assumed (BRM spot quotes in lei/MWh)",
  });
  if (out.length) return { status: "OK", observations: out, diagnostics };
  return {
    status: "PARSE_ERROR",
    message: noDelivery
      ? "Records have no identifiable delivery gas day"
      : noFx
        ? "No BNR EUR rate for the trading dates"
        : "No valid priced records",
    observations: [],
    diagnostics,
  };
}

async function loadRates(years: number[]): Promise<Map<string, number>> {
  const rates = new Map<string, number>();
  const urls = [BNR_RECENT_URL, ...years.map(bnrYearUrl)];
  await Promise.all(
    urls.map(async (u) => {
      try {
        const xml = await fetchText(u, { attempts: 2, timeoutMs: 15_000 });
        if (xml) for (const [d, r] of parseBnrRates(xml)) rates.set(d, r);
      } catch {
        /* reported through missing rates */
      }
    }),
  );
  return rates;
}

async function getJson(url: string): Promise<unknown | null> {
  const text = await fetchText(url, { attempts: 3, timeoutMs: 25_000, accept: "application/json" });
  return text ? JSON.parse(text) : null;
}

export async function fetchBrm(): Promise<ProviderResult> {
  const fetchedAt = new Date().toISOString();
  const base = { market: "BRM" as const, sourceUrl: MARKET_META.BRM.sourcePage, fetchedAt };
  const thisYear = new Date().getUTCFullYear();
  const [quotes, pmp, assets, rates] = await Promise.allSettled([
    getJson(BRM_QUOTES_URL),
    getJson(BRM_PMP_URL),
    getJson(BRM_ASSETS_URL),
    loadRates(new Date().getUTCMonth() === 0 ? [thisYear - 1, thisYear] : [thisYear]),
  ]);
  if (quotes.status === "rejected" && pmp.status === "rejected")
    return {
      ...base,
      status: "SOURCE_UNAVAILABLE",
      message: `BRM statistics endpoints did not answer (${String(quotes.reason)})`,
      observations: [],
      diagnostics: {},
    };
  const fx = rates.status === "fulfilled" ? rates.value : new Map<string, number>();

  // Asset id → name map, so quotes that reference an asset id can be labelled/dated.
  const assetNames = new Map<string, string>();
  if (assets.status === "fulfilled") {
    const recs = jsonRecords(assets.value);
    const fm = brmFieldMap(recs.slice(0, 50));
    const keys = [...new Set(recs.slice(0, 50).flatMap((r) => Object.keys(r)))];
    const idKey = keys.find((k) => /^id$|assetid|asset_id/i.test(k));
    for (const r of recs) {
      const id = idKey ? String(r[idKey]) : "";
      const name = [
        fm.product ? String(r[fm.product.split(".").pop()!] ?? "") : "",
        fm.delivery ? String(r[fm.delivery.split(".").pop()!] ?? "") : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (id && name) assetNames.set(id, name);
    }
  }

  const results = [
    pmp.status === "fulfilled"
      ? parseBrm(jsonRecords(pmp.value), {
          metric: "PMP_GLOBAL",
          sourceUrl: BRM_PMP_URL,
          fetchedAt,
          rates: fx,
          assets: assetNames,
        })
      : null,
    quotes.status === "fulfilled"
      ? parseBrm(jsonRecords(quotes.value), {
          metric: "VWAP",
          sourceUrl: BRM_QUOTES_URL,
          fetchedAt,
          rates: fx,
          assets: assetNames,
        })
      : null,
  ];
  const observations = results.flatMap((r) => r?.observations ?? []);
  const diagnostics = {
    pmpGlobal: results[0]?.diagnostics ?? {
      error: pmp.status === "rejected" ? String(pmp.reason) : null,
    },
    quotes: results[1]?.diagnostics ?? {
      error: quotes.status === "rejected" ? String(quotes.reason) : null,
    },
    assets: assets.status === "fulfilled" ? assetNames.size : String(assets.reason),
    fxFixings: fx.size,
  };
  if (observations.length)
    return { ...base, status: "OK", message: MARKET_META.BRM.licence, observations, diagnostics };
  const first = results.find((r) => r) ?? null;
  return {
    ...base,
    status: first?.status ?? "SOURCE_UNAVAILABLE",
    message: first?.message,
    observations: [],
    diagnostics,
  };
}
