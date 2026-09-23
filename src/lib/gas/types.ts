export interface TempRow {
  date: string; // ISO YYYY-MM-DD
  temperature_c: number | null;
}

export type FlowPointName =
  | "kiskundorozsma_hu"
  | "kireevo"
  | "kiskundorozsma_2"
  | "kalotina";

export type FlowPointOperationalSource = "physical_flow" | "renomination" | "nomination";

export interface FlowRow {
  date: string;
  kiskundorozsma_hu: number;
  kireevo: number;
  kiskundorozsma_2: number;
  kalotina: number;
  kiskundorozsma_hu_met?: number;
  // Physical-flow points actually published by ENTSOG. A published zero is
  // therefore distinguishable from a missing point.
  published_points?: FlowPointName[];
  // Current-day provisional points sourced from ENTSOG renomination/nomination.
  provisional_points?: FlowPointName[];
  point_source?: Partial<Record<FlowPointName, FlowPointOperationalSource>>;
  point_last_update?: Partial<Record<FlowPointName, string>>;
  fetched_at?: string;
}

export type FlowSourceType =
  | "actual"
  | "provisional"
  | "historical_fallback"
  | "future_fallback"
  | "none";

export interface BalanceRow {
  date: string; // ISO date
  ts: number; // epoch ms (for chart x-axis)
  is_forecast: boolean;
  is_estimated: boolean; // carried forward from a previous (or future) day when source data was missing
  estimated_from?: string; // ISO date of the source day used for carry-forward
  source_type: FlowSourceType; // why the flow values for this row were selected
  provisional_sources?: Array<"renomination" | "nomination">;
  temperature_c: number | null;
  avg_temperature_c: number | null;
  temperature_actual_c: number | null;
  temperature_forecast_c: number | null;
  demand_mcm: number;
  required_actual_mcm: number | null;
  required_forecast_mcm: number | null;
  kalotina_entry_mcm: number;
  kiskundorozsma_entry_mcm: number;
  imports_from_bulgaria_mcm: number;
  imports_from_bulgaria_available_mcm: number;
  bosnia_consumption_mcm: number;
  domestic_production_mcm: number;
  serbian_available_supply_mcm: number;
  // False for future days until a genuine supply forecast is available.
  supply_available: boolean;
  // Raw system balance = available supply - demand.
  storage_imbalance_raw_mcm: number;
  // Feasible storage action after injection/withdrawal limits are applied.
  storage_imbalance_mcm: number;
  // Portion of the raw imbalance that storage cannot absorb.
  residual_gap_mcm: number;
  storage_injection_mcm: number;
  storage_withdrawal_mcm: number;
}

export interface CapacityRow {
  route_id?: string;
  tso: string;
  border_point: string;
  direction: "entry" | "exit";
  product: "daily" | "monthly" | "quarterly";
  period: string;
  technical_mwh?: number | null;
  // Compatibility alias for older chart/table code. In the capacity chart this
  // represents technical capacity, not auction offered capacity.
  offered_mwh: number;
  booked_mwh: number | null;
  physical_flow_mcm?: number | null;
  utilisation_pct: number;
  price: number;
  currency: "HUF" | "EUR";
  price_unit: string;
  source?: "ENTSOG" | "ENTSOG counterpart" | "RBP" | "snapshot" | "cache" | "dummy";
  source_date?: string;
  capacity_source_date?: string;
  fetched_at?: string;
  is_proxy?: boolean;
  is_carried_forward?: boolean;
  is_stale?: boolean;
  data_status?: "live" | "cached" | "historical" | "proxy" | "unavailable";
  warning?: string;
}

export interface CapacityAuctionRow {
  auction_code: string;
  network_point: string;
  product_type: string;
  status: string;
  valid_from: string;
  valid_to: string;
  offered_mwh: number;
  entry_tso?: string;
  exit_tso?: string;
  source: "RBP";
}
