// Transmission tariff records for the cross-border arbitrage monitor.
// Relative imports only (unit-tested).

export type TariffStatus = "VERIFIED" | "ESTIMATED" | "STALE" | "UNAVAILABLE";
export type Operator = "Bulgartransgaz" | "Gastrans" | "FGSZ" | "Transportgas Srbija";
export type Direction = "entry" | "exit";
export type Product = "daily";

/**
 * How the published number turns into money for 1 MWh delivered in one gas day at full
 * utilisation. Every unit the four operators use for daily products:
 * - EUR/MWh/day       (BTG): capacity of 1 MWh/day for one day          → value
 * - EUR/(kWh/h)/day   (Gastrans): hourly capacity booked for the day     → value × 1000 / hours
 * - HUF/(kWh/h)/year × daily multiplier (FGSZ)                          → value × m × 1000 / hours / HUF per EUR
 * - RSD/(kWh/day)/day (Transportgas): daily capacity for one day          → value × 1000 / RSD per EUR
 */
export type TariffUnit = "EUR/MWh/d" | "EUR/(kWh/h)/d" | "HUF/(kWh/h)/y" | "RSD/(kWh/d)/d";

export interface TariffRecord {
  id: string;
  operator: Operator;
  point: string;
  direction: Direction;
  product: Product;
  /** firm; reverse = Gastrans commercial reverse (backhaul) capacity. */
  capacity: "firm" | "reverse";
  unit: TariffUnit;
  currency: "EUR" | "HUF" | "RSD";
  /** One value per month of the gas year, October first; a flat tariff repeats it. */
  monthly: number[];
  /** FGSZ: share of the annual fee charged for a daily product, per month (Oct first). */
  multipliers?: number[];
  effectiveFrom: string;
  effectiveTo: string;
  source: string;
  sourceDoc: string;
  verifiedOn: string;
  status: TariffStatus;
  note?: string;
}

/** Per-MWh charge on gas flowing (commodity, volume, neutrality). */
export interface FlowCharge {
  id: string;
  operator: Operator;
  label: string;
  /** Applies to quantities at this point and direction. */
  appliesTo: string;
  currency: "EUR" | "HUF";
  value: number;
  effectiveFrom: string;
  effectiveTo: string;
  source: string;
  verifiedOn: string;
  status: TariffStatus;
  note?: string;
}
