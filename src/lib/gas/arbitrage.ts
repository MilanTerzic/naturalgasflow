// Cross-border gas arbitrage and delivered-price engine (daily firm products, one gas day).
// Deterministic: hub prices for exactly the delivery day, official tariffs, explicit statuses.
// Relative imports only (unit-tested in tests/arbitrage.test.mjs).

import { dailyEurPerMwh, type FxRates } from "./tariffs/convert";
import { CHARGE_BY_ID, GASTRANS_FUEL, TARIFF_BY_ID } from "./tariffs/data";
import type { TariffStatus } from "./tariffs/types";

export type Leg =
  | { kind: "capacity"; id: string }
  | { kind: "charge"; id: string }
  | { kind: "fuel"; operator: "Gastrans" };

export interface RouteDef {
  id: string;
  label: string;
  short: string;
  origin: "BGH" | "CEEGEX";
  /** Destination hub for a transit trade; null = delivered into Serbia (no Serbian hub price). */
  destination: "BGH" | "CEEGEX" | null;
  legs: Leg[];
  note?: string;
}

const BTG_FLOW: Leg[] = [
  { kind: "charge", id: "btg-commodity" },
  { kind: "charge", id: "btg-neutrality" },
];

export const ROUTES: RouteDef[] = [
  {
    id: "bg-rs-hu",
    label: "Bulgaria → Serbia → Hungary (Gastrans)",
    short: "BG→HU via Gastrans",
    origin: "BGH",
    destination: "CEEGEX",
    legs: [
      { kind: "capacity", id: "btg-kireevo-exit" },
      ...BTG_FLOW,
      { kind: "capacity", id: "gt-kirevo-entry" },
      { kind: "capacity", id: "gt-horgos-exit" },
      { kind: "fuel", operator: "Gastrans" },
      { kind: "capacity", id: "fgsz-kkd-entry" },
    ],
  },
  {
    id: "hu-rs-bg",
    label: "Hungary → Serbia → Bulgaria (Gastrans commercial reverse)",
    short: "HU→BG via Gastrans reverse",
    origin: "CEEGEX",
    destination: "BGH",
    legs: [
      { kind: "capacity", id: "fgsz-kkd-exit" },
      { kind: "charge", id: "fgsz-volume-fee" },
      { kind: "capacity", id: "gt-horgos-reverse-entry" },
      { kind: "capacity", id: "gt-kirevo-reverse-exit" },
      { kind: "capacity", id: "btg-kireevo-entry" },
      ...BTG_FLOW,
    ],
    note: "Commercial reverse exists only while Gastrans flows forward (BG→HU).",
  },
  {
    id: "bg-rs-gastrans",
    label: "Bulgaria → Serbia via Gastrans Exit Serbia",
    short: "BG→RS via Gastrans",
    origin: "BGH",
    destination: null,
    legs: [
      { kind: "capacity", id: "btg-kireevo-exit" },
      ...BTG_FLOW,
      { kind: "capacity", id: "gt-kirevo-entry" },
      { kind: "capacity", id: "gt-domestic-exit" },
      { kind: "fuel", operator: "Gastrans" },
      { kind: "capacity", id: "tgs-entry-ts" },
    ],
  },
  {
    id: "bg-rs-kalotina",
    label: "Bulgaria → Serbia via Kalotina/Dimitrovgrad",
    short: "BG→RS via Kalotina",
    origin: "BGH",
    destination: null,
    legs: [
      { kind: "capacity", id: "btg-kalotina-exit" },
      ...BTG_FLOW,
      { kind: "capacity", id: "tgs-entry-ts" },
    ],
  },
  {
    id: "hu-rs-kkd1",
    label: "Hungary → Serbia via Kiskundorozsma 1 (Transportgas)",
    short: "HU→RS via KKD1",
    origin: "CEEGEX",
    destination: null,
    legs: [
      { kind: "capacity", id: "fgsz-kkd-exit" },
      { kind: "charge", id: "fgsz-volume-fee" },
      { kind: "capacity", id: "tgs-entry-ts" },
    ],
  },
];

export interface PricePoint {
  date: string;
  price: number;
  final: boolean;
}

export interface LegResult {
  label: string;
  operator: string;
  kind: Leg["kind"];
  eurPerMwh: number | null;
  status: TariffStatus;
  working: string;
  source: string;
}

export interface RouteResult {
  route: RouteDef;
  deliveryDay: string;
  origin: PricePoint | null;
  destination: PricePoint | null;
  legs: LegResult[];
  capacityCost: number | null;
  fuelCost: number | null;
  otherFees: number | null;
  transportCost: number | null;
  /** Origin price + transport: the price of 1 MWh landed at the route's end. */
  delivered: number | null;
  gross: number | null;
  netMargin: number | null;
  /** Gross spread needed to cover transport = transport cost. */
  breakEven: number | null;
  /** Largest auction premium (EUR/MWh) on top of reserve prices that still breaks even. */
  maxPremium: number | null;
  status: TariffStatus;
  provisional: boolean;
  /** Commercial availability of every leg is not yet checked: results are indicative. */
  availability: "unknown";
}

const worst = (a: TariffStatus, b: TariffStatus): TariffStatus => {
  const rank: TariffStatus[] = ["VERIFIED", "STALE", "ESTIMATED", "UNAVAILABLE"];
  return rank.indexOf(a) >= rank.indexOf(b) ? a : b;
};
const sum = (xs: Array<number | null>) =>
  xs.some((x) => x === null) ? null : xs.reduce<number>((s, x) => s + (x as number), 0);

function feeEur(id: string, fx: FxRates | null): { eur: number | null; working: string } {
  const c = CHARGE_BY_ID[id];
  if (c.currency === "EUR") return { eur: c.value, working: `${c.value} EUR/MWh` };
  if (!fx?.hufPerEur) return { eur: null, working: "no EUR/HUF rate" };
  return {
    eur: c.value / fx.hufPerEur,
    working: `${c.value} HUF/MWh / ${fx.hufPerEur.toFixed(2)} HUF/EUR`,
  };
}

/** One route for one delivery day. Prices must already be for exactly that day. */
export function computeRoute(
  route: RouteDef,
  deliveryDay: string,
  prices: { origin: PricePoint | null; destination: PricePoint | null },
  fx: FxRates | null,
): RouteResult {
  const origin = prices.origin?.date === deliveryDay ? prices.origin : null;
  const destination =
    route.destination && prices.destination?.date === deliveryDay ? prices.destination : null;
  const legs: LegResult[] = route.legs.map((leg) => {
    if (leg.kind === "capacity") {
      const t = TARIFF_BY_ID[leg.id];
      const c = dailyEurPerMwh(t, deliveryDay, fx);
      return {
        label: `${t.point} ${t.direction}${t.capacity === "reverse" ? " (reverse)" : ""}`,
        operator: t.operator,
        kind: "capacity",
        eurPerMwh: c.eurPerMwh,
        status: c.status,
        working: c.working,
        source: t.sourceDoc,
      };
    }
    if (leg.kind === "charge") {
      const c = CHARGE_BY_ID[leg.id];
      const f = feeEur(leg.id, fx);
      const inForce = deliveryDay >= c.effectiveFrom && deliveryDay <= c.effectiveTo;
      return {
        label: c.label,
        operator: c.operator,
        kind: "charge",
        eurPerMwh: inForce ? f.eur : null,
        status: inForce && f.eur !== null ? c.status : "UNAVAILABLE",
        working: f.working,
        source: c.source,
      };
    }
    // Gastrans fuel in kind: X1 of the gas entering is consumed; value it at the origin price.
    const x = GASTRANS_FUEL.x1;
    const eur = origin ? (origin.price * x) / (1 - x) : null;
    return {
      label: `Fuel gas X1 ${(x * 100).toFixed(2)}% (in kind)`,
      operator: "Gastrans",
      kind: "fuel",
      eurPerMwh: eur,
      status: eur === null ? "UNAVAILABLE" : GASTRANS_FUEL.status,
      working: `${(x * 100).toFixed(2)}% × origin price / (1 − X1)`,
      source: GASTRANS_FUEL.source,
    };
  });

  const pick = (k: Leg["kind"]) => legs.filter((l) => l.kind === k).map((l) => l.eurPerMwh);
  const capacityCost = sum(pick("capacity"));
  const fuelCost = pick("fuel").length ? sum(pick("fuel")) : 0;
  const otherFees = pick("charge").length ? sum(pick("charge")) : 0;
  const transportCost = sum([capacityCost, fuelCost, otherFees]);
  const delivered = origin && transportCost !== null ? origin.price + transportCost : null;
  const gross = origin && destination ? destination.price - origin.price : null;
  const netMargin = destination && delivered !== null ? destination.price - delivered : null;

  let status: TariffStatus = legs.reduce<TariffStatus>((s, l) => worst(s, l.status), "VERIFIED");
  if (!origin || (route.destination && !destination)) status = "UNAVAILABLE";

  return {
    route,
    deliveryDay,
    origin,
    destination,
    legs,
    capacityCost,
    fuelCost,
    otherFees,
    transportCost,
    delivered,
    gross,
    netMargin,
    breakEven: transportCost,
    maxPremium: netMargin !== null && capacityCost !== null ? netMargin : null,
    status,
    provisional: Boolean((origin && !origin.final) || (destination && !destination.final)),
    availability: "unknown",
  };
}

export function computeAll(
  deliveryDay: string,
  hubPrices: Record<"BGH" | "CEEGEX", PricePoint[]>,
  fx: FxRates | null,
): RouteResult[] {
  const on = (hub: "BGH" | "CEEGEX") => hubPrices[hub].find((p) => p.date === deliveryDay) ?? null;
  return ROUTES.map((r) =>
    computeRoute(
      r,
      deliveryDay,
      { origin: on(r.origin), destination: r.destination ? on(r.destination) : null },
      fx,
    ),
  );
}

/** Opportunity threshold for the newsletter summary, EUR/MWh net margin. */
export const SIGNAL_THRESHOLD = 1;

const f2 = (v: number) => v.toFixed(2);

/** Summary sentences: a transit opportunity above the threshold, and the cheapest landed price in Serbia. */
export function arbitrageSentences(results: RouteResult[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    if (r.netMargin === null || r.netMargin < SIGNAL_THRESHOLD || r.status === "UNAVAILABLE")
      continue;
    out.push(
      `Arbitrage (indicative, capacity availability not checked): ${r.route.short} for ${r.deliveryDay} nets €${f2(r.netMargin)}/MWh ` +
        `(${r.route.destination} €${f2(r.destination!.price)} − delivered €${f2(r.delivered!)}, transport €${f2(r.transportCost!)}).`,
    );
  }
  const landed = results
    .filter((r) => r.route.destination === null && r.delivered !== null)
    .sort((a, b) => a.delivered! - b.delivered!);
  if (landed.length) {
    const best = landed[0];
    const rest = landed.slice(1).map((r) => `${r.route.short} €${f2(r.delivered!)}`);
    out.push(
      `Cheapest gas delivered into Serbia for ${best.deliveryDay}: ${best.route.short} at €${f2(best.delivered!)}/MWh` +
        (rest.length ? ` (vs ${rest.join(", ")}).` : "."),
    );
  }
  return out;
}
