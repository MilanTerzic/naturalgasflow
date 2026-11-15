// HEnEx (Greece) — Daily Official List of the Natural Gas Trading Platform.
// Official automated-download pattern (HEnEx DOL content documentation):
//   https://www.enexgroup.gr/documents/20126/997118/YYYYMMDD_NGAS_DOL_EN_v##.xlsx
// YYYYMMDD = trading date, v## = publication version (default 01; revisions raise it).
// Sheet DOL_NGAS columns (documented): Trade Date, Trading Series, Contract, Start/Max/Min/
// Last/Closing Price, Previous Closing Price, Number of Orders, Number of Trades, Traded
// Quantity, Traded Volume (MWh), VWAP (€/MWh), Traded Volume - Pre Agreed, VWAP-Pre Agreed,
// HGSIDA, HGSIWD, HGMBI, HGMSI.
// HGSIDA = HEnEx "Next Day Gas Index" → delivery gas day = trading date + 1.
// HGSIWD (within-day), Closing Price and the marginal prices are never used as HGSIDA.

import { fetchBytes, fetchText } from "./http";
import { findHeader } from "./table";
import {
  MARKET_META,
  addDays,
  excelSerialToIso,
  findDate,
  parseNum,
  parsePrice,
  validEurPrice,
  type GasPriceObservation,
  type ObservationStatus,
  type ProviderResult,
} from "./types";
import { readXlsx } from "./xlsx";

export const HENEX_LIST_URL = "https://www.enexgroup.gr/gas-official-list";
export const henexFileUrl = (tradingDate: string, version = 1) =>
  `https://www.enexgroup.gr/documents/20126/997118/${tradingDate.replace(/-/g, "")}_NGAS_DOL_EN_v${String(version).padStart(2, "0")}.xlsx`;

const COLUMNS = {
  tradeDate: { match: /^trad(e|ing) (date|day)/ },
  series: { match: /^trading series/ },
  contract: { match: /^contract/ },
  trades: { match: /^number of trades/ },
  volume: { match: /^traded volume/, exclude: /pre agreed/ },
  vwap: { match: /^vwap/, exclude: /pre agreed/ },
  hgsida: { match: /^hgsida/, required: true },
  hgsiwd: { match: /^hgsiwd/ },
};

const isWithinDay = (s: string) => /within|intra|\bwd\b|\bid\b|hgsiwd/i.test(s);
const isDayAhead = (s: string) => /day.?ahead|\bda\b|d\s*\+\s*[1-3]|next.?day/i.test(s);

export interface HenexParse {
  status: ObservationStatus;
  message?: string;
  observations: GasPriceObservation[];
  diagnostics: Record<string, unknown>;
}

/** Parses the DOL_NGAS sheet of one Daily Official List. */
export function parseHenexDol(
  sheets: Record<string, string[][]>,
  ctx: { tradingDate: string; sourceUrl: string; fetchedAt: string; version: string },
): HenexParse {
  const sheetName = Object.keys(sheets).find((n) => /^dol[_ ]?ngas$/i.test(n.trim()));
  if (!sheetName)
    return {
      status: "PARSE_ERROR",
      message: `Sheet DOL_NGAS not found (sheets: ${Object.keys(sheets).join(", ")})`,
      observations: [],
      diagnostics: { sheets: Object.keys(sheets) },
    };
  const rows = sheets[sheetName];
  const header = findHeader(rows, COLUMNS);
  if (!header)
    return {
      status: "PARSE_ERROR",
      message: "DOL_NGAS header with an HGSIDA column not found",
      observations: [],
      diagnostics: { firstRows: rows.slice(0, 5) },
    };
  const c = header.cols;
  const cell = (row: string[], k: keyof typeof COLUMNS) =>
    c[k] === undefined ? "" : (row[c[k]!] ?? "");

  const base = {
    market: "HENEX" as const,
    country: "GR" as const,
    sourceUrl: ctx.sourceUrl,
    fetchedAt: ctx.fetchedAt,
    sourceVersion: ctx.version,
    originalCurrency: "EUR",
    fxRate: null,
  };
  const out: GasPriceObservation[] = [];
  const indexValues = new Map<string, { value: number; delivery: string | null }>();
  let daTrades = 0;
  let skippedNoDelivery = 0;

  for (const row of rows.slice(header.headerRow + 1)) {
    if (!row.some((v) => v)) continue;
    const label = `${cell(row, "series")} ${cell(row, "contract")}`.trim();
    // Trade date column may be an Excel serial or text; it must agree with the file name.
    const rawTd = cell(row, "tradeDate");
    const td = findDate(rawTd) ?? excelSerialToIso(Number(rawTd)) ?? ctx.tradingDate;
    if (td !== ctx.tradingDate) continue;
    const delivery = findDate(cell(row, "contract")) ?? findDate(cell(row, "series"));

    const hgsida = parsePrice(cell(row, "hgsida"));
    if (validEurPrice(hgsida) && !isWithinDay(label)) {
      indexValues.set(`${hgsida}|${delivery ?? ""}`, { value: hgsida, delivery });
    }

    if (!isDayAhead(label) || isWithinDay(label)) continue;
    const trades = parseNum(cell(row, "trades"));
    const volume = parseNum(cell(row, "volume"));
    const vwap = parsePrice(cell(row, "vwap"));
    if (trades) daTrades += trades;
    if (!trades || !volume || !validEurPrice(vwap)) continue; // no trades → no VWAP, never 0
    if (!delivery) {
      skippedNoDelivery++;
      continue;
    }
    out.push({
      ...base,
      tradingDate: ctx.tradingDate,
      deliveryDate: delivery,
      product: "DA",
      metric: "VWAP",
      priceEurMwh: vwap,
      originalPrice: vwap,
      volumeMwh: volume,
      trades,
      status: "OK",
    });
  }

  // HGSIDA: one next-day index per trading day. If the sheet repeats it per row, the values
  // must agree; differing values are only accepted when each row names its delivery day.
  const values = [...indexValues.values()];
  const distinct = [...new Set(values.map((v) => v.value))];
  const nextDay = addDays(ctx.tradingDate, 1);
  let index: { value: number; delivery: string } | null = null;
  if (distinct.length === 1) index = { value: distinct[0], delivery: nextDay };
  else if (distinct.length > 1) {
    const match = values.find((v) => v.delivery === nextDay);
    if (match) index = { value: match.value, delivery: nextDay };
  }
  if (index) {
    out.push({
      ...base,
      tradingDate: ctx.tradingDate,
      deliveryDate: index.delivery,
      product: "DA",
      metric: "HGSIDA",
      priceEurMwh: index.value,
      originalPrice: index.value,
      volumeMwh: null,
      trades: null,
      status: "OK",
    });
  }

  const diagnostics = {
    sheet: sheetName,
    columnsFound: Object.keys(c),
    columnsMissing: header.missing,
    dayAheadTrades: daTrades,
    hgsidaValues: distinct,
    skippedNoDeliveryDate: skippedNoDelivery,
  };
  if (index) return { status: "OK", observations: out, diagnostics };
  if (distinct.length > 1)
    return {
      status: "PARSE_ERROR",
      message: `HGSIDA has ${distinct.length} different values and none is tied to ${nextDay}`,
      observations: out,
      diagnostics,
    };
  return {
    status: daTrades ? "NOT_PUBLISHED" : "NO_TRADES",
    message: daTrades
      ? "Day-ahead trades reported but HGSIDA cell is empty"
      : "No day-ahead trades; HGSIDA not published",
    observations: out,
    diagnostics,
  };
}

/** Highest published version per trading date from the official list page (if reachable). */
export function parseHenexListing(html: string): Map<string, { version: number; url: string }> {
  const out = new Map<string, { version: number; url: string }>();
  const re = /href="([^"]*get_file\?uuid=[^"]+)"[^>]*>[\s\S]{0,400}?(\d{8})_NGAS_DOL_EN_v(\d{2})/gi;
  for (const m of html.matchAll(re)) {
    const d = `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}`;
    const version = Number(m[3]);
    const url = m[1].replace(/&amp;/g, "&");
    const abs = url.startsWith("http") ? url : `https://www.enexgroup.gr${url}`;
    const prev = out.get(d);
    if (!prev || version > prev.version) out.set(d, { version, url: abs });
  }
  // Also accept the documented direct pattern if the page links it.
  for (const m of html.matchAll(/(\d{8})_NGAS_DOL_EN_v(\d{2})\.xlsx/gi)) {
    const d = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
    const version = Number(m[2]);
    const prev = out.get(d);
    if (!prev || version > prev.version) out.set(d, { version, url: henexFileUrl(d, version) });
  }
  return out;
}

/** Fetches and parses the DOL for each trading date (newest first). Independent per file. */
export async function fetchHenex(tradingDates: string[]): Promise<ProviderResult> {
  const fetchedAt = new Date().toISOString();
  const tried: Array<{ date: string; url?: string; result: string }> = [];
  let listing = new Map<string, { version: number; url: string }>();
  try {
    const html = await fetchText(HENEX_LIST_URL, { attempts: 2, timeoutMs: 15_000 });
    if (html) listing = parseHenexListing(html);
  } catch (err) {
    tried.push({ date: "listing", result: err instanceof Error ? err.message : "failed" });
  }

  const observations: GasPriceObservation[] = [];
  let latestStatus: ObservationStatus | null = null;
  let latestMessage: string | undefined;
  let unreachable = 0;

  for (const date of tradingDates) {
    const listed = listing.get(date);
    const version = listed?.version ?? 1;
    const candidates = [henexFileUrl(date, version), ...(listed ? [listed.url] : [])];
    let bytes: Uint8Array | null = null;
    let used = "";
    try {
      for (const url of candidates) {
        bytes = await fetchBytes(url, { attempts: 3, timeoutMs: 20_000, referer: HENEX_LIST_URL });
        used = url;
        if (bytes) break;
      }
    } catch (err) {
      unreachable++;
      tried.push({ date, result: err instanceof Error ? err.message : "failed" });
      if (latestStatus === null) {
        latestStatus = "SOURCE_UNAVAILABLE";
        latestMessage = "HEnEx file server did not answer";
      }
      continue;
    }
    if (!bytes) {
      tried.push({ date, url: candidates[0], result: "404 not published" });
      if (latestStatus === null) {
        latestStatus = "NOT_PUBLISHED";
        latestMessage = `DOL for ${date} not published yet`;
      }
      continue;
    }
    try {
      const wb = await readXlsx(bytes);
      const parsed = parseHenexDol(wb.sheets, {
        tradingDate: date,
        sourceUrl: used,
        fetchedAt,
        version: `v${String(version).padStart(2, "0")}`,
      });
      observations.push(...parsed.observations);
      tried.push({ date, url: used, result: parsed.status });
      if (latestStatus === null || latestStatus === "NOT_PUBLISHED") {
        if (latestStatus === null) {
          latestStatus = parsed.status;
          latestMessage = parsed.message;
        }
      }
      if (parsed.status === "PARSE_ERROR") {
        tried.push({ date, result: JSON.stringify(parsed.diagnostics).slice(0, 400) });
      }
    } catch (err) {
      tried.push({
        date,
        url: used,
        result: `PARSE_ERROR ${err instanceof Error ? err.message : ""}`,
      });
      if (latestStatus === null) {
        latestStatus = "PARSE_ERROR";
        latestMessage = "DOL file could not be read as XLSX";
      }
    }
  }

  const anyOk = observations.some((o) => o.metric === "HGSIDA");
  let status: ObservationStatus = latestStatus ?? "NOT_PUBLISHED";
  // The newest day not being out yet is normal: report OK if older days were read.
  if (status === "NOT_PUBLISHED" && anyOk) status = "OK";
  if (!anyOk && unreachable === tradingDates.length && tradingDates.length)
    status = "SOURCE_UNAVAILABLE";
  return {
    market: "HENEX",
    status,
    message: latestMessage,
    observations,
    sourceUrl: MARKET_META.HENEX.sourcePage,
    fetchedAt,
    diagnostics: { files: tried, listingEntries: listing.size },
  };
}
