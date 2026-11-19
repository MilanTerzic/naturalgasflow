// RBP (Regional Booking Platform) auction allocations for the Serbian border points.
// Pure module: parsing, unit conversion and per-gas-day aggregation. No framework imports.
//
// Units differ by offering TSO: Gastrans offers in kWh/h, Transportgas Srbija in kWh/d.
// The API states the unit in reservePriceUnitExitTSO / reservePriceUnitEntryTSO
// ("kWh/h/month", "kWh/d/day", …), which is what we read; we never guess from the TSO name.
// Allocated capacity is RBP's "unitsAllocated" ("Allocated capacity" in RBP exports),
// published on closed auctions. These are auction allocations only: long-term contracts
// signed outside RBP are not in them.

export const RBP_PRODUCTS = ["Yearly", "Quarterly", "Monthly", "Day ahead"] as const;
export type RbpProduct = (typeof RBP_PRODUCTS)[number];

export interface RbpPoint {
  /** RBP NetworkPointName, exactly as RBP spells it. */
  name: string;
  label: string;
  /** Balkan-map corridor this point belongs to, when there is one. */
  corridor: string | null;
}

export const RBP_SERBIAN_POINTS: RbpPoint[] = [
  {
    name: "Kireevo (BG) / Zaychar (RS)",
    label: "Kireevo / Zaychar (Gastrans)",
    corridor: "bg_rs_kz",
  },
  { name: "Kiskundorozsma 2", label: "Kiskundorozsma 2 / Horgoš (Gastrans)", corridor: "rs_hu_2" },
  {
    name: "Serbia Virtual Point Gastrans",
    label: "Serbia VP Gastrans ↔ Transportgas",
    corridor: null,
  },
  {
    name: "Kalotina (BG)/Dimitrovgrad (RS)",
    label: "Kalotina / Dimitrovgrad (Transportgas)",
    corridor: "bg_rs_kal",
  },
  {
    name: "Kiskundorozsma (HU) / Kiskundorozsma (RS)",
    label: "Kiskundorozsma HU→RS (Transportgas)",
    corridor: "hu_rs_1",
  },
  { name: "IP Loznica", label: "Loznica / Zvornik RS→BA (Transportgas)", corridor: "rs_ba_zv" },
];

/** Subset of the RBP public API row we use. */
export interface RbpApiRow {
  auctionCode?: string;
  networkPointName?: string;
  productType?: string;
  status?: string;
  capacityValidFromUTC?: string;
  capacityValidToUTC?: string;
  offeredCapacity?: number | null;
  unitsAllocated?: number | null;
  reservePriceUnitExitTSO?: string;
  reservePriceUnitEntryTSO?: string;
  exitTSOName?: string;
  entryTSOName?: string;
  offeringTSO?: string;
  allocatedClearingUnitPriceExitTso?: number | null;
  allocatedClearingUnitPriceEntryTso?: number | null;
}

export interface RbpAllocation {
  auctionCode: string;
  point: string;
  product: string;
  status: string;
  /** Gas day the capacity starts (inclusive) and ends (exclusive), YYYY-MM-DD. */
  from: string;
  to: string;
  exitTso: string;
  entryTso: string;
  offeringTso: string;
  unit: "kWh/h" | "kWh/d";
  offeredMcm: number | null;
  /** null when RBP published no allocation for the auction. */
  allocatedMcm: number | null;
}

const MCM_TO_KWH = 10.55e6; // 1 mcm = 10.55 GWh

/** "kWh/h/month" → "kWh/h"; anything we do not recognise → null (row is skipped, not guessed). */
export function rbpUnit(row: RbpApiRow): "kWh/h" | "kWh/d" | null {
  const u = `${row.reservePriceUnitExitTSO ?? ""} ${row.reservePriceUnitEntryTSO ?? ""}`;
  const hasH = /kWh\/h/i.test(u);
  const hasD = /kWh\/d/i.test(u);
  if (hasH && !hasD) return "kWh/h";
  if (hasD && !hasH) return "kWh/d";
  return null;
}

export function toMcmPerDay(
  value: number | null | undefined,
  unit: "kWh/h" | "kWh/d",
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const kwhPerDay = unit === "kWh/h" ? value * 24 : value;
  return kwhPerDay / MCM_TO_KWH;
}

/** RBP validity starts at the gas-day start (04:00/05:00 UTC), so the date part is the gas day. */
const gasDay = (iso: string | undefined) => (iso ?? "").slice(0, 10);

export function parseRbpRow(row: RbpApiRow): RbpAllocation | null {
  const unit = rbpUnit(row);
  const from = gasDay(row.capacityValidFromUTC);
  const to = gasDay(row.capacityValidToUTC);
  if (!unit || !from || !to || !row.networkPointName) return null;
  return {
    auctionCode: row.auctionCode ?? "",
    point: row.networkPointName,
    product: row.productType ?? "",
    status: row.status ?? "",
    from,
    to,
    exitTso: row.exitTSOName ?? "",
    entryTso: row.entryTSOName ?? "",
    offeringTso: row.offeringTSO ?? "",
    unit,
    offeredMcm: toMcmPerDay(row.offeredCapacity, unit),
    allocatedMcm: row.unitsAllocated == null ? null : toMcmPerDay(Number(row.unitsAllocated), unit),
  };
}

export interface RbpDay {
  date: string;
  /** Sum of allocations in force on the gas day, by product. */
  byProduct: Partial<Record<RbpProduct, number>>;
  total: number;
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Per gas day in [from, to): the allocated capacity of every closed auction whose validity
 * covers that day, split by product. Auctions without a published allocation are skipped
 * (they are counted in `unpublished`), never treated as zero.
 */
export function aggregateByDay(
  allocations: RbpAllocation[],
  from: string,
  to: string,
): { days: RbpDay[]; unpublished: number } {
  const days: RbpDay[] = [];
  const index = new Map<string, RbpDay>();
  for (let d = from; d < to; d = addDays(d, 1)) {
    const day: RbpDay = { date: d, byProduct: {}, total: 0 };
    days.push(day);
    index.set(d, day);
  }
  let unpublished = 0;
  for (const a of allocations) {
    if (a.allocatedMcm == null) {
      unpublished++;
      continue;
    }
    if (a.allocatedMcm <= 0) continue;
    const product = (RBP_PRODUCTS as readonly string[]).includes(a.product)
      ? (a.product as RbpProduct)
      : null;
    if (!product) continue;
    for (let d = a.from < from ? from : a.from; d < a.to && d < to; d = addDays(d, 1)) {
      const day = index.get(d);
      if (!day) continue;
      day.byProduct[product] = (day.byProduct[product] ?? 0) + a.allocatedMcm;
      day.total += a.allocatedMcm;
    }
  }
  for (const d of days) {
    d.total = +d.total.toFixed(4);
    for (const k of Object.keys(d.byProduct) as RbpProduct[])
      d.byProduct[k] = +(d.byProduct[k] as number).toFixed(4);
  }
  return { days, unpublished };
}
