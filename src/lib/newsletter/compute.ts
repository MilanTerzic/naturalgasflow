// Pure helpers for the daily gas newsletter: which gas day to report, price rows,
// storage rows and the summary sentences. Relative imports only (unit-tested in
// tests/newsletter-compute.test.mjs). Missing data stays missing: every figure is
// null when its source did not publish, and sentences are left out rather than guessed.

import { serbiaBalanceForRow } from "../region/serbia-balance";
import { pointSource } from "../region/map-model";
import type { BalanceRow, FlowPointName, FlowRow } from "../gas/types";

export const FLOW_POINTS: FlowPointName[] = [
  "kalotina",
  "kireevo",
  "kiskundorozsma_hu",
  "kiskundorozsma_2",
];

export const addDaysISO = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

/** True when every Serbian border point carries the primary (non-nomination) series. */
export function isCompleteFlowDay(
  row: FlowRow | undefined,
  primary: "physical_flow" | "allocation",
) {
  return !!row && FLOW_POINTS.every((p) => pointSource(row, p, primary) === primary);
}

/**
 * Gas day the newsletter reports flows for: the newest day before `today` on which all
 * four Serbian points published the primary series. Falls back to the newest day before
 * today with any data, flagged as incomplete.
 */
export function pickFlowDay(
  rows: FlowRow[],
  today: string,
  primary: "physical_flow" | "allocation" = "physical_flow",
): { date: string | null; complete: boolean } {
  const past = rows.filter((r) => r.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const full = past.find((r) => isCompleteFlowDay(r, primary));
  if (full) return { date: full.date, complete: true };
  return { date: past[0]?.date ?? null, complete: false };
}

export interface PointRow {
  point: FlowPointName;
  /** mcm/day on the flow day; null when not published. */
  value: number | null;
  /** Mean over the seven gas days before the flow day (published days only). */
  avg7: number | null;
  change: number | null;
}

export function pointRows(
  rows: FlowRow[],
  flowDay: string | null,
  primary: "physical_flow" | "allocation" = "physical_flow",
): PointRow[] {
  const day = rows.find((r) => r.date === flowDay);
  const from = flowDay ? addDaysISO(flowDay, -7) : "";
  const window = rows.filter((r) => flowDay && r.date >= from && r.date < flowDay);
  return FLOW_POINTS.map((point) => {
    const value = day && pointSource(day, point, primary) === primary ? day[point] : null;
    const avg7 = mean(
      window.filter((r) => pointSource(r, point, primary) === primary).map((r) => r[point]),
    );
    return { point, value, avg7, change: value !== null && avg7 !== null ? value - avg7 : null };
  });
}

export interface NetIntoSerbia {
  net: number | null;
  avg7: number | null;
  change: number | null;
}

/** Net into Serbia (same definition as the Balkan map) on the flow day and its 7-day mean. */
export function netIntoSerbia(
  rows: FlowRow[],
  balance: Pick<BalanceRow, "date" | "bosnia_consumption_mcm">[],
  flowDay: string | null,
): NetIntoSerbia {
  const bosnia = new Map(balance.map((b) => [b.date, b.bosnia_consumption_mcm]));
  const netFor = (r: FlowRow | undefined) =>
    r ? serbiaBalanceForRow(r, bosnia.get(r.date) ?? null).net : null;
  const net = netFor(rows.find((r) => r.date === flowDay));
  const from = flowDay ? addDaysISO(flowDay, -7) : "";
  const avg7 = mean(
    rows
      .filter((r) => flowDay && r.date >= from && r.date < flowDay)
      .map(netFor)
      .filter((v): v is number => v !== null),
  );
  return { net, avg7, change: net !== null && avg7 !== null ? net - avg7 : null };
}

export interface PriceInputPoint {
  date: string | null;
  label: string;
  price: number;
  final: boolean;
}

export interface PriceRow {
  hub: string;
  latest: PriceInputPoint | null;
  previous: PriceInputPoint | null;
  change: number | null;
  /** latest − TTF on the same delivery day; null when TTF has no price for that day. */
  spreadTtf: number | null;
}

const dated = (points: PriceInputPoint[]) =>
  points
    .filter((p): p is PriceInputPoint & { date: string } => !!p.date && Number.isFinite(p.price))
    .sort((a, b) => a.date.localeCompare(b.date));

/** Latest, previous and same-day TTF spread per hub. Hubs without prices keep null fields. */
export function priceRows(hubs: Record<string, PriceInputPoint[] | undefined>): PriceRow[] {
  const ttfByDay = new Map(dated(hubs.TTF ?? []).map((p) => [p.date, p.price]));
  return Object.entries(hubs).map(([hub, points]) => {
    const list = dated(points ?? []);
    const latest = list.at(-1) ?? null;
    const previous = list.at(-2) ?? null;
    const ttf = latest ? ttfByDay.get(latest.date) : undefined;
    return {
      hub,
      latest,
      previous,
      change: latest && previous ? latest.price - previous.price : null,
      spreadTtf: hub !== "TTF" && latest && ttf !== undefined ? latest.price - ttf : null,
    };
  });
}

/** Rows for a multi-hub price chart: one row per delivery day, null where a hub is missing. */
export function priceChartRows(
  hubs: Record<string, PriceInputPoint[] | undefined>,
  from: string,
): Array<Record<string, number | string | null>> {
  const byDay = new Map<string, Record<string, number | string | null>>();
  for (const [hub, points] of Object.entries(hubs)) {
    for (const p of dated(points ?? [])) {
      if (p.date < from) continue;
      const row = byDay.get(p.date) ?? { date: p.date };
      row[hub] = p.price;
      byDay.set(p.date, row);
    }
  }
  const keys = Object.keys(hubs);
  return [...byDay.values()]
    .map((row) => {
      for (const k of keys) if (!(k in row)) row[k] = null;
      return row;
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export interface StorageInputRow {
  gasDayStart: string;
  gasInStorage: number | null;
  full: number | null;
  injection: number | null;
  withdrawal: number | null;
}

export interface StorageRow {
  date: string | null;
  full: number | null;
  /** TWh. */
  gasInStorage: number | null;
  /** Percentage points against the newest day at least seven days earlier. */
  changeWeek: number | null;
  /** GWh/d, injection − withdrawal. */
  netInjection: number | null;
}

export function storageRow(data: StorageInputRow[] | undefined): StorageRow {
  const list = [...(data ?? [])]
    .filter((r) => r.full !== null)
    .sort((a, b) => a.gasDayStart.localeCompare(b.gasDayStart));
  const last = list.at(-1);
  if (!last)
    return { date: null, full: null, gasInStorage: null, changeWeek: null, netInjection: null };
  const weekAgo = [...list]
    .reverse()
    .find((r) => r.gasDayStart <= addDaysISO(last.gasDayStart, -7));
  return {
    date: last.gasDayStart,
    full: last.full,
    gasInStorage: last.gasInStorage,
    changeWeek: weekAgo?.full != null && last.full != null ? last.full - weekAgo.full : null,
    netInjection:
      last.injection !== null && last.withdrawal !== null ? last.injection - last.withdrawal : null,
  };
}

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);
const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

export interface SummaryInput {
  flowDay: string | null;
  flowComplete: boolean;
  net: NetIntoSerbia;
  points: PointRow[];
  deliveryDay: string;
  demandD1: { demand: number | null; temperature: number | null } | null;
  prices: PriceRow[];
  storageRs: StorageRow | null;
}

const POINT_LABEL: Record<FlowPointName, string> = {
  kalotina: "Kalotina",
  kireevo: "Kireevo/Zaječar",
  kiskundorozsma_hu: "Kiskundorozsma (HU→RS)",
  kiskundorozsma_2: "Horgoš transit to HU",
};

/** Plain-language summary lines for the email body. A line is dropped when its data is missing. */
export function summarySentences(s: SummaryInput): string[] {
  const out: string[] = [];
  if (s.flowDay && s.net.net !== null) {
    out.push(
      `Net into Serbia on gas day ${s.flowDay}: ${f1(s.net.net)} mcm/d` +
        (s.net.change !== null ? ` (${signed(s.net.change)} vs 7-day average).` : "."),
    );
  } else if (!s.flowDay) {
    out.push("No ENTSOG physical flow for the Serbian border points was available at send time.");
  } else if (s.flowDay) {
    out.push(
      `Gas day ${s.flowDay}: not every Serbian border point has published ENTSOG physical flow yet.`,
    );
  }
  const moves = s.points
    .filter((p) => p.change !== null && Math.abs(p.change) >= 0.5)
    .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))
    .slice(0, 2);
  if (moves.length) {
    out.push(
      `Largest moves vs 7-day average: ${moves
        .map((p) => `${POINT_LABEL[p.point]} ${f1(p.value!)} mcm/d (${signed(p.change!)})`)
        .join("; ")}.`,
    );
  }
  if (s.demandD1?.demand != null) {
    out.push(
      `Serbian demand forecast for ${s.deliveryDay}: ${f1(s.demandD1.demand)} mcm/d` +
        (s.demandD1.temperature != null
          ? ` at ${f1(s.demandD1.temperature)} °C average temperature (Belgrade).`
          : "."),
    );
  }
  const by = Object.fromEntries(s.prices.map((p) => [p.hub, p]));
  const hubText = (hub: string, name = hub) => {
    const p = by[hub];
    if (!p?.latest) return null;
    return (
      `${name} €${f2(p.latest.price)}` +
      (p.change !== null ? ` (${signed(p.change, 2)})` : "") +
      (p.spreadTtf !== null ? `, ${signed(p.spreadTtf, 2)} vs TTF` : "")
    );
  };
  const priceParts = ["TTF", "CEGH", "BGH", "CEEGEX"].map((h) => hubText(h)).filter(Boolean);
  if (priceParts.length)
    out.push(`Day-ahead prices (€/MWh, latest published): ${priceParts.join("; ")}.`);
  if (s.storageRs?.full != null) {
    out.push(
      `Serbian storage (AGSI, ${s.storageRs.date}): ${f1(s.storageRs.full)}% full` +
        (s.storageRs.changeWeek !== null
          ? ` (${signed(s.storageRs.changeWeek)} pp week on week).`
          : "."),
    );
  }
  return out;
}
