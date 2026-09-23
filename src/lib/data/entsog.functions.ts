// ENTSOG Transparency Platform — operational data (Physical Flow), no token.
import { createServerFn } from "@tanstack/react-start";
import {
  ENTSOG_POINT_DIRECTIONS,
  kwhPerDayToMcmPerDay,
  type FlowPoint,
} from "@/lib/gas/config";
import type { FlowPointOperationalSource, FlowRow } from "@/lib/gas/types";

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

type OperationalIndicator = "Physical Flow" | "Renomination" | "Nomination";

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
  indicator: OperationalIndicator,
): Promise<EntsogOperationalRow[]> {
  const url =
    `https://transparency.entsog.eu/api/v1/operationaldata.json` +
    `?pointDirection=${encodeURIComponent(pd)}` +
    `&from=${from}&to=${to}` +
    `&indicator=${encodeURIComponent(indicator)}&periodType=day&limit=-1`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ENTSOG ${pd} ${indicator} [${from}→${to}]: HTTP ${res.status}`);
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
  indicator: OperationalIndicator,
): Promise<Map<string, DailyPick>> {
  const chunks = isoChunks(from, to, 365);
  const results = await Promise.all(
    chunks.map(async ([f, t]) => {
      try {
        return await fetchPointChunk(pd, f, t, indicator);
      } catch (err) {
        console.warn(`[ENTSOG] chunk failed ${pd} ${indicator} ${f}→${t}:`, err);
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
  at: number;
  rows: FlowRow[];
  fetchedAt: string;
  sourceUpdatedAt: string;
}
// Current-day physical-flow values can be revised during the gas day, so do not
// cache them for an entire UTC day.
const FLOW_CACHE_TTL_MS = 30 * 60 * 1000;
const flowCache = new Map<string, CacheEntry>();

export const fetchEntsogFlows = createServerFn({ method: "POST" })
  .inputValidator((d: FetchFlowArgs) => d)
  .handler(async ({ data }): Promise<{
    data: FlowRow[];
    error: string | null;
    fetchedAt: string;
    sourceUpdatedAt: string;
  }> => {
    const cacheKey = `${data.from}|${data.to}`;
    const cached = flowCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.at < FLOW_CACHE_TTL_MS) {
      console.log(`[ENTSOG] cache hit for ${cacheKey}`);
      return {
        data: cached.rows,
        error: null,
        fetchedAt: cached.fetchedAt,
        sourceUpdatedAt: cached.sourceUpdatedAt,
      };
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
      const fetchedAt = new Date().toISOString();
      let sourceUpdatedAt = "";
      const rows: FlowRow[] = dates.map((date) => {
        const publishedPoints: FlowPoint[] = [];
        const pointLastUpdate: Partial<Record<FlowPoint, string>> = {};
        const row: FlowRow = {
          date,
          kiskundorozsma_hu: 0,
          kireevo: 0,
          kiskundorozsma_2: 0,
          kalotina: 0,
          published_points: publishedPoints,
          point_last_update: pointLastUpdate,
          fetched_at: fetchedAt,
        };
        for (const [key, m] of perPoint) {
          const pick = m.get(date);
          if (!pick) continue;
          row[key] = +pick.value_mcm.toFixed(4);
          publishedPoints.push(key);
          pointLastUpdate[key] = pick.last_update;
          if (pick.last_update > sourceUpdatedAt) sourceUpdatedAt = pick.last_update;
        }
        return row;
      });

      // Treat empty result as a soft failure and prefer stale cache.
      if (rows.length === 0 && cached) {
        console.warn(`[ENTSOG] empty response, serving stale cache fetched ${cached.fetchedAt}`);
        return {
          data: cached.rows,
          error: null,
          fetchedAt: cached.fetchedAt,
          sourceUpdatedAt: cached.sourceUpdatedAt,
        };
      }

      // Merge point-by-point with the previous cache. A published zero is a
      // valid observation and must overwrite an older non-zero value. Only
      // points that are genuinely absent from the fresh response use the cache.
      let merged = rows;
      if (cached) {
        const byDate = new Map<string, FlowRow>();
        for (const r of cached.rows) byDate.set(r.date, r);
        for (const r of rows) {
          const prev = byDate.get(r.date);
          if (!prev) {
            byDate.set(r.date, r);
            continue;
          }
          const freshPublished = new Set(r.published_points ?? POINT_KEYS);
          const priorPublished = new Set(prev.published_points ?? POINT_KEYS);
          const combined: FlowRow = {
            ...prev,
            ...r,
            published_points: Array.from(new Set([...priorPublished, ...freshPublished])),
            point_last_update: { ...prev.point_last_update, ...r.point_last_update },
            fetched_at: fetchedAt,
          };
          for (const key of POINT_KEYS) {
            if (!freshPublished.has(key) && priorPublished.has(key)) {
              combined[key] = prev[key];
            }
          }
          byDate.set(r.date, combined);
        }
        merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
        if (cached.sourceUpdatedAt > sourceUpdatedAt) sourceUpdatedAt = cached.sourceUpdatedAt;
      }

      flowCache.set(cacheKey, {
        at: now,
        rows: merged,
        fetchedAt,
        sourceUpdatedAt,
      });
      return { data: merged, error: null, fetchedAt, sourceUpdatedAt };
    } catch (err) {
      console.error("ENTSOG fetch failed", err);
      if (cached) {
        console.warn(`[ENTSOG] serving stale cache fetched ${cached.fetchedAt} after error`);
        return {
          data: cached.rows,
          error: null,
          fetchedAt: cached.fetchedAt,
          sourceUpdatedAt: cached.sourceUpdatedAt,
        };
      }
      return {
        data: [],
        error: err instanceof Error ? err.message : "Unknown error",
        fetchedAt: new Date().toISOString(),
        sourceUpdatedAt: "",
      };
    }
  });

