// Reader for Datascope-style wide exports: several header rows describe each column
// (Data Source, Data Type, Currency, Area, Country, Price Unit …) above a row with
// PublicationDate | Period | Start Date | End Date | <metric per column>.
// Each data row is one contract (a delivery day, weekend or month) published on a date.
// Pure; relative imports only (unit-tested).

import type { ImportColumn, ImportHub, ImportResult } from "./import";
import { parseDate, parseNumber } from "./import";
import { addDays, daysBetween } from "./series";

/** BGN is pegged to the euro (currency board): never a market rate. */
export const BGN_PER_EUR = 1.95583;

const LABELS: Record<string, keyof ColumnInfo> = {
  "data source": "source",
  source: "source",
  commodity: "commodity",
  "data type": "type",
  product: "product",
  currency: "currency",
  area: "area",
  country: "country",
  "price unit": "unit",
  unit: "unit",
};

export interface ColumnInfo {
  index: number;
  source: string;
  commodity: string;
  type: string;
  product: string;
  currency: string;
  area: string;
  country: string;
  unit: string;
  metric: string;
}

type Base = "BGH" | "CEEGEX" | "TTF" | "CEGH";

/** Preference per hub: [currency or "*", metric] — earlier wins, later fills gaps. */
export const PREFERENCE: Record<Base, [string, string][]> = {
  // App benchmark: BGH Day-Ahead VWAP (BGHSPOTIndex is never shown as the DA price).
  BGH: [
    ["EUR", "pricevwap"],
    ["BGN", "pricevwap"],
    ["EUR", "pricesettlement"],
    ["BGN", "pricesettlement"],
  ],
  // VWAP first (Milan's choice); Settlement fills days without a VWAP.
  CEEGEX: [
    ["*", "pricevwap"],
    ["*", "pricesettlement"],
    ["*", "pricemid"],
  ],
  TTF: [
    ["EUR", "pricesettlement"],
    ["EUR", "priceclose"],
  ],
  CEGH: [
    ["EUR", "pricevwap"],
    ["EUR", "priceclose"],
    ["EUR", "pricesettlement"],
  ],
};

const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

export function isDatascope(rows: string[][]): boolean {
  const top = rows.slice(0, 20);
  const hasMetricRow = top.some((r) => r.some((c) => lc(c) === "publicationdate"));
  const hasLabels = top.some((r) => r.some((c) => lc(c) === "data source" || lc(c) === "country"));
  return hasMetricRow && hasLabels;
}

export function hubOf(c: ColumnInfo): Base | null {
  const src = lc(c.source);
  const type = lc(c.type);
  const area = lc(c.area);
  const country = lc(c.country);
  if (lc(c.unit).includes("therm") || type === "intraday" || type === "balancing") return null;
  if (src.includes("balkangashub") || (country === "bg" && type === "spot")) return "BGH";
  if (src.includes("ceegex") || area === "mgp" || (country === "hu" && type === "spot"))
    return "CEEGEX";
  if (area === "ttf") return "TTF";
  if (area === "vtp" || country === "at") return "CEGH";
  return null;
}

export function parseDatascope(rows: string[][]): ImportResult {
  const issues: string[] = [];
  const mr = rows.findIndex((r) => r.some((c) => lc(c) === "publicationdate"));
  const metricRow = rows[mr].map((c) => (c ?? "").trim());
  const find = (re: RegExp) => metricRow.findIndex((c) => re.test(lc(c)));
  const pubCol = find(/^publicationdate$/);
  const periodCol = find(/^period$/);
  const startCol = find(/^start ?date$/);
  const endCol = find(/^end ?date$/);
  const firstData = Math.max(pubCol, periodCol, startCol, endCol) + 1;

  const info: ColumnInfo[] = [];
  for (let j = firstData; j < metricRow.length; j++)
    info.push({
      index: j,
      source: "",
      commodity: "",
      type: "",
      product: "",
      currency: "",
      area: "",
      country: "",
      unit: "",
      metric: lc(metricRow[j]),
    });
  // Label rows: the label cell, then one value per data column (k-th value → k-th column).
  for (const r of rows.slice(0, mr)) {
    const li = r.findIndex((c) => LABELS[lc(c)]);
    if (li < 0) continue;
    const key = LABELS[lc(r[li])];
    const values = r.slice(li + 1);
    values.forEach((v, k) => {
      if (info[k]) (info[k] as unknown as Record<string, string>)[key] = (v ?? "").trim();
    });
  }

  // Candidate columns per hub, in preference order.
  const cands: Record<Base, ColumnInfo[]> = { BGH: [], CEEGEX: [], TTF: [], CEGH: [] };
  for (const c of info) {
    const hub = hubOf(c);
    if (hub) cands[hub].push(c);
  }
  const ordered: Record<Base, ColumnInfo[]> = { BGH: [], CEEGEX: [], TTF: [], CEGH: [] };
  for (const hub of Object.keys(cands) as Base[])
    for (const [cur, metric] of PREFERENCE[hub])
      for (const c of cands[hub])
        if ((cur === "*" || c.currency.toUpperCase() === cur) && c.metric === metric)
          ordered[hub].push(c);

  const columns: ImportColumn[] = info.map((c) => {
    const hub = (Object.keys(ordered) as Base[]).find((h) => ordered[h].includes(c)) ?? null;
    const header = [c.source, c.type, c.area || c.country, c.currency, metricRow[c.index]]
      .filter(Boolean)
      .join(" ");
    if (!hub) return { index: c.index, header, hub: null, reason: "not used" };
    const rank = ordered[hub].indexOf(c);
    return {
      index: c.index,
      header,
      hub,
      reason: rank === 0 ? "primary" : `fallback ${rank}`,
    };
  });

  // Value per hub for one row: first non-empty column in preference order, in EUR/MWh.
  const valueOf = (r: string[], hub: Base): number | null => {
    for (const c of ordered[hub]) {
      const p = parseNumber(r[c.index] ?? "");
      if (p === null) continue;
      const eur =
        c.currency.toUpperCase() === "BGN" || lc(c.unit).startsWith("bgn") ? p / BGN_PER_EUR : p;
      if (eur > 0 && eur < 1000) return Math.round(eur * 10_000) / 10_000;
    }
    return null;
  };

  // Daily and front-month values, keeping the latest publication per delivery.
  type Pick = { pub: string; price: number; single: boolean };
  const daily: Record<Base, Map<string, Pick>> = {
    BGH: new Map(),
    CEEGEX: new Map(),
    TTF: new Map(),
    CEGH: new Map(),
  };
  const month: Record<Base, Map<string, number>> = {
    BGH: new Map(),
    CEEGEX: new Map(),
    TTF: new Map(),
    CEGH: new Map(),
  };
  let rejected = 0;
  let otherSpans = 0;
  for (const r of rows.slice(mr + 1)) {
    if (!r.some((c) => (c ?? "").trim())) continue;
    const pub = parseDate(r[pubCol] ?? "");
    const start = parseDate(r[startCol] ?? "") ?? pub;
    const endRaw = parseDate(r[endCol] ?? "") ?? start;
    if (!pub || !start || !endRaw) {
      rejected++;
      continue;
    }
    const period = lc(r[periodCol]).toUpperCase();
    // Datascope end dates are exclusive (DA 2 Jan runs 2 Jan → 3 Jan); an end equal to the
    // start is read as a single inclusive day.
    const end = endRaw > start ? addDays(endRaw, -1) : start;
    const days = daysBetween(start, end) + 1;
    const isMonth =
      start.slice(8) === "01" && addDays(end, 1).slice(8) === "01" && days >= 28 && days <= 31;
    // Within-day and balance-of-month are not day-ahead prices.
    if (period === "WD" || period === "BM") continue;
    for (const hub of Object.keys(ordered) as Base[]) {
      const v = valueOf(r, hub);
      if (v === null) continue;
      if (days <= 4 && !isMonth) {
        // A single day (DA), or a weekend/holiday block applied to each of its days.
        const single = days === 1;
        for (let i = 0; i < days; i++) {
          const d = addDays(start, i);
          const prev = daily[hub].get(d);
          if (prev && prev.single && !single) continue;
          if (prev && prev.single === single && prev.pub > pub) continue;
          daily[hub].set(d, { pub, price: v, single });
        }
      } else if (isMonth) {
        // Front month only: delivery month = publication month + 1. Stored by trading day.
        const next = addDays(`${pub.slice(0, 7)}-28`, 7).slice(0, 7);
        if (start.slice(0, 7) === next) month[hub].set(pub, v);
      } else otherSpans++;
    }
  }

  const series: ImportResult["series"] = {};
  for (const hub of Object.keys(ordered) as Base[]) {
    if (daily[hub].size)
      series[hub] = [...daily[hub].entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, p]) => ({ date, price: p.price }));
    if (month[hub].size)
      series[`${hub}_MA` as ImportHub] = [...month[hub].entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, price]) => ({ date, price }));
  }
  for (const hub of Object.keys(ordered) as Base[])
    if (!ordered[hub].length) issues.push(`No ${hub} column recognised.`);
  if (ordered.BGH.some((c) => c.currency.toUpperCase() === "BGN"))
    issues.push(`BGN columns converted at the fixed ${BGN_PER_EUR} BGN/EUR peg (fallback only).`);
  if (otherSpans)
    issues.push(
      `${otherSpans} value(s) for quarter / season / year contracts skipped (only day-ahead, weekend and front month are used).`,
    );
  if (rejected)
    issues.push(`${rejected} row(s) without a readable publication/start date skipped.`);
  return {
    dateColumn: startCol >= 0 ? startCol : pubCol,
    headerRow: mr,
    columns,
    series,
    rejected,
    issues,
  };
}
