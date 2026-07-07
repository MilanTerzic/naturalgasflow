// ENTSOG Transparency Platform — operational data (Physical Flow), no token.
import { createServerFn } from "@tanstack/react-start";
import {
  ENTSOG_POINT_DIRECTIONS,
  kwhPerDayToMcmPerDay,
  type FlowPoint,
} from "@/lib/gas/config";
import type { FlowRow } from "@/lib/gas/types";

interface FetchFlowArgs {
  from: string;
  to: string;
}

interface EntsogOperationalRow {
  pointKey?: string;
  pointDirection?: string;
  periodFrom?: string;
  periodTo?: string;
  periodType?: string;
  value?: number | null;
  unit?: string;
  indicator?: string;
  lastUpdateDateTime?: string;
}

const POINT_KEYS = Object.keys(ENTSOG_POINT_DIRECTIONS) as FlowPoint[];

interface DailyPick {
  value_mcm: number;
  unit: string;
  raw_value: number;
  last_update: string;
  period_type: string;
}

// Split [from,to] into ≤ chunkDays windows. ENTSOG rejects long ranges (HTTP 404)
// so we chunk into ~1-year slices and merge.
function isoChunks(from: string, to: string, chunkDays = 365): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  const step = chunkDays * 86_400_000;
  let s = start;
  while (s <= end) {
    const e = Math.min(s + step - 86_400_000, end);
    out.push([new Date(s).toISOString().slice(0, 10), new Date(e).toISOString().slice(0, 10)]);
    s = e + 86_400_000;
  }
  return out;
}

async function fetchPointChunk(
  pd: string,
  from: string,
  to: string,
): Promise<EntsogOperationalRow[]> {
  const url =
    `https://transparency.entsog.eu/api/v1/operationaldata.json` +
    `?pointDirection=${encodeURIComponent(pd)}` +
    `&from=${from}&to=${to}` +
    `&indicator=Physical%20Flow&periodType=day&limit=-1`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ENTSOG ${pd} [${from}→${to}]: HTTP ${res.status}`);
  const json = (await res.json()) as {
    operationaldata?: EntsogOperationalRow[];
    operationalData?: EntsogOperationalRow[];
  };
  return json.operationaldata ?? json.operationalData ?? [];
}

async function fetchPoint(
  pd: string,
  from: string,
  to: string,
): Promise<Map<string, DailyPick>> {
  const chunks = isoChunks(from, to, 365);
  const results = await Promise.all(
    chunks.map(async ([f, t]) => {
      try {
        return await fetchPointChunk(pd, f, t);
      } catch (err) {
        console.warn(`[ENTSOG] chunk failed ${pd} ${f}→${t}:`, err);
        return [] as EntsogOperationalRow[];
      }
    }),
  );
  const rows = results.flat();

  // De-duplication: group by gas day. For each day, keep ONE value.
  // ENTSOG sometimes returns multiple records per day (revisions, sub-periods).
  // We pick the record with the latest lastUpdateDateTime. This avoids the
  // duplicated/inflated-today bug caused by summing sub-entries.
  const byDate = new Map<string, DailyPick>();
  for (const r of rows) {
    if (r.value == null || !r.periodFrom) continue;
    const date = r.periodFrom.slice(0, 10);
    const unit = (r.unit ?? "kWh/d").toLowerCase();
    let mcm: number;
    if (unit.startsWith("kwh")) mcm = kwhPerDayToMcmPerDay(r.value);
    else if (unit.startsWith("mwh")) mcm = r.value / 10_550;
    else if (unit.startsWith("gwh")) mcm = r.value / 10.55;
    else mcm = kwhPerDayToMcmPerDay(r.value);

    const lastUpdate = r.lastUpdateDateTime ?? "";
    const prev = byDate.get(date);
    if (!prev || lastUpdate >= prev.last_update) {
      byDate.set(date, {
        value_mcm: mcm,
        unit: r.unit ?? "kWh/d",
        raw_value: r.value,
        last_update: lastUpdate,
        period_type: r.periodType ?? "day",
      });
    }
  }
  return byDate;
}

interface CacheEntry {
  day: string; // YYYY-MM-DD (UTC) of last successful fetch
  rows: FlowRow[];
}
// Module-level in-memory cache: persists across requests on the same server
// instance. Keyed by the requested window.
const flowCache = new Map<string, CacheEntry>();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export const fetchEntsogFlows = createServerFn({ method: "POST" })
  .inputValidator((d: FetchFlowArgs) => d)
  .handler(async ({ data }): Promise<{ data: FlowRow[]; error: string | null }> => {
    const cacheKey = `${data.from}|${data.to}`;
    const today = todayUtc();
    const cached = flowCache.get(cacheKey);

    // Serve from cache if we already fetched successfully today.
    if (cached && cached.day === today) {
      console.log(`[ENTSOG] cache hit for ${cacheKey} (day ${today})`);
      return { data: cached.rows, error: null };
    }

    try {
      const perPoint = await Promise.all(
        POINT_KEYS.map(async (key) => {
          try {
            const m = await fetchPoint(ENTSOG_POINT_DIRECTIONS[key], data.from, data.to);
            console.log(
              `[ENTSOG] ${key}: ${m.size} unique gas-days returned ` +
                `(window ${data.from} → ${data.to})`,
            );
            return [key, m] as const;
          } catch (err) {
            console.warn(`ENTSOG point ${key} failed:`, err);
            return [key, new Map<string, DailyPick>()] as const;
          }
        }),
      );
      const allDates = new Set<string>();
      for (const [, m] of perPoint) for (const d of m.keys()) allDates.add(d);
      const dates = Array.from(allDates).sort();
      const rows: FlowRow[] = dates.map((date) => {
        const row: FlowRow = {
          date,
          kiskundorozsma_hu: 0,
          kireevo: 0,
          kiskundorozsma_2: 0,
          kalotina: 0,
        };
        for (const [key, m] of perPoint) {
          const pick = m.get(date);
          row[key] = pick ? +pick.value_mcm.toFixed(4) : 0;
        }
        return row;
      });

      // Treat empty result as a soft failure and prefer stale cache.
      if (rows.length === 0 && cached) {
        console.warn(`[ENTSOG] empty response, serving stale cache from ${cached.day}`);
        return { data: cached.rows, error: null };
      }

      // Merge with cached rows: for any date missing (or all-zero) in the new
      // response, fall back to the cached value so a partial ENTSOG outage
      // doesn't blank out previously-known days.
      let merged = rows;
      if (cached) {
        const byDate = new Map<string, FlowRow>();
        for (const r of cached.rows) byDate.set(r.date, r);
        for (const r of rows) {
          const hasAny =
            r.kireevo > 0 || r.kalotina > 0 || r.kiskundorozsma_hu > 0 || r.kiskundorozsma_2 > 0;
          const prev = byDate.get(r.date);
          if (hasAny || !prev) byDate.set(r.date, r);
        }
        merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
      }

      flowCache.set(cacheKey, { day: today, rows: merged });
      return { data: merged, error: null };
    } catch (err) {
      console.error("ENTSOG fetch failed", err);
      if (cached) {
        console.warn(`[ENTSOG] serving stale cache from ${cached.day} after error`);
        return { data: cached.rows, error: null };
      }
      return { data: [], error: err instanceof Error ? err.message : "Unknown error" };
    }
  });

