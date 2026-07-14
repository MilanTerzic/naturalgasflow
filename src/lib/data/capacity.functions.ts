import { createServerFn } from "@tanstack/react-start";
import {
  CAPACITY_ROUTES,
  CAPACITY_ROUTE_BY_ID,
  type CapacityRouteDefinition,
} from "@/lib/gas/capacity-routes";
import { capacityUnitToMwhDay, type CapacityValue } from "@/lib/gas/capacity-utils";
import type { CapacityAuctionRow, CapacityRow } from "@/lib/gas/types";

interface FetchCapacityArgs {
  from: string;
  to: string;
  force?: boolean | number;
}

interface CapacitySourceResult {
  capacity: CapacityRow[];
  warnings: string[];
}

interface CapacityDataProvider {
  fetchCapacity(from: string, to: string): Promise<CapacitySourceResult>;
}

interface EntsogCapacityRow {
  periodFrom?: string;
  value?: number | string | null;
  unit?: string;
  indicator?: string;
  lastUpdateDateTime?: string;
}

interface RbpAuctionApiRow {
  auctionCode?: string;
  networkPointName?: string;
  productType?: string;
  status?: string;
  capacityValidFromUTC?: string;
  capacityValidToUTC?: string;
  offeredCapacity?: number | null;
  entryTSOName?: string;
  exitTSOName?: string;
}

const ENTSOG_TECHNICAL = "Firm Technical";
const ENTSOG_BOOKED = "Firm Booked";
const REQUEST_TIMEOUT_MS = 12_000;
const CAPACITY_CACHE_TTL_MS = 30 * 60 * 1000;

const RBP_POINT_NAMES = [
  "Kiskundorozsma (HU) / Kiskundorozsma (RS)",
  "Kireevo (BG) / Zaychar (RS)",
  "Kalotina (BG)/Dimitrovgrad (RS)",
] as const;

function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function dateRangeIso(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = parseDate(from); d < parseDate(to); d = addDays(d, 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTemporaryHttpStatus(status: number) {
  return status === 429 || status >= 500;
}

async function fetchJsonWithRetry<T>(url: string, init?: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { accept: "application/json", ...(init?.headers ?? {}) },
        signal: controller.signal,
      });
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status}`);
        if (attempt === 0 && isTemporaryHttpStatus(res.status)) {
          lastError = error;
          await sleep(450);
          continue;
        }
        throw error;
      }
      return (await res.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await sleep(450);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

function readOperationalRows(json: {
  operationaldata?: EntsogCapacityRow[];
  operationalData?: EntsogCapacityRow[];
}) {
  return json.operationaldata ?? json.operationalData ?? [];
}

function parseCapacityNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEntsogRows(
  rows: EntsogCapacityRow[],
  route: CapacityRouteDefinition,
  indicator: string,
  warnings: string[],
): Map<string, CapacityValue> {
  const byDate = new Map<string, CapacityValue>();

  for (const row of rows) {
    if (!row.periodFrom) {
      warnings.push(
        `${route.operator} ${route.shortPointName}: missing periodFrom for ${indicator}.`,
      );
      continue;
    }
    const rawValue = parseCapacityNumber(row.value);
    if (rawValue == null) {
      warnings.push(`${route.operator} ${route.shortPointName}: invalid numeric ${indicator}.`);
      continue;
    }
    let valueMwh: number;
    try {
      valueMwh = capacityUnitToMwhDay(rawValue, row.unit ?? "");
    } catch (error) {
      warnings.push(
        `${route.operator} ${route.shortPointName}: ${
          error instanceof Error ? error.message : "unsupported capacity unit"
        }.`,
      );
      continue;
    }

    const date = row.periodFrom.slice(0, 10);
    const lastUpdate = row.lastUpdateDateTime ?? "";
    const prev = byDate.get(date);
    if (!prev || lastUpdate >= prev.last_update) {
      byDate.set(date, {
        value_mwh: valueMwh,
        source_date: date,
        last_update: lastUpdate,
      });
    }
  }

  return byDate;
}

async function fetchEntsogIndicator(
  route: CapacityRouteDefinition,
  indicator: typeof ENTSOG_TECHNICAL | typeof ENTSOG_BOOKED,
  from: string,
  to: string,
  warnings: string[],
): Promise<Map<string, CapacityValue>> {
  if (!route.entsogPointDirection) {
    return new Map();
  }
  const url =
    `https://transparency.entsog.eu/api/v1/operationaldata.json` +
    `?pointDirection=${encodeURIComponent(route.entsogPointDirection)}` +
    `&from=${from}&to=${to}` +
    `&indicator=${encodeURIComponent(indicator)}&periodType=day&limit=-1`;
  const json = await fetchJsonWithRetry<{
    operationaldata?: EntsogCapacityRow[];
    operationalData?: EntsogCapacityRow[];
  }>(url, { cache: "no-store" });
  return parseEntsogRows(readOperationalRows(json), route, indicator, warnings);
}

function latestOnOrBefore(date: string, changes: Map<string, CapacityValue>): CapacityValue | null {
  let selected: CapacityValue | null = null;
  for (const [sourceDate, value] of changes) {
    if (sourceDate <= date && (!selected || sourceDate >= selected.source_date)) {
      selected = value;
    }
  }
  return selected;
}

function rowForRouteDate({
  route,
  date,
  technical,
  booked,
  fetchedAt,
  source,
  dataStatus,
  isProxy = false,
  warning,
}: {
  route: CapacityRouteDefinition;
  date: string;
  technical: CapacityValue | null;
  booked: CapacityValue | null;
  fetchedAt: string;
  source: CapacityRow["source"];
  dataStatus: CapacityRow["data_status"];
  isProxy?: boolean;
  warning?: string;
}): CapacityRow {
  const technicalMwh = technical?.value_mwh ?? null;
  const bookedMwh = booked?.value_mwh ?? null;
  const sourceDate = maxIso(technical?.source_date, booked?.source_date);
  const bookedForPct =
    technicalMwh != null && technicalMwh > 0 && bookedMwh != null
      ? Math.min(bookedMwh, technicalMwh)
      : bookedMwh;

  return {
    route_id: route.id,
    tso: route.operator,
    border_point: route.borderPoint,
    direction: route.direction,
    product: "daily",
    period: date,
    technical_mwh: technicalMwh,
    offered_mwh: technicalMwh == null ? 0 : Math.round(technicalMwh),
    booked_mwh: bookedMwh == null ? null : Math.round(bookedMwh),
    utilisation_pct:
      technicalMwh != null && technicalMwh > 0 && bookedForPct != null
        ? +((bookedForPct / technicalMwh) * 100).toFixed(1)
        : 0,
    price: 0,
    currency: route.operator === "FGSZ" ? "HUF" : "EUR",
    price_unit: route.operator === "FGSZ" ? "HUF/kWh/h/day" : "EUR/kWh/h/day",
    source,
    source_date: sourceDate,
    capacity_source_date: sourceDate,
    fetched_at: fetchedAt,
    is_proxy: isProxy,
    is_carried_forward: !!sourceDate && sourceDate < date,
    is_stale: false,
    data_status: dataStatus,
    warning,
  };
}

function maxIso(a?: string, b?: string) {
  if (a && b) return a > b ? a : b;
  return a ?? b;
}

class EntsogCapacityProvider implements CapacityDataProvider {
  async fetchCapacity(from: string, to: string): Promise<CapacitySourceResult> {
    const warnings: string[] = [];
    const dates = dateRangeIso(from, to);
    const fetchedAt = new Date().toISOString();
    const directRoutes = CAPACITY_ROUTES.filter(
      (route) => route.sourceStrategy === "direct-entsog",
    );
    const directByRoute = new Map<
      string,
      { technical: Map<string, CapacityValue>; booked: Map<string, CapacityValue> }
    >();

    const settled = await Promise.allSettled(
      directRoutes.map(async (route) => {
        const routeWarnings: string[] = [];
        const [technical, booked] = await Promise.all([
          fetchEntsogIndicator(route, ENTSOG_TECHNICAL, from, to, routeWarnings),
          fetchEntsogIndicator(route, ENTSOG_BOOKED, from, to, routeWarnings),
        ]);
        return { route, technical, booked, warnings: routeWarnings };
      }),
    );

    for (const result of settled) {
      if (result.status === "fulfilled") {
        warnings.push(...result.value.warnings);
        directByRoute.set(result.value.route.id, {
          technical: result.value.technical,
          booked: result.value.booked,
        });
      } else {
        warnings.push(
          `Live capacity unavailable for ${
            result.reason instanceof Error ? result.reason.message : "one ENTSOG route"
          }.`,
        );
      }
    }

    const rows: CapacityRow[] = [];
    for (const route of CAPACITY_ROUTES) {
      const sourceRouteId =
        route.sourceStrategy === "counterparty-proxy" ? route.pairedRouteId : route.id;
      const sourceValues = sourceRouteId ? directByRoute.get(sourceRouteId) : undefined;
      if (!sourceValues) {
        warnings.push(`Live capacity unavailable for ${route.operator} ${route.shortPointName}.`);
        continue;
      }

      for (const date of dates) {
        const technical = latestOnOrBefore(date, sourceValues.technical);
        const booked = latestOnOrBefore(date, sourceValues.booked);
        if (booked && technical && booked.value_mwh > technical.value_mwh) {
          warnings.push(
            `${route.operator} ${route.shortPointName}: booked capacity greater than technical on ${date}.`,
          );
        }
        if (!technical && !booked) continue;
        rows.push(
          rowForRouteDate({
            route,
            date,
            technical,
            booked,
            fetchedAt,
            source: route.sourceStrategy === "counterparty-proxy" ? "ENTSOG counterpart" : "ENTSOG",
            dataStatus: route.sourceStrategy === "counterparty-proxy" ? "proxy" : "live",
            isProxy: route.sourceStrategy === "counterparty-proxy",
            warning:
              route.sourceStrategy === "counterparty-proxy"
                ? "Counterparty-side proxy; no direct Gastrans publication used."
                : undefined,
          }),
        );
      }
    }

    return { capacity: rows, warnings };
  }
}

function rbpToMwh(offeredCapacity: number | null | undefined): number {
  return offeredCapacity == null ? 0 : offeredCapacity / 1000;
}

async function fetchRbpPointAuctions(
  networkPointName: string,
  from: string,
  to: string,
): Promise<CapacityAuctionRow[]> {
  const body = {
    start: 0,
    limit: 40,
    sort: [{ property: "CapacityValidFromUTC", direction: "ASC" }],
    filter: [
      { property: "NetworkPointName", comparison: "eq", value: networkPointName },
      { property: "CapacityValidFromUTC", comparison: "gte", value: `${from}T00:00:00` },
      { property: "CapacityValidFromUTC", comparison: "lt", value: `${to}T00:00:00` },
    ],
  };
  const json = await fetchJsonWithRetry<{ success?: boolean; data?: RbpAuctionApiRow[] }>(
    "https://ipnew.rbp.eu/Rbp.eu/api/RBPPublic/GetCapacityAuctionList",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  if (!json.success) throw new Error(`RBP ${networkPointName}: unsuccessful response`);
  return (json.data ?? []).map((r) => ({
    auction_code: r.auctionCode ?? "",
    network_point: r.networkPointName ?? networkPointName,
    product_type: r.productType ?? "",
    status: r.status ?? "",
    valid_from: (r.capacityValidFromUTC ?? "").slice(0, 10),
    valid_to: (r.capacityValidToUTC ?? "").slice(0, 10),
    offered_mwh: Math.round(rbpToMwh(r.offeredCapacity)),
    entry_tso: r.entryTSOName,
    exit_tso: r.exitTSOName,
    source: "RBP" as const,
  }));
}

class RbpPublicAuctionProvider {
  async fetchAuctions(
    from: string,
    to: string,
  ): Promise<{ rows: CapacityAuctionRow[]; warnings: string[] }> {
    const settled = await Promise.allSettled(
      RBP_POINT_NAMES.map((name) => fetchRbpPointAuctions(name, from, to)),
    );
    const rows: CapacityAuctionRow[] = [];
    const warnings: string[] = [];
    settled.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        rows.push(...result.value);
      } else {
        warnings.push(
          `RBP auction offers temporarily unavailable for ${RBP_POINT_NAMES[idx]}: ${
            result.reason instanceof Error ? result.reason.message : "unavailable"
          }`,
        );
      }
    });
    return {
      rows: rows.sort((a, b) =>
        `${a.valid_from}|${a.network_point}|${a.product_type}|${a.auction_code}`.localeCompare(
          `${b.valid_from}|${b.network_point}|${b.product_type}|${b.auction_code}`,
        ),
      ),
      warnings,
    };
  }
}

interface CacheResponse {
  capacity: CapacityRow[];
  rbpAuctions: CapacityAuctionRow[];
  fetchedAt: string;
  warnings: string[];
  error: string | null;
}

interface CacheEntry {
  at: number;
  response: CacheResponse;
}

const capacityCache = new Map<string, CacheEntry>();

function markCached(
  response: CacheResponse,
  stale: boolean,
  warning: string | null,
): CacheResponse {
  return {
    ...response,
    capacity: response.capacity.map((row) => ({
      ...row,
      source: "cache",
      data_status: "cached",
      is_stale: stale,
    })),
    warnings: warning ? [...response.warnings, warning] : response.warnings,
  };
}

export const fetchLiveCapacityBookings = createServerFn({ method: "POST" })
  .inputValidator((d: FetchCapacityArgs) => d)
  .handler(async ({ data }) => {
    const cacheKey = `${data.from}|${data.to}`;
    const cached = capacityCache.get(cacheKey);
    const now = Date.now();
    const force = !!data.force;
    if (!force && cached && now - cached.at < CAPACITY_CACHE_TTL_MS) {
      return markCached(cached.response, false, null);
    }

    const capacityProvider = new EntsogCapacityProvider();
    const auctionProvider = new RbpPublicAuctionProvider();

    const [capacityResult, rbpResult] = await Promise.allSettled([
      capacityProvider.fetchCapacity(data.from, data.to),
      auctionProvider.fetchAuctions(data.from, data.to),
    ]);

    const warnings: string[] = [];
    let capacity: CapacityRow[] = [];
    let rbpAuctions: CapacityAuctionRow[] = [];
    let error: string | null = null;

    if (capacityResult.status === "fulfilled") {
      capacity = capacityResult.value.capacity;
      warnings.push(...capacityResult.value.warnings);
    } else {
      error =
        capacityResult.reason instanceof Error
          ? capacityResult.reason.message
          : "Capacity refresh failed";
      warnings.push(`ENTSOG capacity temporarily unavailable: ${error}`);
    }

    if (rbpResult.status === "fulfilled") {
      rbpAuctions = rbpResult.value.rows;
      warnings.push(...rbpResult.value.warnings);
    } else {
      warnings.push(
        `RBP auction offers temporarily unavailable: ${
          rbpResult.reason instanceof Error ? rbpResult.reason.message : "unavailable"
        }`,
      );
    }

    if (capacity.length === 0 && cached) {
      return markCached(cached.response, true, "Live capacity unavailable; showing cached values.");
    }

    const response: CacheResponse = {
      capacity,
      rbpAuctions,
      fetchedAt: new Date().toISOString(),
      warnings,
      error,
    };

    if (capacity.length > 0 || rbpAuctions.length > 0) {
      capacityCache.set(cacheKey, { at: now, response });
    }

    return response;
  });
