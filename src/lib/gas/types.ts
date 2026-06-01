export interface TempRow {
  date: string; // ISO YYYY-MM-DD
  temperature_c: number | null;
}

export interface FlowRow {
  date: string;
  kiskundorozsma_hu: number;
  kireevo: number;
  kiskundorozsma_2: number;
  kalotina: number;
  kiskundorozsma_hu_met?: number;
}

export interface BalanceRow {
  date: string; // ISO date
  ts: number; // epoch ms (for chart x-axis)
  is_forecast: boolean;
  is_estimated: boolean; // carried forward from a previous day when source data was missing
  estimated_from?: string; // ISO date of the source day used for carry-forward
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
  storage_imbalance_mcm: number;
  storage_imbalance_raw_mcm: number;
  storage_injection_mcm: number;
  storage_withdrawal_mcm: number;
}

export interface CapacityRow {
  tso: string;
  border_point: string;
  direction: "entry" | "exit";
  product: "daily" | "monthly" | "quarterly";
  period: string;
  offered_mwh: number;
  booked_mwh: number;
  utilisation_pct: number;
  price: number;
  currency: "HUF" | "EUR";
  price_unit: string;
}
