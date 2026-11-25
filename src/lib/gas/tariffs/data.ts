// Official daily firm capacity tariffs, gas year 2026/27 (1 Oct 2026 – 30 Sep 2027).
// Every number below was read from the operator's own document on 2026-11-25; the source
// of each record says which one. Do not edit a number without updating its source.
// Relative imports only.

import type { FlowCharge, TariffRecord } from "./types";

const GY = { effectiveFrom: "2026-10-01", effectiveTo: "2027-09-30" } as const;
const CHECKED = "2026-11-25";
const flat = (v: number) => Array.from({ length: 12 }, () => v);

const BTG_SRC =
  "Bulgartransgaz tariff calculator 2026/2027 (BTG_tariff_calculator_2026_2027_en.xlsx, sheet PRICES, daily firm 'D_*_F' rows)";
const BTG_URL = "https://www.bulgartransgaz.org/public/en/pages/tariffs-28.html";
const GT_URL =
  "https://gastrans.rs/wp-content/uploads/2026/08/Odluka_pocetne-cene-kapacitetnih-proizvoda-2026-27_SRB.pdf";
const GT_SRC =
  "Gastrans decision No. 05-131 of 17.07.2026 on reserve prices 2026/27, confirmed by AERS on 30.07.2026 (daily capacity)";
const FGSZ_URL =
  "https://fgsz.hu/en/home/news/information-on-tariffs-applicable-from-1-october-2026.html";
const FGSZ_SRC =
  "FGSZ tariffs from 1 Oct 2026 (MEKH Resolution H2021/2026): capacity fees and daily-product seasonal multipliers for interconnection points";
const TGS_URL =
  "https://api.transportgas-srbija.rs/assets/odluka-o-zajednickim-cenama-pristupa-tspg04.06.2026.pdf";
const TGS_SRC =
  "AERS decision on common transmission access prices (28.05.2026, 313.82-481/2026-D-I/1), table 2.6 daily firm capacity";

/** FGSZ daily-product multipliers for interconnection entry/exit points, Oct → Sep. */
const FGSZ_DAILY_IP = [
  0.0052, 0.006, 0.0079, 0.0075, 0.0061, 0.0059, 0.0046, 0.0037, 0.0036, 0.0042, 0.0043, 0.0044,
];

export const TARIFFS: TariffRecord[] = [
  // ---- Bulgartransgaz (EUR/MWh/day, daily firm) ----
  {
    id: "btg-kireevo-exit",
    operator: "Bulgartransgaz",
    point: "Kireevo/Zaychar",
    direction: "exit",
    product: "daily",
    capacity: "firm",
    unit: "EUR/MWh/d",
    currency: "EUR",
    monthly: [
      1.7564, 2.0432, 2.2582, 2.5808, 2.5808, 2.0969, 2.0969, 1.4876, 1.0753, 1.1112, 0.9857,
      1.4517,
    ],
    ...GY,
    source: BTG_URL,
    sourceDoc: `${BTG_SRC}, D_EX_KZA_F`,
    verifiedOn: CHECKED,
    status: "VERIFIED",
  },
  {
    id: "btg-kireevo-entry",
    operator: "Bulgartransgaz",
    point: "Kireevo/Zaychar",
    direction: "entry",
    product: "daily",
    capacity: "firm",
    unit: "EUR/MWh/d",
    currency: "EUR",
    monthly: [
      0.8739, 1.0166, 1.1236, 1.2841, 1.2841, 1.0434, 1.0434, 0.7402, 0.5351, 0.5529, 0.4905,
      0.7223,
    ],
    ...GY,
    source: BTG_URL,
    sourceDoc: `${BTG_SRC}, D_EN_KZA_F`,
    verifiedOn: CHECKED,
    status: "VERIFIED",
  },
  {
    id: "btg-kalotina-exit",
    operator: "Bulgartransgaz",
    point: "Kalotina/Dimitrovgrad",
    direction: "exit",
    product: "daily",
    capacity: "firm",
    unit: "EUR/MWh/d",
    currency: "EUR",
    monthly: [
      0.8824, 1.0265, 1.1346, 1.2967, 1.2967, 1.0535, 1.0535, 0.7474, 0.5403, 0.5583, 0.4952,
      0.7294,
    ],
    ...GY,
    source: BTG_URL,
    sourceDoc: `${BTG_SRC}, D_EX_IBS_F`,
    verifiedOn: CHECKED,
    status: "VERIFIED",
  },
  // ---- Gastrans (EUR/(kWh/h) for the day; flat through the gas year) ----
  {
    id: "gt-kirevo-entry",
    operator: "Gastrans",
    point: "Entry 1 Kirevo/Zaječar",
    direction: "entry",
    product: "daily",
    capacity: "firm",
    unit: "EUR/(kWh/h)/d",
    currency: "EUR",
    monthly: flat(0.034),
    ...GY,
    source: GT_URL,
    sourceDoc: GT_SRC,
    verifiedOn: CHECKED,
    status: "VERIFIED",
    note: "Read from a scanned PDF.",
  },
  {
    id: "gt-horgos-exit",
    operator: "Gastrans",
    point: "Exit 4 Horgoš (Kiskundorozsma 2)",
    direction: "exit",
    product: "daily",
    capacity: "firm",
    unit: "EUR/(kWh/h)/d",
    currency: "EUR",
    monthly: flat(0.0388),
    ...GY,
    source: GT_URL,
    sourceDoc: GT_SRC,
    verifiedOn: CHECKED,
    status: "VERIFIED",
    note: "Read from a scanned PDF.",
  },
  {
    id: "gt-domestic-exit",
    operator: "Gastrans",
    point: "Exit domestic zone (Paraćin, Pančevo, Gospođinci)",
    direction: "exit",
    product: "daily",
    capacity: "firm",
    unit: "EUR/(kWh/h)/d",
    currency: "EUR",
    monthly: flat(0.0237),
    ...GY,
    source: GT_URL,
    sourceDoc: GT_SRC,
    verifiedOn: CHECKED,
    status: "VERIFIED",
    note: "Read from a scanned PDF.",
  },
  {
    id: "gt-horgos-reverse-entry",
    operator: "Gastrans",
    point: "Horgoš (commercial reverse, HU→RS)",
    direction: "entry",
    product: "daily",
    capacity: "reverse",
    unit: "EUR/(kWh/h)/d",
    currency: "EUR",
    monthly: flat(0.0184),
    ...GY,
    source: GT_URL,
    sourceDoc: `${GT_SRC}, 'povratni kapacitet' column of Exit 4 Horgoš`,
    verifiedOn: CHECKED,
    status: "VERIFIED",
    note: "Reverse capacity exists only while Gastrans flows forward (BG→HU). Read from a scanned PDF.",
  },
  {
    id: "gt-kirevo-reverse-exit",
    operator: "Gastrans",
    point: "Kirevo/Zaječar (commercial reverse, RS→BG)",
    direction: "exit",
    product: "daily",
    capacity: "reverse",
    unit: "EUR/(kWh/h)/d",
    currency: "EUR",
    monthly: flat(0.0162),
    ...GY,
    source: GT_URL,
    sourceDoc: `${GT_SRC}, 'povratni kapacitet' column of Entry 1 Kirevo/Zaječar`,
    verifiedOn: CHECKED,
    status: "VERIFIED",
    note: "Reverse capacity exists only while Gastrans flows forward (BG→HU). Read from a scanned PDF.",
  },
  // ---- FGSZ (HUF/(kWh/h)/year × daily multiplier) ----
  {
    id: "fgsz-kkd-entry",
    operator: "FGSZ",
    point: "Kiskundorozsma (RS→HU entry)",
    direction: "entry",
    product: "daily",
    capacity: "firm",
    unit: "HUF/(kWh/h)/y",
    currency: "HUF",
    monthly: flat(1149.06),
    multipliers: FGSZ_DAILY_IP,
    ...GY,
    source: FGSZ_URL,
    sourceDoc: FGSZ_SRC,
    verifiedOn: CHECKED,
    status: "VERIFIED",
  },
  {
    id: "fgsz-kkd-exit",
    operator: "FGSZ",
    point: "Kiskundorozsma (HU→RS exit)",
    direction: "exit",
    product: "daily",
    capacity: "firm",
    unit: "HUF/(kWh/h)/y",
    currency: "HUF",
    monthly: flat(1326.48),
    multipliers: FGSZ_DAILY_IP,
    ...GY,
    source: FGSZ_URL,
    sourceDoc: FGSZ_SRC,
    verifiedOn: CHECKED,
    status: "VERIFIED",
  },
  // ---- Transportgas Srbija (RSD/(kWh/day) for one day) ----
  {
    id: "tgs-entry-ts",
    operator: "Transportgas Srbija",
    point: "Entry from another transmission system (Kiskundorozsma 1, Kalotina, Gastrans)",
    direction: "entry",
    product: "daily",
    capacity: "firm",
    unit: "RSD/(kWh/d)/d",
    currency: "RSD",
    monthly: [
      0.0539, 0.0831, 0.1095, 0.1193, 0.0883, 0.0763, 0.0396, 0.0298, 0.0275, 0.0315, 0.0304,
      0.0361,
    ],
    ...GY,
    source: TGS_URL,
    sourceDoc: `${TGS_SRC}, row 1 'ulazni kapacitet iz transportnog sistema'`,
    verifiedOn: CHECKED,
    status: "VERIFIED",
    note: "Common Transportgas/Yugorosgaz-Transport tariff. Read from a scanned PDF.",
  },
  {
    id: "tgs-exit-domestic",
    operator: "Transportgas Srbija",
    point: "Exit domestic consumption",
    direction: "exit",
    product: "daily",
    capacity: "firm",
    unit: "RSD/(kWh/d)/d",
    currency: "RSD",
    monthly: [
      0.073, 0.1126, 0.1483, 0.1615, 0.1196, 0.1033, 0.0536, 0.0404, 0.0373, 0.0427, 0.0412, 0.0489,
    ],
    ...GY,
    source: TGS_URL,
    sourceDoc: `${TGS_SRC}, row 4 'izlazni kapacitet domaća potrošnja'`,
    verifiedOn: CHECKED,
    status: "VERIFIED",
    note: "Not part of the delivered-to-Serbia price (charged at the end customer's exit). Read from a scanned PDF.",
  },
];

export const FLOW_CHARGES: FlowCharge[] = [
  {
    id: "btg-commodity",
    operator: "Bulgartransgaz",
    label: "Technological component (commodity)",
    appliesTo: "each BTG entry or exit with a capacity charge",
    currency: "EUR",
    value: 0.1072,
    ...GY,
    source: BTG_URL,
    verifiedOn: CHECKED,
    status: "VERIFIED",
    note: "Calculator cell PRICES!G296 (PTKP); transmission component G295 is 0.",
  },
  {
    id: "btg-neutrality",
    operator: "Bulgartransgaz",
    label: "Balancing neutrality charge",
    appliesTo: "each BTG entry or exit with a commodity charge",
    currency: "EUR",
    value: -0.0101,
    ...GY,
    source: BTG_URL,
    verifiedOn: CHECKED,
    status: "VERIFIED",
    note: "Calculator cell PRICES!G298 (NEUTR). The −0.0284 EUR/MWh quoted elsewhere is not in this calculator.",
  },
  {
    id: "fgsz-volume-fee",
    operator: "FGSZ",
    label: "Volume fee",
    appliesTo: "FGSZ exit points (not entry)",
    currency: "HUF",
    value: 29.22,
    ...GY,
    source: FGSZ_URL,
    verifiedOn: CHECKED,
    status: "VERIFIED",
  },
];

/** Gastrans fuel gas parameters published on GEDP for November 2026. */
export const GASTRANS_FUEL = {
  month: "2026-11",
  x1: 0.003,
  x2: 0.00015,
  tenderPriceEurMwh: 45.42,
  source: "https://gedp.gastrans.rs/fuel_gas.aspx",
  verifiedOn: CHECKED,
  /** The network-code split between X1 and X2 by flow type was not available. */
  status: "ESTIMATED" as const,
  note: "Applied as X1 × origin hub price on forward flows only (in-kind fuel valued at the gas bought); X2 and the monetary tender price are not used; commercial reverse carries no fuel. Methodology to be confirmed against the Gastrans Network Code.",
};

export const TARIFF_BY_ID = Object.fromEntries(TARIFFS.map((t) => [t.id, t])) as Record<
  string,
  TariffRecord
>;
export const CHARGE_BY_ID = Object.fromEntries(FLOW_CHARGES.map((c) => [c.id, c])) as Record<
  string,
  FlowCharge
>;
