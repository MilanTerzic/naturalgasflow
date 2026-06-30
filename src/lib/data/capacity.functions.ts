import { createServerFn } from "@tanstack/react-start";
import {
  CAPACITY_DEFS,
  ENTSOG_POINT_DIRECTIONS,
  type FlowPoint,
} from "@/lib/gas/config";
import type { CapacityAuctionRow, CapacityRow } from "@/lib/gas/types";

interface FetchCapacityArgs {
  from: string;
  to: string;
}

interface EntsogCapacityRow {
  periodFrom?: string;
  value?: number | null;
  unit?: string;
  indicator?: string;
  lastUpdateDateTime?: string;
}

interface DailyValue {
  value_mwh: number;
  last_update: string;
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

const ENTSOG_CAPACITY_INDICATORS = ["Firm Technical", "Firm Booked", "Firm Available"] as const;

const RBP_POINT_NAMES = [
  "Kiskundorozsma (HU) / Kiskundorozsma (RS)",
  "Kireevo (BG) / Zaychar (RS)",
  "Kalotina (BG)/Dimitrovgrad (RS)",
] as const;

function flowKeyFor(d: (typeof CAPACITY_DEFS)[number]): FlowPoint | null {
  const bp = d.borderPoint.toLowerCase();
  if (bp.includes("kiskundorozsma 2")) return "kiskundorozsma_2";
  if (bp.includes("kiskundorozsma")) return "kiskundorozsma_hu";
  if (bp.includes("kireevo") || bp.includes("zaychar")) return "kireevo";
  if (bp.includes("kalotina")) return "kalotina";
  return null;
}

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

function toMwh(value: number | null | undefined, unit?: string): number {
  if (value == null) return 0;
  const u = (unit ?? "kWh/d").toLowerCase();
  if (u.startsWith("kwh")) return value / 1000;
  if (u.startsWith("mwh")) return value;
  if (u.startsWith("gwh")) return value * 1000;
  return value / 1000;
}

async function fetchEntsogIndicator(
  pointDirection: string,
  indicator: (typeof ENTSOG_CAPACITY_INDICATORS)[number],
  from: string,
  to: string,
): Promise<Map<string, DailyValue>> {
  const url =
    `https://transparency.entsog.eu/api/v1/operationaldata.json` +
    `?pointDirection=${encodeURIComponent(pointDirection)}` +
    `&from=${from}&to=${to}` +
    `&indicator=${encodeURIComponent(indicator)}&periodType=day&limit=-1`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ENTSOG ${indicator} ${pointDirection}: HTTP ${res.status}`);
  const json = (await res.json()) as {
    operationaldata?: EntsogCapacityRow[];
    operationalData?: EntsogCapacityRow[];
  };

  const byDate = new Map<string, DailyValue>();
  for (const r of json.operationaldata ?? json.operationalData ?? []) {
    if (r.value == null || !r.periodFrom) continue;
    const date = r.periodFrom.slice(0, 10);
    const lastUpdate = r.lastUpdateDateTime ?? "";
    const prev = byDate.get(date);
    if (!prev || lastUpdate >= prev.last_update) {
      byDate.set(date, {
        value_mwh: toMwh(r.value, r.unit),
        last_update: lastUpdate,
      });
    }
  }
  return byDate;
}

function fillForward(
  dates: string[],
  changes: Map<string, DailyValue>,
): Map<string, number> {
  const sorted = [...changes.entries()].sort(([a], [b]) => a.localeCompare(b));
  const out = new Map<string, number>();
  let idx = 0;
  let current = 0;
  for (const date of dates) {
    while (idx < sorted.length && sorted[idx][0] <= date) {
      current = sorted[idx][1].value_mwh;
      idx += 1;
    }
    out.set(date, current);
  }
  return out;
}

async function fetchEntsogCapacity(from: string, to: string): Promise<CapacityRow[]> {
  const dates = dateRangeIso(from, to);
  const rows: CapacityRow[] = [];

  await Promise.all(
    CAPACITY_DEFS.map(async (d) => {
      const flowKey = flowKeyFor(d);
      if (!flowKey) return;
      const pointDirection = ENTSOG_POINT_DIRECTIONS[flowKey];
      const [technicalChanges, bookedChanges, availableChanges] = await Promise.all(
        ENTSOG_CAPACITY_INDICATORS.map((indicator) =>
          fetchEntsogIndicator(pointDirection, indicator, from, to),
        ),
      );
      const technicalByDate = fillForward(dates, technicalChanges);
      const bookedByDate = fillForward(dates, bookedChanges);
      const availableByDate = fillForward(dates, availableChanges);

      for (const date of dates) {
        const offered = technicalByDate.get(date) ?? 0;
        const bookedFromIndicator = bookedByDate.get(date) ?? 0;
        const available = availableByDate.get(date) ?? 0;
        const booked = Math.min(
          bookedFromIndicator || Math.max(offered - available, 0),
          offered,
        );
        if (offered <= 0 && booked <= 0) continue;
        rows.push({
          tso: d.tso,
          border_point: d.borderPoint,
          direction: d.direction,
          product: "daily",
          period: date,
          offered_mwh: Math.round(offered),
          booked_mwh: Math.round(booked),
          utilisation_pct: offered > 0 ? +((booked / offered) * 100).toFixed(1) : 0,
          price: 0,
          currency: d.currency,
          price_unit: d.priceUnit,
        });
      }
    }),
  );

  return rows.sort((a, b) =>
    `${a.tso}|${a.border_point}|${a.direction}|${a.period}`.localeCompare(
      `${b.tso}|${b.border_point}|${b.direction}|${b.period}`,
    ),
  );
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(
      "https://ipnew.rbp.eu/Rbp.eu/api/RBPPublic/GetCapacityAuctionList",
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    if (!res.ok) throw new Error(`RBP ${networkPointName}: HTTP ${res.status}`);
    const json = (await res.json()) as {
      success?: boolean;
      data?: RbpAuctionApiRow[];
    };
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
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRbpAuctions(
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
      warnings.push(`RBP ${RBP_POINT_NAMES[idx]}: ${result.reason instanceof Error ? result.reason.message : "unavailable"}`);
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

interface CacheEntry {
  day: string;
  response: {
    capacity: CapacityRow[];
    rbpAuctions: CapacityAuctionRow[];
    fetchedAt: string;
    warnings: string[];
    error: string | null;
  };
}

const capacityCache = new Map<string, CacheEntry>();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export const fetchLiveCapacityBookings = createServerFn({ method: "POST" })
  .inputValidator((d: FetchCapacityArgs) => d)
  .handler(async ({ data }) => {
    const cacheKey = `${data.from}|${data.to}`;
    const today = todayUtc();
    const cached = capacityCache.get(cacheKey);
    if (cached && cached.day === today) return cached.response;

    const warnings: string[] = [];
    try {
      const [capacity, rbp] = await Promise.all([
        fetchEntsogCapacity(data.from, data.to),
        fetchRbpAuctions(data.from, data.to),
      ]);
      warnings.push(...rbp.warnings);
      const response = {
        capacity,
        rbpAuctions: rbp.rows,
        fetchedAt: new Date().toISOString(),
        warnings,
        error: null,
      };
      if (capacity.length > 0 || rbp.rows.length > 0) {
        capacityCache.set(cacheKey, { day: today, response });
      }
      return response;
    } catch (err) {
      if (cached) return cached.response;
      return {
        capacity: [],
        rbpAuctions: [],
        fetchedAt: new Date().toISOString(),
        warnings,
        error: err instanceof Error ? err.message : "Capacity refresh failed",
      };
    }
  });
