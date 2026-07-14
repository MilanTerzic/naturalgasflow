// Central configuration ported from the Streamlit dashboard (config.py).
// All constants and palette values match the v8 Kalotina workbook.

export const CONVERSION_MCM_TO_GWH = 10.55;
export const CONVERSION_MCM_TO_MWH = 10_550;
export const CONVERSION_MCM_TO_KWH = 10_550_000;

export const mwhPerDayToMcmPerDay = (v: number) => v / CONVERSION_MCM_TO_MWH;
export const kwhPerDayToMcmPerDay = (v: number) => v / CONVERSION_MCM_TO_KWH;

// Polynomial: y = 0.0007 x^3 - 0.0188 x^2 - 0.3194 x + 11.987  (highest power first)
export const POLY_COEFFS = [0.0007, -0.0188, -0.3194, 11.987] as const;
// Linear: y = -0.354 x + 11.396
export const LINEAR_COEFFS = [-0.354, 11.396] as const;

export const DOMESTIC_PRODUCTION_MCM = 0.5;
export const BIH_SHARE = 0.07;
export const MAX_STORAGE_INJECTION = 2.5;
export const MAX_STORAGE_WITHDRAWAL = 5.0;
export const CURVE_SHIFT_DEFAULT = 0.0;
export const CURVE_DISTORTION_DEFAULT = 1.0;
export const DEMAND_FLOOR_MCM = 4.0;
export const MAX_SERBIAN_DAILY_MCM = 19.0;

export const BELGRADE_LAT = 44.7866;
export const BELGRADE_LON = 20.4489;

export const POINTS = {
  kiskundorozsma_hu: "Kiskundorozsma HU (HU→RS)",
  kireevo: "Kireevo / Zaychar (BG→RS)",
  kiskundorozsma_2: "Kiskundorozsma 2 / Horgos transit",
  kalotina: "Kalotina (BG→RS)",
} as const;

export type FlowPoint = keyof typeof POINTS;

export const ENTSOG_POINT_DIRECTIONS: Record<FlowPoint, string> = {
  kiskundorozsma_hu: "hu-tso-0001itp-00055exit",
  kireevo: "bg-tso-0001itp-00529exit",
  kiskundorozsma_2: "hu-tso-0001itp-10013entry",
  kalotina: "bg-tso-0001itp-00134exit",
};

// Palette — matches the original Plotly figures.
export const PALETTE = {
  kalotina: "#1B7F3A",
  bgImport: "#7FB6E2",
  production: "#34526F",
  huOthers: "#2E75B6",
  huMet: "#ED7D31",
  demand: "#C00000",
  temp: "#1F77B4",
  storagePos: "#2E7D32",
  storageNeg: "#C00000",
  today: "#C00000",
  grid: "rgba(220,220,220,0.7)",
  axis: "rgba(150,150,150,0.5)",
} as const;

export interface CapacityDef {
  tso: string;
  borderPoint: string;
  direction: "entry" | "exit";
  priceUnit: string;
  currency: "HUF" | "EUR";
}

export const CAPACITY_DEFS: CapacityDef[] = [
  { tso: "FGSZ", borderPoint: "Kiskundorozsma (HU)/Kiskundorozsma (RS)", direction: "exit", priceUnit: "HUF/kWh/h/day", currency: "HUF" },
  { tso: "Bulgartransgaz", borderPoint: "Kireevo (BG)/Zaychar (RS)", direction: "exit", priceUnit: "EUR/kWh/h/day", currency: "EUR" },
  { tso: "Gastrans", borderPoint: "Kireevo (BG)/Zaychar (RS)", direction: "entry", priceUnit: "EUR/kWh/h/day", currency: "EUR" },
  { tso: "Bulgartransgaz", borderPoint: "Kalotina (BG)/Dimitrovgrad (RS)", direction: "exit", priceUnit: "EUR/kWh/h/day", currency: "EUR" },
  { tso: "Gastrans", borderPoint: "Kiskundorozsma 2", direction: "exit", priceUnit: "EUR/kWh/h/day", currency: "EUR" },
  { tso: "FGSZ", borderPoint: "Kiskundorozsma 2", direction: "entry", priceUnit: "HUF/kWh/h/day", currency: "HUF" },
];
