// Parses an uploaded price history sheet (rows of cell strings from XLSX or CSV) into daily
// hub series. Column roles come from header names; anything unrecognised is ignored and
// reported. Rows that fail validation are rejected and counted, never repaired. Pure.

import { isDatascope, parseDatascope } from "./datascope";

export type ImportHub =
  "BGH" | "CEEGEX" | "TTF" | "CEGH" | "BGH_MA" | "CEEGEX_MA" | "TTF_MA" | "CEGH_MA";

export interface ImportColumn {
  index: number;
  header: string;
  hub: ImportHub | null;
  reason?: string;
}

export interface ImportResult {
  dateColumn: number | null;
  headerRow: number;
  columns: ImportColumn[];
  series: Partial<Record<ImportHub, { date: string; price: number }[]>>;
  rejected: number;
  issues: string[];
}

const HUB_PATTERNS: [ImportHub, RegExp][] = [
  ["BGH", /\bbgh\b|balkan|bulgar|\bbg\b/],
  ["CEEGEX", /ceegex|hudex|hungar|\bhu\b|\bhupx\b/],
  ["CEGH", /cegh|\bvtp\b|austria|\bat\b/],
  ["TTF", /\bttf\b|\bnl\b|dutch/],
];
const MONTH_AHEAD = /month|\bma\b|m\+1|front|forward|\bfm\b/;
const NOT_PRICE =
  /spread|volume|\bvol\b|quantity|\bqty\b|traded|trades|\bcount\b|\bmw\b(?!h)|\bchange\b|\bdiff/;
const DATE_HEADER = /date|datum|\bday\b|\bdan\b|delivery|gas day|isporuk/;

/** Excel serial day → ISO date (1900 system, Lotus leap-year bug handled). */
export function excelSerialToIso(n: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO, day-first dotted/slashed (Serbian/Hungarian/Bulgarian usage) or Excel serial. */
export function parseDate(raw: string): string | null {
  const s = raw.trim().replace(/\.$/, "");
  if (!s) return null;
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) return excelSerialToIso(n);
  }
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}

/** "84,80" · "1.234,56" · "1,234.56" · "84.8" → number. */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/\s|€|eur/gi, "");
  if (!s || s === "-" || /^n\/?a$/i.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function classifyHeader(h: string): ImportHub | null {
  const x = h.toLowerCase();
  if (NOT_PRICE.test(x)) return null;
  const hub = HUB_PATTERNS.find(([, re]) => re.test(x))?.[0];
  if (!hub) return null;
  return MONTH_AHEAD.test(x) ? (`${hub}_MA` as ImportHub) : hub;
}

export function parsePriceSheet(rows: string[][]): ImportResult {
  // Datascope wide exports (multi-row column descriptions) have their own reader.
  if (isDatascope(rows)) return parseDatascope(rows);
  const issues: string[] = [];
  // Header row: the first of the top 15 rows that names a hub.
  let headerRow = rows.slice(0, 15).findIndex((r) => r.some((c) => classifyHeader(c ?? "")));
  if (headerRow < 0) {
    return {
      dateColumn: null,
      headerRow: -1,
      columns: [],
      series: {},
      rejected: 0,
      issues: ["No column header names a hub (BGH, CEEGEX/HUDEX, TTF, CEGH)."],
    };
  }
  const header = rows[headerRow].map((c) => (c ?? "").trim());
  const body = rows.slice(headerRow + 1);
  let dateColumn = header.findIndex((h) => DATE_HEADER.test(h.toLowerCase()));
  if (dateColumn < 0) {
    // Fall back to the column whose cells parse as dates most often.
    const score = header.map(
      (_, j) => body.slice(0, 50).filter((r) => parseDate(r[j] ?? "")).length,
    );
    const best = score.indexOf(Math.max(...score));
    dateColumn = score[best] > 0 ? best : -1;
  }
  if (dateColumn < 0) {
    issues.push("No date column found.");
    headerRow = Math.max(headerRow, 0);
  }

  const columns: ImportColumn[] = header.map((h, index) => {
    if (index === dateColumn) return { index, header: h, hub: null, reason: "date" };
    const hub = classifyHeader(h);
    return hub
      ? { index, header: h, hub }
      : { index, header: h, hub: null, reason: "not a recognised hub price" };
  });
  const seen = new Set<ImportHub>();
  for (const c of columns) {
    if (!c.hub) continue;
    if (seen.has(c.hub)) {
      issues.push(`Column "${c.header}" ignored: ${c.hub} already taken by an earlier column.`);
      c.reason = `duplicate ${c.hub}`;
      c.hub = null;
    } else seen.add(c.hub);
  }

  const series: ImportResult["series"] = {};
  let rejected = 0;
  if (dateColumn >= 0)
    for (const r of body) {
      if (!r.some((c) => (c ?? "").trim())) continue;
      const date = parseDate(r[dateColumn] ?? "");
      if (!date) {
        rejected++;
        continue;
      }
      for (const c of columns) {
        if (!c.hub) continue;
        const raw = r[c.index] ?? "";
        if (!raw.trim()) continue; // blank = missing day, kept as a gap
        const p = parseNumber(raw);
        if (p === null || p <= 0 || p >= 1000) {
          rejected++;
          continue;
        }
        (series[c.hub] ??= []).push({ date, price: p });
      }
    }
  for (const [hub, xs] of Object.entries(series) as [
    ImportHub,
    { date: string; price: number }[],
  ][]) {
    const by = new Map<string, number>();
    let dup = 0;
    for (const x of xs) {
      if (by.has(x.date)) dup++;
      by.set(x.date, x.price);
    }
    if (dup) issues.push(`${hub}: ${dup} duplicate date(s); the last value was kept.`);
    series[hub] = [...by.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, price]) => ({ date, price }));
  }
  if (rejected)
    issues.push(`${rejected} cell(s) rejected (unparseable date or price outside 0–1000 €/MWh).`);
  if (!Object.keys(series).length) issues.push("No prices found under the hub columns.");
  return {
    dateColumn: dateColumn >= 0 ? dateColumn : null,
    headerRow,
    columns,
    series,
    rejected,
    issues,
  };
}

/** Rows of a CSV/TSV/semicolon file (quotes respected). */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", "\t", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
