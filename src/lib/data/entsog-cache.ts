// Browser-safe cache engine; storage and HTTP are injected by the server adapter.
export type EntsogRecord = Record<string, unknown>;
export interface SavedEntsogDay {
  series_key: string;
  gas_day: string;
  records: EntsogRecord[];
}
export interface EntsogStore {
  read(keys: string[], from: string, to: string): Promise<SavedEntsogDay[]>;
  save(days: SavedEntsogDay[]): Promise<void>;
}

export function missingDateRanges(from: string, to: string, saved: Set<string>): Array<[string, string]> {
  const ranges: Array<[string, string]> = [];
  let start = "";
  let previous = "";
  const first = Date.parse(`${from}T00:00:00Z`);
  const last = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last || last - first > 3660 * 86400000)
    throw new Error("Invalid ENTSOG date range");
  for (let time = first; time <= last; time += 86400000) {
    const day = new Date(time).toISOString().slice(0, 10);
    if (saved.has(day)) {
      if (start) ranges.push([start, previous]);
      start = "";
    } else {
      if (!start) start = day;
      // Bound individual ENTSOG queries to a year.
      if (time - Date.parse(`${start}T00:00:00Z`) >= 365 * 86400000) {
        ranges.push([start, previous]);
        start = day;
      }
    }
    previous = day;
  }
  if (start) ranges.push([start, previous]);
  return ranges;
}

export function entsogRecords(payload: unknown): EntsogRecord[] {
  if (!payload || typeof payload !== "object") return [];
  const list = Array.isArray(payload) ? payload : Object.entries(payload).find(
    ([key, value]) => key.toLowerCase() !== "meta" && Array.isArray(value),
  )?.[1];
  return Array.isArray(list) ? list.filter((r): r is EntsogRecord => r !== null && typeof r === "object") : [];
}

export async function readThroughEntsog(
  input: string,
  store: EntsogStore,
  request: (url: string) => Promise<unknown>,
  today: string,
): Promise<EntsogRecord[]> {
  const url = new URL(input);
  if (url.origin !== "https://transparency.entsog.eu") throw new Error("Invalid ENTSOG host");
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const entityField = url.searchParams.has("countryKey") ? "countryKey" : "pointDirection";
  const entities = [...new Set((url.searchParams.get(entityField) ?? "").split(",").filter(Boolean).map((s) => s.toLowerCase()))];
  if (!entities.length) throw new Error("Missing ENTSOG series");
  const filters = new URLSearchParams(url.searchParams);
  for (const field of ["from", "to", entityField, "limit", "offset"]) filters.delete(field);
  filters.sort();
  const base = `${url.pathname.replace(/\.json$/, "").toLowerCase()}?${filters}`;
  const keys = entities.map((entity) => `${base}|${entityField}=${entity}`);
  const keyByEntity = new Map(entities.map((entity, index) => [entity, keys[index] ?? ""]));
  // Validate before querying storage or iterating dates.
  missingDateRanges(from, to, new Set());
  const saved = await store.read(keys, from, to);
  const days = new Map(saved.map((day) => [`${day.series_key}|${day.gas_day}`, day]));
  const jobs = new Map<string, { from: string; to: string; entities: string[] }>();
  for (const entity of entities) {
    const key = keyByEntity.get(entity) ?? "";
    const covered = new Set(saved.filter((day) => day.series_key === key).map((day) => day.gas_day));
    for (const [f, t] of missingDateRanges(from, to, covered)) {
      const id = `${f}|${t}`;
      const job = jobs.get(id) ?? { from: f, to: t, entities: [] };
      job.entities.push(entity);
      jobs.set(id, job);
    }
  }
  let firstError: unknown;
  let succeeded = false;
  const transient: EntsogRecord[] = [];
  for (const job of jobs.values()) {
    const query = new URL(url);
    query.searchParams.set("from", job.from);
    query.searchParams.set("to", job.to);
    query.searchParams.set(entityField, job.entities.map((e) => entityField === "countryKey" ? e.toUpperCase() : e).join(","));
    try {
      const rows = entsogRecords(await request(query.toString()));
      succeeded = true;
      const fresh = new Map<string, SavedEntsogDay>();
      for (const row of rows) {
        const day = typeof row['periodFrom'] === "string" ? row['periodFrom'].slice(0, 10) : "";
        const entity = String(row[entityField] ?? (job.entities.length === 1 ? job.entities[0] : "")).toLowerCase();
        const key = keyByEntity.get(entity);
        const value = row['value'];
        if (!key || !job.entities.includes(entity) || day < job.from || day > job.to || value == null || value === "" || !Number.isFinite(Number(value))) continue;
        // Today's physical flow is an unfinished running total, not a saved daily observation.
        if (day >= today && url.searchParams.get("indicator") === "Physical Flow") {
          transient.push(row);
          continue;
        }
        const id = `${key}|${day}`;
        if (days.has(id)) continue;
        const entry = fresh.get(id) ?? { series_key: key, gas_day: day, records: [] };
        entry.records.push(row);
        fresh.set(id, entry);
      }
      if (fresh.size) {
        await store.save([...fresh.values()]);
        for (const [id, entry] of fresh) days.set(id, entry);
      }
    } catch (err) {
      firstError ??= err;
      console.warn("[ENTSOG cache] missing-date request failed; saved observations retained", err);
    }
  }
  if (!days.size && !transient.length && firstError && !succeeded) throw firstError;
  return [...days.values()].sort((a, b) => a.gas_day.localeCompare(b.gas_day)).flatMap((day) => day.records).concat(transient);
}