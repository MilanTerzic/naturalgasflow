// Real ENTSOG operational data snapshot (Oct 2025 → Jun 2026).
// Source: transparency.entsog.eu / operationaldata.xlsx (uploaded 2026-06-01).
import snapshot from "./entsog-snapshot.json";
import { CAPACITY_DEFS, CONVERSION_MCM_TO_MWH } from "./config";
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
const toMcm = (v: number | null | undefined) =>
  v == null ? 0 : v / 1000 / CONVERSION_MCM_TO_MWH;

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

export function realCapacityAndFlows({
  fromISO,
  toISO,
}: {
  fromISO: string;
  toISO: string;
}): { capacity: CapacityRow[]; flows: FlowRow[]; range: RealDataRange } {
  const { lo, hi } = clipIndices(fromISO, toISO);
  const days = SNAP.days.slice(lo, hi);

  // Build the full requested day list. If toISO extends past the snapshot we
  // forward-fill technical/booked capacity from the last known day so the
  // capacity stack charts can show a full forward window (flows stay empty
  // for those days — we only have measured flow up to the snapshot end).
  const allDates: string[] = [];
  {
    const start = new Date(`${fromISO}T00:00:00Z`);
    const end = new Date(`${toISO}T00:00:00Z`);
    for (let t = start.getTime(); t < end.getTime(); t += 86400000) {
      allDates.push(new Date(t).toISOString().slice(0, 10));
    }
  }
  const snapLastIdx = SNAP.days.length - 1;

  // Build daily CapacityRow per route — one row per day with the technical /
  // booked values for that day. Days beyond the snapshot inherit the last
  // known technical/booked values (capacity bookings are relatively static).
  const capacity: CapacityRow[] = [];
  for (const d of CAPACITY_DEFS) {
    const key = snapKeyFor(d);
    if (!key) continue;
    const r = SNAP.routes[key];
    if (!r) continue;
    for (const date of allDates) {
      let i = SNAP.days.indexOf(date);
      const isExtrapolated = i === -1;
      if (isExtrapolated) {
        if (date < SNAP.days[0]) continue; // before snapshot — skip
        i = snapLastIdx; // forward-fill from last snapshot day
      }
      const tech = r.technical_kwh[i];
      const book = r.booked_kwh[i];
      if (tech == null && book == null) continue;
      const offered = toMwh(tech ?? 0);
      const booked = toMwh(Math.min(book ?? 0, tech ?? Number.POSITIVE_INFINITY));
      capacity.push({
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
  }

  // Build FlowRow per day — only for dates inside the snapshot (no extrapolation).
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
