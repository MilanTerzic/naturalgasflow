// Column lookup by published header label (never by position).

export function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/€/g, "eur")
    .replace(/[^a-z0-9%+/]+/g, " ")
    .trim();
}

export type ColumnSpec = Record<string, { match: RegExp; exclude?: RegExp; required?: boolean }>;

export interface HeaderMatch<K extends string> {
  headerRow: number;
  cols: Partial<Record<K, number>>;
  missing: K[];
}

/**
 * Finds the first row (within the first `scan` rows) that contains every required column
 * and maps each spec key to its column index. Returns null if no row qualifies.
 */
export function findHeader<K extends string>(
  rows: string[][],
  spec: Record<K, { match: RegExp; exclude?: RegExp; required?: boolean }>,
  scan = 40,
): HeaderMatch<K> | null {
  const keys = Object.keys(spec) as K[];
  for (let r = 0; r < Math.min(rows.length, scan); r++) {
    const headers = rows[r].map((h) => normHeader(h ?? ""));
    const cols: Partial<Record<K, number>> = {};
    for (const k of keys) {
      const { match, exclude } = spec[k];
      const idx = headers.findIndex((h) => h && match.test(h) && !(exclude && exclude.test(h)));
      if (idx >= 0) cols[k] = idx;
    }
    const missing = keys.filter((k) => spec[k].required && cols[k] === undefined);
    if (!missing.length)
      return { headerRow: r, cols, missing: keys.filter((k) => cols[k] === undefined) };
  }
  return null;
}

/** Splits HTML into tables → rows → cell text (scripts/styles removed, entities decoded). */
export function htmlTables(html: string): string[][][] {
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const decode = (s: string) =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  const tables: string[][][] = [];
  for (const t of clean.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows: string[][] = [];
    for (const tr of t[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells = [...tr[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
        decode(c[1]),
      );
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}
