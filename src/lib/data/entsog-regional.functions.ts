// ENTSOG Transparency Platform — Balkan regional interconnection points (no token).
// Discovers point directions from the `operatorpointdirections` referential, keeps the
// ones that match a corridor on the regional map, and fetches daily Physical Flow or
// Allocation (selectable).
// Nothing is synthesised: corridors without publications are returned absent and the
// map draws them as "no data".
import { createServerFn } from "@tanstack/react-start";
import { ENTSOG_POINT_DIRECTIONS } from "@/lib/gas/config";
import { CORRIDORS } from "@/lib/region/registry";
import {
  ENTSOG_AGGREGATE_COUNTRIES,
  SUPPLEMENTS,
  applySupplements,
  parseAggregated,
  type NetComponents,
} from "@/lib/region/net-position";
import {
  combineCapacity,
  combineCorridor,
  parseOperatorPointDirection,
  REGION_COUNTRIES,
  selectCorridorPoints,
  toMcmPerDay,
  type CorridorCapacity,
  type CorridorSelection,
  type RegionalCorridorSeries,
  indexOperationalRows,
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
  /** Firm technical / firm booked capacity per corridor (Serbian and regional), mcm/day. */
  capacity: Record<string, CorridorCapacity>;
  diagnostics: {
    referentialRecords: number;
    candidatePoints: number;
    requests: number;
    failedRequests: number;
    /** Capacity requests are reported separately: their failure never blanks the flows. */
    capacityRequests: number;
    failedCapacityRequests: number;
    droppedUnits: Record<string, number>;
  };
}

let referentialCache: { at: number; refs: RegionalPointRef[]; total: number } | null = null;
const dataCache = new Map<string, { at: number; res: RegionalFlowsResponse }>();

async function getJson(url: string, attempts = 2): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { cachedEntsogFetch } = await import("./entsog-cache.server");
      const res = await cachedEntsogFetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(45_000),
      });
      // ENTSOG answers 404 when a query is valid but has no rows.
      if (res.status === 404) return {};
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      // ENTSOG throttles bursts (429/503) and is sometimes slow: one paced retry.
      if (attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

/** Runs tasks with at most `limit` in flight, so ENTSOG is not hit with a burst. */
async function pooled<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
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

/** Current gas-day date in Belgrade (YYYY-MM-DD). */
function belgradeToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function clampRange(from: string, to: string): { from: string; to: string } {
  const end = Date.parse(`${to}T00:00:00Z`);
  const minStart = end - (MAX_DAYS - 1) * 86_400_000;
  const start = Math.max(Date.parse(`${from}T00:00:00Z`), minStart);
  return { from: new Date(start).toISOString().slice(0, 10), to };
}

function serbianSide(slot: keyof CorridorSelection, pd: string): CorridorSelection {
  const sel: CorridorSelection = {
    forwardExit: [],
    forwardEntry: [],
    reverseExit: [],
    reverseEntry: [],
  };
  sel[slot].push({
    pointDirection: pd.toLowerCase(),
    label: pd,
    country: pd.slice(0, 2).toUpperCase(),
    adjacent: null,
    direction: slot.endsWith("Exit") ? "exit" : "entry",
    operator: "",
  });
  return sel;
}

/** One ENTSOG operational indicator for many point directions, batched. Values in mcm/day. */
async function fetchIndicator(
  pds: string[],
  indicator: string,
  from: string,
  to: string,
  diagnostics: RegionalFlowsResponse["diagnostics"],
  isFlow: boolean,
): Promise<Map<string, Map<string, number>>> {
  const unique = [...new Set(pds)];
  const latest = new Map<string, Map<string, { value: number; updated: string }>>();
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH) batches.push(unique.slice(i, i + BATCH));

  await pooled(
    batches.map((batch) => async () => {
      if (isFlow) diagnostics.requests += 1;
      else diagnostics.capacityRequests += 1;
      const url =
        `${BASE}/operationaldata.json?pointDirection=${batch.map(encodeURIComponent).join(",")}` +
        `&from=${from}&to=${to}&indicator=${encodeURIComponent(indicator)}&periodType=day&limit=-1`;
      try {
        const rows = records(await getJson(url), [
          "operationaldata",
          "operationalData",
          "operationaldatas",
        ]);
        indexOperationalRows(rows, indicator, from, to, latest, diagnostics.droppedUnits);
      } catch (err) {
        if (isFlow) diagnostics.failedRequests += 1;
        else diagnostics.failedCapacityRequests += 1;
        console.warn(`[ENTSOG regional] ${indicator} batch failed`, err);
      }
    }),
    3,
  );

  const out = new Map<string, Map<string, number>>();
  for (const [pd, byDate] of latest) {
    out.set(pd, new Map([...byDate].map(([date, pick]) => [date, +pick.value.toFixed(4)])));
  }
  return out;
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
    capacityRequests: 0,
    failedCapacityRequests: 0,
    droppedUnits: {},
  };

  try {
    const { refs, total } = await loadReferential();
    diagnostics.referentialRecords = total;
    const selection = selectCorridorPoints(refs);
    // Corridors bound to explicit ENTSOG point directions (TAP) bypass label matching.
    for (const c of CORRIDORS) {
      if (!c.entsog) continue;
      const ref = (pd: string): RegionalPointRef => ({
        pointDirection: pd,
        label: c.name,
        country: "CH",
        adjacent: null,
        direction: pd.endsWith("exit") ? "exit" : "entry",
        operator: "TAP",
      });
      const fwd = c.entsog.forward.map(ref);
      const rev = (c.entsog.reverse ?? []).map(ref);
      selection[c.id] = {
        forwardExit: fwd.filter((r) => r.direction === "exit"),
        forwardEntry: fwd.filter((r) => r.direction === "entry"),
        reverseExit: rev.filter((r) => r.direction === "exit"),
        reverseEntry: rev.filter((r) => r.direction === "entry"),
      };
    }
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

    // Serbian border points: capacity only (their flows come from the main dashboard series).
    const serbianSelection: Record<string, CorridorSelection> = {
      hu_rs_1: serbianSide("forwardExit", ENTSOG_POINT_DIRECTIONS.kiskundorozsma_hu),
      rs_hu_2: serbianSide("forwardEntry", ENTSOG_POINT_DIRECTIONS.kiskundorozsma_2),
      bg_rs_kz: serbianSide("forwardExit", ENTSOG_POINT_DIRECTIONS.kireevo),
      bg_rs_kal: serbianSide("forwardExit", ENTSOG_POINT_DIRECTIONS.kalotina),
    };
    const serbianPds = Object.values(ENTSOG_POINT_DIRECTIONS).map((pd) => pd.toLowerCase());

    // Flows first, then capacity: a burst of parallel requests gets throttled by ENTSOG.
    const flat = await fetchIndicator(pds, indicator, from, to, diagnostics, true);
    // Physical Flow for the current gas day is an intraday running total, not a daily value.
    if (indicator === "Physical Flow") {
      const today = belgradeToday();
      for (const byDate of flat.values()) byDate.delete(today);
    }
    const capPds = [...serbianPds, ...pds];
    const technical = await fetchIndicator(capPds, "Firm Technical", from, to, diagnostics, false);
    const booked = await fetchIndicator(capPds, "Firm Booked", from, to, diagnostics, false);

    const corridors: Record<string, RegionalCorridorSeries> = {};
    for (const [id, sel] of Object.entries(selection)) {
      const series = combineCorridor(id, sel, flat);
      if (series) corridors[id] = series;
    }
    const capacity: Record<string, CorridorCapacity> = {};
    for (const [id, sel] of Object.entries({ ...selection, ...serbianSelection })) {
      const cap = combineCapacity(id, sel, technical, booked);
      if (cap) capacity[id] = cap;
    }

    // Capacity is slow-moving: if this round failed, keep the last good capacity.
    const capacityFailed = diagnostics.failedCapacityRequests > 0;
    if (capacityFailed && cached) {
      for (const [id, cap] of Object.entries(cached.res.capacity))
        if (!capacity[id]) capacity[id] = cap;
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
      capacity,
      diagnostics,
    };
    // A round with failed capacity batches is not cached, so the next refresh retries it.
    if (res.status === "live" && !capacityFailed) dataCache.set(key, { at: Date.now(), res });
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
      capacity: {},
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

// ------------------------------------------------------------------ country net positions

export interface NetPositionsResponse {
  status: "live" | "partial" | "error";
  /** country → gas day → components (mcm/d, Physical Flow). */
  countries: Record<string, Record<string, NetComponents>>;
  failedCountries: string[];
  fetchedAt: string;
}

const netCache = new Map<string, { at: number; res: NetPositionsResponse }>();

async function fetchNetPositions(from: string, to: string): Promise<NetPositionsResponse> {
  const key = `${from}|${to}`;
  const cached = netCache.get(key);
  if (cached && Date.now() - cached.at < DATA_TTL_MS) return cached.res;

  const failedCountries: string[] = [];
  const rows: Array<Record<string, unknown>> = [];
  await pooled(
    ENTSOG_AGGREGATE_COUNTRIES.map((country) => async () => {
      const url =
        `${BASE}/aggregatedData?countryKey=${country}&from=${from}&to=${to}` +
        `&indicator=${encodeURIComponent("Physical Flow")}&periodType=day&limit=-1`;
      try {
        rows.push(...records(await getJson(url), ["aggregatedData", "aggregateddata"]));
      } catch (err) {
        failedCountries.push(country);
        console.warn(`[ENTSOG net position] ${country} failed`, err);
      }
    }),
    3,
  );
  const net = parseAggregated(rows);

  // Points missing from the aggregates (Greek FSRU, TAP into DESFA).
  const pds = Object.values(SUPPLEMENTS).flatMap((s) => s.map((x) => x.pointDirection));
  if (pds.length) {
    try {
      const url =
        `${BASE}/operationaldata.json?pointDirection=${pds.map(encodeURIComponent).join(",")}` +
        `&from=${from}&to=${to}&indicator=${encodeURIComponent("Physical Flow")}&periodType=day&limit=-1`;
      const indexed = indexOperationalRows(
        records(await getJson(url), ["operationaldata", "operationalData"]),
        "Physical Flow",
        from,
        to,
        new Map(),
        {},
      );
      const flows = new Map(
        [...indexed].map(([pd, byDay]) => [pd, new Map([...byDay].map(([d, v]) => [d, v.value]))]),
      );
      applySupplements(net, flows);
    } catch (err) {
      console.warn("[ENTSOG net position] supplements failed", err);
    }
  }

  const countries: NetPositionsResponse["countries"] = {};
  for (const [c, byDay] of net) countries[c] = Object.fromEntries(byDay);
  const res: NetPositionsResponse = {
    status:
      failedCountries.length === ENTSOG_AGGREGATE_COUNTRIES.length
        ? "error"
        : failedCountries.length
          ? "partial"
          : "live",
    countries,
    failedCountries,
    fetchedAt: new Date().toISOString(),
  };
  if (res.status === "live") netCache.set(key, { at: Date.now(), res });
  if (res.status === "error" && cached) return cached.res;
  return res;
}

export const fetchEntsogNetPositions = createServerFn({ method: "POST" })
  .inputValidator((d: { from: string; to: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.from) || !/^\d{4}-\d{2}-\d{2}$/.test(d.to)) {
      throw new Error("from/to must be YYYY-MM-DD");
    }
    return d;
  })
  .handler(async ({ data }) => {
    const r = clampRange(data.from, data.to);
    return fetchNetPositions(r.from, r.to);
  });
