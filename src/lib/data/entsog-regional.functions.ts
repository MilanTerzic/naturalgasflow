// ENTSOG Transparency Platform — Balkan regional interconnection points (no token).
// Discovers point directions from the `operatorpointdirections` referential, keeps the
// ones that match a corridor on the regional map, and fetches daily Physical Flow or
// Allocation (selectable).
// Nothing is synthesised: corridors without publications are returned absent and the
// map draws them as "no data".
import { createServerFn } from "@tanstack/react-start";
import {
  combineCorridor,
  parseOperatorPointDirection,
  REGION_COUNTRIES,
  selectCorridorPoints,
  toMcmPerDay,
  type RegionalCorridorSeries,
  type RegionalPointRef,
} from "@/lib/region/regional-feed";

const BASE = "https://transparency.entsog.eu/api/v1";
const REFERENTIAL_TTL_MS = 24 * 60 * 60 * 1000;
const DATA_TTL_MS = 30 * 60 * 1000;
/** Point directions per operationaldata request; keeps us well under worker subrequest limits. */
const BATCH = 25;
/** Longest window served, in days (ENTSOG answers faster and the map only needs recent history). */
const MAX_DAYS = 120;

export type RegionalStatus = "live" | "cache" | "stale" | "empty" | "error";
export type RegionalIndicator = "Physical Flow" | "Allocation";

export interface RegionalFlowsResponse {
  status: RegionalStatus;
  indicator: RegionalIndicator;
  reason?: string;
  from: string;
  to: string;
  fetchedAt: string;
  /** Keyed by corridor id from src/lib/region/registry.ts. Values in mcm/day. */
  corridors: Record<string, RegionalCorridorSeries>;
  diagnostics: {
    referentialRecords: number;
    candidatePoints: number;
    requests: number;
    failedRequests: number;
    droppedUnits: Record<string, number>;
  };
}

let referentialCache: { at: number; refs: RegionalPointRef[]; total: number } | null = null;
const dataCache = new Map<string, { at: number; res: RegionalFlowsResponse }>();

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  // ENTSOG answers 404 when a query is valid but has no rows.
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function records(payload: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  for (const key of keys)
    if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && key.toLowerCase() !== "meta")
      return value as Array<Record<string, unknown>>;
  }
  return [];
}

async function loadReferential(): Promise<{ refs: RegionalPointRef[]; total: number }> {
  if (referentialCache && Date.now() - referentialCache.at < REFERENTIAL_TTL_MS)
    return referentialCache;
  const payload = await getJson(`${BASE}/operatorpointdirections?hasData=1&limit=-1`);
  const recs = records(payload, ["operatorpointdirections", "operatorPointDirections"]);
  if (!recs.length) throw new Error("ENTSOG operatorpointdirections returned no records");
  const refs = recs
    .map(parseOperatorPointDirection)
    .filter((ref): ref is RegionalPointRef => ref !== null && REGION_COUNTRIES.has(ref.country));
  referentialCache = { at: Date.now(), refs, total: recs.length };
  return referentialCache;
}

function clampRange(from: string, to: string): { from: string; to: string } {
  const end = Date.parse(`${to}T00:00:00Z`);
  const minStart = end - (MAX_DAYS - 1) * 86_400_000;
  const start = Math.max(Date.parse(`${from}T00:00:00Z`), minStart);
  return { from: new Date(start).toISOString().slice(0, 10), to };
}

async function fetchRegional(
  fromIn: string,
  toIn: string,
  indicator: RegionalIndicator,
): Promise<RegionalFlowsResponse> {
  const { from, to } = clampRange(fromIn, toIn);
  const key = `${indicator}|${from}|${to}`;
  const cached = dataCache.get(key);
  if (cached && Date.now() - cached.at < DATA_TTL_MS) return { ...cached.res, status: "cache" };

  const diagnostics: RegionalFlowsResponse["diagnostics"] = {
    referentialRecords: 0,
    candidatePoints: 0,
    requests: 0,
    failedRequests: 0,
    droppedUnits: {},
  };

  try {
    const { refs, total } = await loadReferential();
    diagnostics.referentialRecords = total;
    const selection = selectCorridorPoints(refs);
    const pds = [
      ...new Set(
        Object.values(selection).flatMap((sel) =>
          [...sel.forwardExit, ...sel.forwardEntry, ...sel.reverseExit, ...sel.reverseEntry].map(
            (ref) => ref.pointDirection,
          ),
        ),
      ),
    ];
    diagnostics.candidatePoints = pds.length;

    const seriesByPd = new Map<string, Map<string, { value: number; updated: string }>>();
    const batches: string[][] = [];
    for (let i = 0; i < pds.length; i += BATCH) batches.push(pds.slice(i, i + BATCH));

    await Promise.all(
      batches.map(async (batch) => {
        diagnostics.requests += 1;
        const url =
          `${BASE}/operationaldata.json?pointDirection=${batch.map(encodeURIComponent).join(",")}` +
          `&from=${from}&to=${to}&indicator=${encodeURIComponent(indicator)}&periodType=day&limit=-1`;
        try {
          const rows = records(await getJson(url), [
            "operationaldata",
            "operationalData",
            "operationaldatas",
          ]);
          for (const row of rows) {
            const pd = String(
              row.pointDirection ??
                `${row.operatorKey ?? ""}${row.pointKey ?? ""}${row.directionKey ?? ""}`,
            )
              .toLowerCase()
              .replace(/\s+/g, "");
            const date = typeof row.periodFrom === "string" ? row.periodFrom.slice(0, 10) : null;
            const raw =
              typeof row.value === "number"
                ? row.value
                : row.value == null
                  ? NaN
                  : Number(row.value);
            if (!date || !Number.isFinite(raw)) continue;
            const mcm = toMcmPerDay(raw, row.unit as string | undefined);
            if (mcm === null) {
              const unit = String(row.unit ?? "(blank)");
              diagnostics.droppedUnits[unit] = (diagnostics.droppedUnits[unit] ?? 0) + 1;
              continue;
            }
            // Keep the latest revision for each gas day.
            const updated = String(row.lastUpdateDateTime ?? "");
            const byDate = seriesByPd.get(pd) ?? new Map();
            const prev = byDate.get(date);
            if (!prev || updated >= prev.updated) byDate.set(date, { value: mcm, updated });
            seriesByPd.set(pd, byDate);
          }
        } catch (err) {
          diagnostics.failedRequests += 1;
          console.warn("[ENTSOG regional] batch failed", err);
        }
      }),
    );

    const flat = new Map<string, Map<string, number>>();
    for (const [pd, byDate] of seriesByPd) {
      flat.set(pd, new Map([...byDate].map(([date, pick]) => [date, +pick.value.toFixed(4)])));
    }

    const corridors: Record<string, RegionalCorridorSeries> = {};
    for (const [id, sel] of Object.entries(selection)) {
      const series = combineCorridor(id, sel, flat);
      if (series) corridors[id] = series;
    }

    const allFailed =
      diagnostics.requests > 0 && diagnostics.failedRequests === diagnostics.requests;
    if (allFailed && cached)
      return {
        ...cached.res,
        status: "stale",
        reason: "ENTSOG did not answer; showing the last good fetch.",
      };

    const res: RegionalFlowsResponse = {
      indicator,
      status: allFailed ? "error" : Object.keys(corridors).length ? "live" : "empty",
      reason: allFailed
        ? "ENTSOG operational data requests failed."
        : Object.keys(corridors).length
          ? undefined
          : `ENTSOG published no ${indicator.toLowerCase()} for the regional points in this window.`,
      from,
      to,
      fetchedAt: new Date().toISOString(),
      corridors,
      diagnostics,
    };
    if (res.status === "live") dataCache.set(key, { at: Date.now(), res });
    return res;
  } catch (err) {
    if (cached)
      return {
        ...cached.res,
        status: "stale",
        reason: "ENTSOG did not answer; showing the last good fetch.",
      };
    return {
      indicator,
      status: "error",
      reason: err instanceof Error ? err.message : "Unknown error",
      from,
      to,
      fetchedAt: new Date().toISOString(),
      corridors: {},
      diagnostics,
    };
  }
}

export const fetchEntsogRegionalFlows = createServerFn({ method: "POST" })
  .inputValidator((d: { from: string; to: string; indicator?: RegionalIndicator }) => {
    if (
      d.indicator !== undefined &&
      d.indicator !== "Physical Flow" &&
      d.indicator !== "Allocation"
    ) {
      throw new Error("indicator must be Physical Flow or Allocation");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.from) || !/^\d{4}-\d{2}-\d{2}$/.test(d.to)) {
      throw new Error("from/to must be YYYY-MM-DD");
    }
    return d;
  })
  .handler(async ({ data }) =>
    fetchRegional(data.from, data.to, data.indicator ?? "Physical Flow"),
  );
