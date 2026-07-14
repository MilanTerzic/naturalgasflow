// Real ENTSOG operational data snapshot (Oct 2025 → Jun 2026).
// Source: transparency.entsog.eu / operationaldata.xlsx (uploaded 2026-06-01).
import snapshot from "./entsog-snapshot.json";
import { CAPACITY_DEFS, CONVERSION_MCM_TO_MWH } from "./config";
import { CAPACITY_ROUTES } from "./capacity-routes";
import type { CapacityRow, FlowRow } from "./types";

type SnapRoute = {
  technical_kwh: (number | null)[];
  booked_kwh: (number | null)[];
  flow_kwh: (number | null)[];
};

const SNAP = snapshot as {
  fromISO: string;
  toISO: string;
  days: string[];
  routes: Record<string, SnapRoute>;
};

// Map CAPACITY_DEFS entries → snapshot route key.
// Gastrans (RS-side) doesn't publish to ENTSOG so we mirror the BG/HU partner
// side of the same physical pipe.
function snapKeyFor(d: (typeof CAPACITY_DEFS)[number]): keyof typeof SNAP.routes | null {
  const bp = d.borderPoint.toLowerCase();
  if (d.tso === "FGSZ" && bp.includes("kiskundorozsma 2")) return "FGSZ_KKD2_entry";
  if (d.tso === "Gastrans" && bp.includes("kiskundorozsma 2")) return "FGSZ_KKD2_entry";
  if (d.tso === "FGSZ" && bp.includes("kiskundorozsma")) return "FGSZ_KKD_exit";
  if (d.tso === "Bulgartransgaz" && bp.includes("kireevo")) return "BG_Kireevo_exit";
  if (d.tso === "Gastrans" && bp.includes("kireevo")) return "BG_Kireevo_exit";
  if (bp.includes("kalotina")) return "BG_Kalotina_exit";
  return null;
}

// kWh/d → MWh/d
const toMwh = (v: number | null | undefined) => (v == null ? 0 : v / 1000);
// kWh/d → mcm/d
const toMcm = (v: number | null | undefined) => (v == null ? 0 : v / 1000 / CONVERSION_MCM_TO_MWH);

function clipIndices(fromISO: string, toISO: string) {
  const lo = SNAP.days.findIndex((d) => d >= fromISO);
  let hi = SNAP.days.findIndex((d) => d >= toISO);
  if (hi === -1) hi = SNAP.days.length;
  return { lo: lo === -1 ? SNAP.days.length : lo, hi };
}

export interface RealDataRange {
  fromISO: string;
  toISO: string;
  snapshotFrom: string;
  snapshotTo: string;
}

export function realCapacityAndFlows({ fromISO, toISO }: { fromISO: string; toISO: string }): {
  capacity: CapacityRow[];
  flows: FlowRow[];
  range: RealDataRange;
} {
  const { lo, hi } = clipIndices(fromISO, toISO);
  const days = SNAP.days.slice(lo, hi);

  // Build daily CapacityRow per route — one row per day with the technical /
  // booked values for that day. The dashboard aggregates with max() across
  // products, so emitting daily-only rows is sufficient.
  const capacity: CapacityRow[] = [];
  for (const [idx, d] of CAPACITY_DEFS.entries()) {
    const route = CAPACITY_ROUTES[idx];
    const key = snapKeyFor(d);
    if (!key) continue;
    const r = SNAP.routes[key];
    if (!r) continue;
    for (let i = lo; i < hi; i++) {
      const tech = r.technical_kwh[i];
      const book = r.booked_kwh[i];
      if (tech == null && book == null) continue;
      const offered = toMwh(tech ?? 0);
      const booked = toMwh(Math.min(book ?? 0, tech ?? Number.POSITIVE_INFINITY));
      capacity.push({
        route_id: route?.id,
        tso: d.tso,
        border_point: route?.borderPoint ?? d.borderPoint,
        direction: d.direction,
        product: "daily",
        period: SNAP.days[i],
        technical_mwh: Math.round(offered),
        offered_mwh: Math.round(offered),
        booked_mwh: Math.round(booked),
        utilisation_pct: offered > 0 ? +((booked / offered) * 100).toFixed(1) : 0,
        price: 0,
        currency: d.currency,
        price_unit: d.priceUnit,
        source: "snapshot",
        source_date: SNAP.days[i],
        capacity_source_date: SNAP.days[i],
        fetched_at: "2026-06-01T00:00:00Z",
        is_proxy: route?.sourceStrategy === "counterparty-proxy",
        is_carried_forward: false,
        is_stale: true,
        data_status: "historical",
        warning:
          route?.sourceStrategy === "counterparty-proxy"
            ? "Counterparty-side proxy from historical snapshot."
            : undefined,
      });
    }
  }

  // Build FlowRow per day (one row per date, all flow points in mcm/d).
  const flows: FlowRow[] = days.map((date, i) => {
    const idx = lo + i;
    const kkd = SNAP.routes.FGSZ_KKD_exit?.flow_kwh[idx];
    const kire = SNAP.routes.BG_Kireevo_exit?.flow_kwh[idx];
    const kkd2 = SNAP.routes.FGSZ_KKD2_entry?.flow_kwh[idx];
    const kal = SNAP.routes.BG_Kalotina_exit?.flow_kwh[idx];
    return {
      date,
      kiskundorozsma_hu: +toMcm(kkd).toFixed(3),
      kireevo: +toMcm(kire).toFixed(3),
      kiskundorozsma_2: +toMcm(kkd2).toFixed(3),
      kalotina: +toMcm(kal).toFixed(3),
      kiskundorozsma_hu_met: 0,
    };
  });

  return {
    capacity,
    flows,
    range: {
      fromISO,
      toISO,
      snapshotFrom: SNAP.fromISO,
      snapshotTo: SNAP.toISO,
    },
  };
}

export const SNAPSHOT_RANGE = { fromISO: SNAP.fromISO, toISO: SNAP.toISO };
