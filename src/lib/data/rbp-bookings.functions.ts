// RBP auction allocations (booked via RBP) for the Serbian border points, from RBP's
// public capacity-auction API. Closed yearly, quarterly, monthly and day-ahead auctions;
// within-day auctions are left out (hundreds per day, negligible volumes).
import { createServerFn } from "@tanstack/react-start";
import {
  aggregateByDay,
  parseRbpRow,
  RBP_PRODUCTS,
  RBP_SERBIAN_POINTS,
  type RbpAllocation,
  type RbpApiRow,
  type RbpDay,
} from "@/lib/rbp/bookings";

const RBP_URL = "https://ipnew.rbp.eu/Rbp.eu/api/RBPPublic/GetCapacityAuctionList";
const PAGE = 500;
const MAX_PAGES = 8;
const TIMEOUT_MS = 15_000;
const TTL_MS = 30 * 60 * 1000;

export interface RbpPointBookings {
  name: string;
  label: string;
  corridor: string | null;
  days: RbpDay[];
  /** Closed auctions with a published allocation > 0, newest first. */
  auctions: RbpAllocation[];
  unpublished: number;
}

export interface RbpBookingsResponse {
  points: RbpPointBookings[];
  /** False when RBP returned closed auctions but none carried an allocation field. */
  allocationPublished: boolean;
  warnings: string[];
  fetchedAt: string;
}

const cache = new Map<string, { at: number; res: RbpBookingsResponse }>();

async function post(body: unknown): Promise<{ success?: boolean; data?: RbpApiRow[] }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RBP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { success?: boolean; data?: RbpApiRow[] };
  } finally {
    clearTimeout(t);
  }
}

async function fetchAll(filter: unknown[]): Promise<RbpApiRow[]> {
  const out: RbpApiRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await post({
      start: page * PAGE,
      limit: PAGE,
      sort: [{ property: "CapacityValidFromUTC", direction: "DESC" }],
      filter,
    });
    if (!json.success) throw new Error("unsuccessful response");
    const rows = json.data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchPoint(point: string, from: string, to: string, warnings: string[]) {
  const window = [
    { property: "NetworkPointName", comparison: "eq", value: point },
    { property: "CapacityValidFromUTC", comparison: "lt", value: `${to}T00:00:00` },
    { property: "CapacityValidToUTC", comparison: "gt", value: `${from}T00:00:00` },
  ];
  const rows: RbpApiRow[] = [];
  for (const product of RBP_PRODUCTS) {
    try {
      rows.push(
        ...(await fetchAll([
          ...window,
          { property: "ProductType", comparison: "eq", value: product },
        ])),
      );
    } catch (err) {
      warnings.push(
        `RBP ${point} ${product}: ${err instanceof Error ? err.message : "unavailable"}`,
      );
    }
  }
  return rows;
}

export const fetchRbpBookings = createServerFn({ method: "POST" })
  .inputValidator((d: { from: string; to: string; force?: number | boolean }) => d)
  .handler(async ({ data }): Promise<RbpBookingsResponse> => {
    const key = `${data.from}|${data.to}`;
    const hit = cache.get(key);
    if (!data.force && hit && Date.now() - hit.at < TTL_MS) return hit.res;

    const warnings: string[] = [];
    let closedSeen = 0;
    let fieldSeen = false;
    const points = await Promise.all(
      RBP_SERBIAN_POINTS.map(async (p) => {
        const raw = await fetchPoint(p.name, data.from, data.to, warnings);
        for (const r of raw) {
          if (/closed|finished|allocated/i.test(r.status ?? "")) {
            closedSeen++;
            if (r.unitsAllocated !== undefined) fieldSeen = true;
          }
        }
        const parsed = raw
          .filter((r) => /closed|finished|allocated/i.test(r.status ?? ""))
          .map(parseRbpRow)
          .filter((a): a is RbpAllocation => a !== null && a.point === p.name);
        const seen = new Set<string>();
        const unique = parsed.filter((a) =>
          seen.has(a.auctionCode) ? false : (seen.add(a.auctionCode), true),
        );
        const { days, unpublished } = aggregateByDay(unique, data.from, data.to);
        return {
          ...p,
          days,
          unpublished,
          auctions: unique
            .filter((a) => (a.allocatedMcm ?? 0) > 0)
            .sort((a, b) => b.from.localeCompare(a.from))
            .slice(0, 60),
        };
      }),
    );

    const res: RbpBookingsResponse = {
      points,
      allocationPublished: closedSeen === 0 || fieldSeen,
      warnings,
      fetchedAt: new Date().toISOString(),
    };
    if (closedSeen > 0) cache.set(key, { at: Date.now(), res });
    return res;
  });
