// Parsers for public gas spot price publications. Pure functions (unit-tested in
// tests/gas-prices.test.mjs). They return nothing rather than guess when a format changes.

export interface PricePoint {
  /** Delivery gas day (YYYY-MM-DD) when known. */
  date: string | null;
  /** Human label exactly as published (e.g. "Monday", "Weekend", "2026-11-14"). */
  label: string;
  /** €/MWh */
  price: number;
  /** Final (true) or provisional / intraday-updated (false). */
  final: boolean;
}

/** €/MWh sanity bounds; values outside are rejected as a wrong column or unit. */
const MIN_PRICE = 0;
const MAX_PRICE = 1000;

function parseNumber(raw: string): number | null {
  let t = raw.trim().replace(/^"|"$/g, "").replace(/\s/g, "");
  if (!t) return null;
  // 1.234,56 → 1234.56 ; 1,234.56 → 1234.56 ; 34,5 → 34.5
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(t)) t = t.replace(/,/g, "");
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** ISO date from YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY or YYYY/MM/DD (time part ignored). */
export function parseDate(raw: string): string | null {
  const t = raw.trim().replace(/^"|"$/g, "");
  let m = t.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function splitRow(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * EEX Neutral Gas Price CSV (TTF_NGP_60_Days.csv / TTF_NGP_15_Mins.csv).
 * The column layout is detected from the header: a delivery-day column and a price
 * column (header mentions NGP/price/index, never volume). Returns [] when the header
 * cannot be understood, so the caller reports a format change instead of guessing.
 */
export function parseEexNgpCsv(text: string, final: boolean): PricePoint[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delimiter = [";", ",", "\t"].sort(
    (a, b) => lines[0].split(b).length - lines[0].split(a).length,
  )[0];

  // Header = the last line before the first row that starts with a date.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const first = splitRow(lines[i], delimiter)[0] ?? "";
    if (parseDate(first) || splitRow(lines[i], delimiter).some((c) => parseDate(c))) {
      headerIdx = i - 1;
      break;
    }
  }
  if (headerIdx < 0) return [];
  const header = splitRow(lines[headerIdx], delimiter).map((h) => h.toLowerCase());

  const dateCol = header.findIndex((h) => /deliver|gas ?day|delivery|date|day/.test(h));
  const priceCol = header.findIndex(
    (h) => /(ngp|price|index|eur\/mwh|€\/mwh)/.test(h) && !/volume|quantity|trades?\b/.test(h),
  );
  if (dateCol < 0 || priceCol < 0 || dateCol === priceCol) return [];

  const out: PricePoint[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = splitRow(line, delimiter);
    const date = parseDate(cells[dateCol] ?? "");
    const price = parseNumber(cells[priceCol] ?? "");
    if (!date || price === null || price <= MIN_PRICE || price >= MAX_PRICE) continue;
    out.push({ date, label: date, price, final });
  }
  // Latest publication per delivery day wins (files can repeat a day with updates).
  const byDate = new Map(out.map((p) => [p.date, p]));
  return [...byDate.values()].sort((a, b) => (a.date! < b.date! ? -1 : 1));
}

/** HTML → text with " | " between table cells and newlines between rows. */
export function htmlToCells(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<\/tr>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");
}

/**
 * CEGH homepage "DAY AHEAD MARKET" table: Trading Day (dd.mm.) | Contract (weekday or
 * Weekend) | VWAP / CEGHIX €/MWh. The delivery day is not stated unambiguously, so the
 * point keeps the trading day as `date` and the contract name exactly as published.
 */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * CEGH homepage "Day Ahead Market" table: Trading Day | Contract | VWAP/CEGHIX. The date is
 * the TRADING day; the contract names the DELIVERY day ("25.11. | Thursday" = delivery
 * Thursday 26.11.). Delivery = first day after the trading day with that weekday; a contract
 * for the trading day itself is a same-day trade and is not a day-ahead price. "Weekend"
 * covers the following Saturday and Sunday (days after the trading day only). For one
 * delivery day the newest trading day wins, and a single-day contract beats the weekend.
 */
export function parseCeghDayAhead(html: string, today: string): PricePoint[] {
  const text = htmlToCells(html);
  const start = text.search(/DAY\s+AHEAD\s+MARKET/i);
  if (start < 0) return [];
  const section = text.slice(start, start + 1500);
  const re =
    /(\d{1,2})\.(\d{1,2})\.\s*\|\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Weekend)\s*\|\s*(\d+[.,]\d+)/gi;
  const ref = new Date(`${today}T00:00:00Z`);
  const best = new Map<string, { trading: string; weekend: boolean; p: PricePoint }>();
  const plus = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  for (const m of section.matchAll(re)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    // No year is published: use the year that keeps the trading day on or before today.
    let year = ref.getUTCFullYear();
    if (month > ref.getUTCMonth() + 2) year -= 1;
    const price = parseNumber(m[4]);
    if (price === null || price <= MIN_PRICE || price >= MAX_PRICE) continue;
    const trading = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const contract = m[3][0].toUpperCase() + m[3].slice(1).toLowerCase();
    const weekend = contract === "Weekend";
    const targets: string[] = [];
    // Six days ahead at most: the trading day's own weekday (a same-day trade) never matches.
    for (let i = 1; i <= 6; i++) {
      const d = plus(trading, i);
      const wd = WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()];
      if (weekend ? wd === "Saturday" || wd === "Sunday" : wd === contract) targets.push(d);
      if (targets.length === (weekend ? 2 : 1)) break;
      if (weekend && targets.length === 1 && wd === "Sunday") break; // traded Saturday
    }
    for (const date of targets) {
      const cur = best.get(date);
      const better =
        !cur || trading > cur.trading || (trading === cur.trading && cur.weekend && !weekend);
      if (better)
        best.set(date, {
          trading,
          weekend,
          p: { date, label: `${contract} contract, traded ${trading}`, price, final: true },
        });
    }
  }
  return [...best.values()].map((v) => v.p).sort((x, y) => y.date!.localeCompare(x.date!));
}
