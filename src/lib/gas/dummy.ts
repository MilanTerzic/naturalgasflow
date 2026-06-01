// Realistic dummy data for offline preview. Mirrors dummy.py.
import { CAPACITY_DEFS } from "./config";
import type { CapacityRow, FlowRow, TempRow } from "./types";

// Mulberry32 — deterministic PRNG so the dashboard renders identically each load.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number, mean: number, sd: number) {
  // Box-Muller
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

function dayOfYear(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86_400_000);
}

export function dummyTemperatures(dates: string[]): TempRow[] {
  const rand = mulberry32(42);
  return dates.map((date) => {
    const doy = dayOfYear(date);
    const seasonal = 11 + 13 * Math.cos((2 * Math.PI * (doy - 200)) / 365);
    const noise = gaussian(rand, 0, 1.4);
    return { date, temperature_c: +(seasonal + noise).toFixed(2) };
  });
}

export function dummyFlows(dates: string[]): FlowRow[] {
  const rand = mulberry32(7);
  return dates.map((date) => {
    const doy = dayOfYear(date);
    const winter = 0.5 + 0.5 * Math.cos((2 * Math.PI * (doy - 15)) / 365);
    // HU→RS (Kiskundorozsma) is effectively idle since TurkStream came online.
    const kkdHu = 0;
    // BG→RS via Kireevo carries most of Serbia's supply.
    const kire = Math.max(0, 8.5 + 3.5 * winter + gaussian(rand, 0, 0.3));
    const kkd2 = Math.max(0, 0.3 + 0.3 * winter + gaussian(rand, 0, 0.08));
    const kal = Math.max(0, 1.6 + 1.4 * winter + gaussian(rand, 0, 0.2));
    const kkdHuMet = 0;
    return {
      date,
      kiskundorozsma_hu: +kkdHu.toFixed(3),
      kireevo: +kire.toFixed(3),
      kiskundorozsma_2: +kkd2.toFixed(3),
      kalotina: +kal.toFixed(3),
      kiskundorozsma_hu_met: +kkdHuMet.toFixed(3),
    };
  });
}

// Realistic technical capacity in MWh/d for each route.
// (mcm/d × 10 550 = MWh/d.)  Picked from published TSO technical capacities so
// that physical flow can never exceed technical capacity.
const OFFERED_BASELINE: Record<string, number> = {
  FGSZ_exit: 147_700, // ~14 mcm/d  Kiskundorozsma RO→HU
  Bulgartransgaz_exit: 52_750, // ~5  mcm/d  Kalotina BG→RS
  Gastrans_entry_kireevo: 495_850, // ~47 mcm/d  Strandzha 1 / Kireevo BG→RS
  Gastrans_exit_kkd2: 63_300, // ~6  mcm/d  Kiskundorozsma 2 HU→RS
  FGSZ_entry_kkd2: 63_300, // ~6  mcm/d  Kiskundorozsma 2 HU→RS (HU side)
};

function offeredFor(d: (typeof CAPACITY_DEFS)[number]) {
  let key = d.tso;
  if (d.borderPoint.includes("Kireevo")) key += `_${d.direction}_kireevo`;
  else if (d.borderPoint.includes("Kiskundorozsma 2")) key += `_${d.direction}_kkd2`;
  else key += `_${d.direction}`;
  return OFFERED_BASELINE[key] ?? 80_000;
}

function monthLabel(d: Date) {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${m} ${d.getUTCFullYear()}`;
}

function addMonths(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function quarterLabel(d: Date, offset: number) {
  const q0 = Math.floor(d.getUTCMonth() / 3);
  const q = ((q0 + offset) % 4 + 4) % 4;
  const year = d.getUTCFullYear() + Math.floor((q0 + offset) / 4);
  return `Q${q + 1} ${year}`;
}

export interface DummyCapacityRange {
  fromISO: string;
  toISO: string;
}

export function dummyCapacity(
  yearsAhead = 1,
): { rows: CapacityRow[]; range: DummyCapacityRange } {
  const rand = mulberry32(11);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const days = Math.max(7, Math.round(365 * yearsAhead));
  const months = Math.max(3, Math.round(12 * yearsAhead));
  const quarters = Math.max(2, Math.round(4 * yearsAhead));

  const dailyOffsets: number[] = [];
  for (let o = -2; o <= days; o++) dailyOffsets.push(o);
  const monthlyOffsets: number[] = [];
  for (let o = 0; o <= months; o++) monthlyOffsets.push(o);
  const quarterlyOffsets: number[] = [];
  for (let o = 0; o <= quarters; o++) quarterlyOffsets.push(o);

  const periods: Record<"daily" | "monthly" | "quarterly", string[]> = {
    daily: dailyOffsets.map((o) => addDays(today, o).toISOString().slice(0, 10)),
    monthly: monthlyOffsets.map((o) => monthLabel(addMonths(today, o))),
    quarterly: quarterlyOffsets.map((o) => quarterLabel(today, o)),
  };

  const rows: CapacityRow[] = [];
  for (const d of CAPACITY_DEFS) {
    const offered = offeredFor(d);
    for (const product of ["daily", "monthly", "quarterly"] as const) {
      for (const period of periods[product]) {
        const booked = offered * (0.45 + 0.5 * rand());
        const price = d.currency === "HUF"
          ? 0.0015 + (0.0040 - 0.0015) * rand()
          : 0.00002 + (0.00012 - 0.00002) * rand();
        rows.push({
          tso: d.tso,
          border_point: d.borderPoint,
          direction: d.direction,
          product,
          period,
          offered_mwh: Math.round(offered),
          booked_mwh: Math.round(booked),
          utilisation_pct: +((booked / offered) * 100).toFixed(1),
          price,
          currency: d.currency,
          price_unit: d.priceUnit,
        });
      }
    }
  }

  const fromISO = addDays(today, -2).toISOString().slice(0, 10);
  const toISO = addDays(today, days).toISOString().slice(0, 10);
  return { rows, range: { fromISO, toISO } };
}
