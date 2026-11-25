// Unit conversion of daily capacity tariffs into EUR per MWh delivered in one gas day at
// full utilisation. Relative imports only.

import type { TariffRecord, TariffStatus } from "./types";

export interface FxRates {
  /** Fixing day the rates belong to. */
  date: string;
  hufPerEur: number | null;
  rsdPerEur: number | null;
  source: string;
}

/** Last Sunday of a month (UTC date string). */
function lastSunday(year: number, month1: number): string {
  const d = new Date(Date.UTC(year, month1, 0)); // last day of month
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Hours in the gas day that starts at 06:00 CET on `date`. The gas day that contains the
 * spring clock change (Saturday→Sunday, last weekend of March) has 23 h; the autumn one 25 h.
 */
export function gasDayHours(date: string): 23 | 24 | 25 {
  const year = Number(date.slice(0, 4));
  if (date === addDays(lastSunday(year, 3), -1)) return 23;
  if (date === addDays(lastSunday(year, 10), -1)) return 25;
  return 24;
}

/** Index into a gas-year monthly array (October = 0 … September = 11). */
export function gasYearMonth(date: string): number {
  const m = Number(date.slice(5, 7));
  return (m - 10 + 12) % 12;
}

export interface Converted {
  eurPerMwh: number | null;
  status: TariffStatus;
  /** Plain-language working, for the expandable detail. */
  working: string;
}

/** EUR per MWh delivered for a daily product on `date`. Null (UNAVAILABLE) when out of period or FX missing. */
export function dailyEurPerMwh(t: TariffRecord, date: string, fx: FxRates | null): Converted {
  if (date < t.effectiveFrom || date > t.effectiveTo) {
    return { eurPerMwh: null, status: "UNAVAILABLE", working: `no tariff in force on ${date}` };
  }
  const i = gasYearMonth(date);
  const v = t.monthly[i];
  const h = gasDayHours(date);
  switch (t.unit) {
    case "EUR/MWh/d":
      return { eurPerMwh: v, status: t.status, working: `${v} EUR/MWh/day` };
    case "EUR/(kWh/h)/d":
      return {
        eurPerMwh: (v * 1000) / h,
        status: t.status,
        working: `${v} EUR/(kWh/h) × 1000 / ${h} h`,
      };
    case "HUF/(kWh/h)/y": {
      const m = t.multipliers?.[i];
      if (m === undefined)
        return { eurPerMwh: null, status: "UNAVAILABLE", working: "no multiplier" };
      if (!fx?.hufPerEur)
        return { eurPerMwh: null, status: "UNAVAILABLE", working: "no EUR/HUF rate" };
      return {
        eurPerMwh: (v * m * 1000) / h / fx.hufPerEur,
        status: t.status,
        working: `${v} HUF/(kWh/h)/y × ${(m * 100).toFixed(2)}% × 1000 / ${h} h / ${fx.hufPerEur.toFixed(2)} HUF/EUR (${fx.date})`,
      };
    }
    case "RSD/(kWh/d)/d":
      if (!fx?.rsdPerEur)
        return { eurPerMwh: null, status: "UNAVAILABLE", working: "no EUR/RSD rate" };
      return {
        eurPerMwh: (v * 1000) / fx.rsdPerEur,
        status: t.status,
        working: `${v} RSD/(kWh/d) × 1000 / ${fx.rsdPerEur.toFixed(2)} RSD/EUR (${fx.date})`,
      };
  }
}
