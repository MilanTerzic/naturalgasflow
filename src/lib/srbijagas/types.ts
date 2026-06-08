// Types for the Srbijagas Full Supply Analysis tab.

export interface DailyFlowRow {
  date: string;
  kireevo: number;            // BG → RS Kireevo (mcm/d)
  kkd2: number;               // KKD-2 transit (mcm/d)
  kkdHu: number;              // HU → RS (mcm/d)
  kalotina: number;           // BG → RS Kalotina (mcm/d)
}

export type AssumedSource = "measured" | "estimated" | "carried_forward" | "manual_override" | "missing";

export interface AnalysisRow {
  date: string;
  ts: number;
  // Inputs
  imports_total_mcm: number;          // kireevo + kkdHu + kalotina (gross to RS)
  imports_bg_net_mcm: number;         // kireevo - kkd2 floored at 0
  domestic_production_mcm: number;
  // Bosnia (assumed)
  bosnia_mcm: number;
  bosnia_source: "share_of_net" | "share_of_kireevo_spread" | "constant" | "manual";
  // Demand
  serbian_consumption_mcm: number;     // imports + production - bosnia (analytical net for full-supply view)
  // Weather
  temperature_c: number | null;
  hdd: number | null;
  cdd: number | null;
  // Power
  power_gwh: number | null;
  power_gas_equiv_mcm: number | null;
  // Source flags
  source: AssumedSource;
}

export interface MonthlyAggRow {
  month: string; // YYYY-MM
  serbian_mcm: number;
  bosnia_mcm: number;
  power_gas_mcm: number;
  total_potential_mcm: number;
  avg_temp_c: number | null;
  hdd: number;
  days: number;
}

export interface PriceRow {
  month: string; // YYYY-MM
  official_eur_mwh: number | null;     // entered/uploaded Srbijagas
  ttf_eur_mwh: number | null;          // TTF benchmark
  brent_usd_bbl: number | null;        // Brent
  eur_usd: number | null;              // EUR/USD
  reconstructed_eur_mwh: number | null;
  oil_indexed_eur_mwh: number | null;
}

export interface BosniaAssumption {
  method: "share_of_net" | "share_of_kireevo_spread" | "constant" | "manual";
  sharePct: number;            // for share methods, 0..1
  constantMcmDay: number;      // for constant method
  manualMonthly: Record<string, number>; // YYYY-MM → mcm/month
}

export interface PowerAssumption {
  efficiencyPct: number;       // 0..1 (default 0.50)
  gasCvKwhM3: number;          // default 10.55
}

export interface PriceFormula {
  oilWeight: number;           // 0..1, default 0.5
  ttfWeight: number;           // 0..1, default 0.5
  oilLagMonths: number;        // default 6
  addEurMwh: number;           // fixed adder
  brentToEurMwhFactor: number; // Brent USD/bbl -> EUR/MWh proxy (default ≈ 0.55)
}

export interface SrbijagasOverrides {
  bosnia: BosniaAssumption;
  power: PowerAssumption;
  formula: PriceFormula;
  // CSV-uploaded series, keyed by date (YYYY-MM-DD) or month (YYYY-MM)
  manualSerbianDaily: Record<string, number>;
  manualBosniaDaily: Record<string, number>;
  manualPowerDaily: Record<string, number>; // GWh/d
  manualPriceMonthly: Record<string, number>; // EUR/MWh
  manualTempDaily: Record<string, number>;
}
