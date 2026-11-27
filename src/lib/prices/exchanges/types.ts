// Normalised exchange price observations for BGH, CEEGEX, HEnEx and BRM.
// Pure module: no framework or server imports, so the providers also run from the CLI
// (scripts/refresh-prices.ts) and in unit tests.

export type ExchangeMarket = "BGH" | "CEEGEX" | "HENEX" | "BRM";

export type ObservationStatus =
  | "OK"
  | "NO_TRADES"
  | "NOT_PUBLISHED"
  | "STALE"
  | "SOURCE_UNAVAILABLE"
  | "PARSE_ERROR"
  | "LICENCE_REQUIRED";

export interface GasPriceObservation {
  market: ExchangeMarket;
  country: "BG" | "HU" | "GR" | "RO";
  /** Day the price was formed (exchange local date, YYYY-MM-DD). */
  tradingDate: string;
  /** First gas day of delivery (YYYY-MM-DD). */
  deliveryDate: string;
  /** Last gas day for multi-day contracts (weekend etc.); absent for single-day products. */
  deliveryEndDate?: string;
  /** Product as published, normalised: "DA", "SAT", "SUN", "WE", or the exchange's label. */
  product: string;
  /** Metric name: "BGHSPOT", "CEEREP", "HGSIDA", "PMP_GLOBAL", "VWAP". */
  metric: string;
  priceEurMwh: number | null;
  originalPrice?: number | null;
  originalCurrency?: string;
  fxRate?: number | null;
  /** Date of the FX fixing used, when a conversion was made. */
  fxDate?: string | null;
  volumeMwh: number | null;
  trades: number | null;
  sourceUrl: string;
  fetchedAt: string;
  status: ObservationStatus;
  /** Publication version (HEnEx v01, v02 …) where the source has one. */
  sourceVersion?: string | null;
  /** Price of a delivery day still being traded (BGH running VWAP); replaced once final. */
  provisional?: boolean;
}

export interface ProviderResult {
  market: ExchangeMarket;
  /** Status of this fetch round (not of each observation). */
  status: ObservationStatus;
  message?: string;
  observations: GasPriceObservation[];
  sourceUrl: string;
  fetchedAt: string;
  /** Free-form facts for the feed diagnostics (sample keys, files tried, …). */
  diagnostics: Record<string, unknown>;
}

export interface MarketMeta {
  market: ExchangeMarket;
  country: GasPriceObservation["country"];
  name: string;
  /** Preferred benchmark first, then fallbacks. Never mixes metrics on one delivery day. */
  benchmarks: string[];
  /** Page a person can open to check the number. */
  sourcePage: string;
  timeZone: string;
  /** Local time after which the day's data is normally published. */
  publishAfter: string;
  /** Minutes between retries while today's data is not out yet. */
  retryMinutes: number;
  /** Licence or access condition to show next to the price, if any. */
  licence?: string;
}

export const MARKET_META: Record<ExchangeMarket, MarketMeta> = {
  BGH: {
    market: "BGH",
    country: "BG",
    name: "Balkan Gas Hub",
    // Day-Ahead VWAP only. BGHSPOTIndex is stored as its own metric but never shown as
    // the DA price.
    benchmarks: ["VWAP"],
    sourcePage: "https://www.balkangashub.bg/public",
    timeZone: "Europe/Sofia",
    publishAfter: "18:00",
    retryMinutes: 30,
    licence:
      "Read from BGH's public page. BGH terms restrict commercial reuse without written consent; confirm with BGH before using beyond internal viewing.",
  },
  CEEGEX: {
    market: "CEEGEX",
    country: "HU",
    name: "CEEGEX",
    // VWAP first (traded price, matches the imported Datascope history); CEEREP fills gaps.
    benchmarks: ["VWAP", "CEEREP"],
    sourcePage: "https://ceegex.hu/en/market-data/daily-data",
    timeZone: "Europe/Budapest",
    publishAfter: "17:30",
    retryMinutes: 30,
    licence:
      "CEEREP is a calculated index; CEEGEX restricts redistribution. Internal viewing only unless a data licence is agreed.",
  },
  HENEX: {
    market: "HENEX",
    country: "GR",
    name: "HEnEx",
    benchmarks: ["HGSIDA", "VWAP"],
    sourcePage: "https://www.enexgroup.gr/gas-official-list",
    timeZone: "Europe/Athens",
    // HGSIDA is normally out 18:15 CET = 19:15 Athens; the DOL file can follow later.
    publishAfter: "19:15",
    retryMinutes: 30,
  },
  BRM: {
    market: "BRM",
    country: "RO",
    name: "BRM (Romanian Commodities Exchange)",
    // Day-Ahead ring VWAP only; PMP_GLOBAL (blends weekend/Monday contracts) is stored
    // separately and never shown as the DA price.
    benchmarks: ["VWAP"],
    sourcePage: "https://brm.ro/PIATA-SPOT-GN/",
    timeZone: "Europe/Bucharest",
    publishAfter: "16:00",
    retryMinutes: 30,
    licence:
      "BRM price list: 'Public Market Data API – GAS' is 200 EUR/month per third-party entity. Confirm with BRM before redistributing.",
  },
};

// ---------------------------------------------------------------- numbers & validation

/** €/MWh sanity bounds for spot gas. A zero or negative day-ahead price is rejected. */
export const MIN_EUR_MWH = 0;
export const MAX_EUR_MWH = 1000;

/**
 * Parses a published number. "-", "—", "n/a", empty and non-numeric cells are null,
 * never zero. Handles 1.234,56 / 1,234.56 / 1 234,56 / 34,5.
 */
export function parseNum(
  raw: unknown,
  ambiguousComma: "thousands" | "decimal" = "thousands",
): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw == null) return null;
  let t = String(raw)
    .trim()
    .replace(/[\s\u00a0]/g, "");
  if (!t || /^[-–—]+$/.test(t) || /^(n\/?a|null|none|nan)$/i.test(t)) return null;
  t = t.replace(/(€|eur|ron|lei|bgn|huf)(\/mwh)?$/i, "");
  // "92,410" is ambiguous: a price column reads it as 92.41, a volume column as 92410.
  if (ambiguousComma === "decimal" && /^-?\d{1,3},\d{3}$/.test(t)) t = t.replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Price cells: a single comma group is a decimal comma (prices are below 1000). */
export const parsePrice = (raw: unknown) => parseNum(raw, "decimal");

export function validEurPrice(n: number | null): n is number {
  return n !== null && n > MIN_EUR_MWH && n < MAX_EUR_MWH;
}

// ---------------------------------------------------------------- dates

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${s}T00:00:00Z`);
  return t.toISOString().slice(0, 10) === s ? s : null;
}

/**
 * Finds a calendar date anywhere in a string: YYYY-MM-DD, YYYY.MM.DD(.), YYYYMMDD,
 * DD.MM.YYYY, DD/MM/YYYY, DD-MMM-YYYY / DD MMM YY. Day-first for slashed dates
 * (all four exchanges are European). Returns null when nothing unambiguous is found.
 */
export function findDate(raw: unknown): string | null {
  if (raw == null) return null;
  const t = String(raw);
  let m = t.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = t.match(/(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return iso(y, MONTHS[m[2].toLowerCase()], +m[1]);
  }
  m = t.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  return null;
}

/** Excel serial day (1900 system) to ISO date. */
export function excelSerialToIso(serial: number): string | null {
  if (!(serial > 30000 && serial < 80000)) return null;
  return new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);
}

/** Date arithmetic on calendar days (UTC based, so DST never shifts the date). */
export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** Local calendar date and HH:MM of an instant in an IANA time zone (DST-correct). */
export function localNow(timeZone: string, at: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/**
 * Latest trading date whose publication should be out now: today after the market's
 * publication time, otherwise yesterday.
 */
export function expectedTradingDate(meta: MarketMeta, at: Date = new Date()): string {
  const now = localNow(meta.timeZone, at);
  return now.time >= meta.publishAfter ? now.date : addDays(now.date, -1);
}

// ---------------------------------------------------------------- de-duplication

/** Natural key of an observation: one row per market/product/metric/trading/delivery day. */
export function observationKey(o: GasPriceObservation): string {
  return [o.market, o.product, o.metric, o.tradingDate, o.deliveryDate].join("|");
}

/** Keeps one observation per key; a later publication version or fetch wins. */
export function dedupeObservations(list: GasPriceObservation[]): GasPriceObservation[] {
  const byKey = new Map<string, GasPriceObservation>();
  for (const o of list) {
    const k = observationKey(o);
    const prev = byKey.get(k);
    const newer =
      !prev ||
      (o.sourceVersion ?? "") > (prev.sourceVersion ?? "") ||
      ((o.sourceVersion ?? "") === (prev.sourceVersion ?? "") && o.fetchedAt >= prev.fetchedAt);
    if (newer) byKey.set(k, o);
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------- benchmark series

export interface BenchmarkPoint {
  deliveryDate: string;
  tradingDate: string;
  product: string;
  metric: string;
  price: number;
  volumeMwh: number | null;
  trades: number | null;
  originalPrice?: number | null;
  originalCurrency?: string;
  fxRate?: number | null;
  /** True when this day is covered by a multi-day contract (weekend etc.). */
  multiDay: boolean;
  /** Still being traded (running VWAP); not a final price. */
  provisional?: boolean;
}

/**
 * One benchmark price per delivery gas day, ascending. The market's preferred metric wins;
 * a fallback metric is used only on days where the preferred one is not published.
 * A single-day product beats a multi-day product for the same day. Multi-day contracts are
 * spread over their days for display only; their volume is reported once (first day).
 */
export function benchmarkSeries(
  obs: GasPriceObservation[],
  preference: string[],
): BenchmarkPoint[] {
  const best = new Map<string, { rank: number; p: BenchmarkPoint }>();
  for (const o of obs) {
    if (o.status !== "OK" || !validEurPrice(o.priceEurMwh)) continue;
    const metricRank = preference.indexOf(o.metric);
    if (metricRank < 0) continue;
    const end = o.deliveryEndDate && o.deliveryEndDate > o.deliveryDate ? o.deliveryEndDate : null;
    const span = end ? Math.min(daysBetween(o.deliveryDate, end), 6) : 0;
    for (let i = 0; i <= span; i++) {
      const day = addDays(o.deliveryDate, i);
      const rank = metricRank * 10 + (span ? 1 : 0);
      const cur = best.get(day);
      const later = cur && cur.rank === rank && o.tradingDate > cur.p.tradingDate;
      if (!cur || rank < cur.rank || later) {
        best.set(day, {
          rank,
          p: {
            deliveryDate: day,
            tradingDate: o.tradingDate,
            product: o.product,
            metric: o.metric,
            price: o.priceEurMwh,
            volumeMwh: i === 0 ? o.volumeMwh : null,
            trades: i === 0 ? o.trades : null,
            originalPrice: o.originalPrice,
            originalCurrency: o.originalCurrency,
            fxRate: o.fxRate,
            multiDay: span > 0,
            provisional: o.provisional === true,
          },
        });
      }
    }
  }
  return [...best.values()]
    .map((b) => b.p)
    .sort((a, b) => (a.deliveryDate < b.deliveryDate ? -1 : 1));
}
