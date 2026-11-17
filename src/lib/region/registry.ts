// Balkan gas corridor registry for the regional flow map.
// Pure data: no imports with path aliases so tests can load it directly.

import type { FlowPointName } from "../gas/types";

export type CountryCode =
  "RS" | "HU" | "BG" | "RO" | "HR" | "SI" | "SK" | "GR" | "MK" | "AL" | "BA" | "ME" | "TR" | "UA" | "AT";

/**
 * serbia   – bound to the dashboard's own ENTSOG Allocation / Physical Flow series
 * model    – modelled flow (Bosnia share of the gas balance), never metered
 * regional – ENTSOG Physical Flow fetched by the regional server function
 * planned  – project shown for context only, never carries a value
 * backbone – static pipeline context line, no value
 */
export type CorridorGroup = "serbia" | "model" | "regional" | "planned" | "backbone";

export interface Corridor {
  /** Key into balkan-map.generated.json `lines`. */
  id: string;
  name: string;
  group: CorridorGroup;
  from?: CountryCode | "LNG";
  to?: CountryCode;
  /** Index of the interconnection point within the line's vertices. */
  ip?: number;
  /** Serbian corridors: the dashboard flow point that feeds this line. */
  point?: FlowPointName;
  /** Regional corridors: lower-case, accent-free fragments of ENTSOG point labels. */
  keywords?: string[];
  lng?: boolean;
  note?: string;
  /**
   * Explicit ENTSOG point directions (lower-case operatorKey+pointKey+direction), used
   * instead of keyword/country matching. Needed for TAP, which ENTSOG registers as a
   * Swiss TSO (AL-TSO-0001, country CH), so country-pair matching can never find it.
   * forward = flow in the line's drawn direction; reverse = the opposite direction.
   */
  entsog?: { forward: string[]; reverse?: string[] };
}

export const CORRIDORS: Corridor[] = [
  // Serbia — same points and directions as the existing pipeline map.
  {
    id: "hu_rs_1",
    name: "Kiskundorozsma",
    group: "serbia",
    from: "HU",
    to: "RS",
    ip: 3,
    point: "kiskundorozsma_hu",
    note: "FGSZ exit into Serbia (legacy route).",
  },
  {
    id: "rs_hu_2",
    name: "Kiskundorozsma 2 / Horgoš",
    group: "serbia",
    from: "RS",
    to: "HU",
    ip: 3,
    point: "kiskundorozsma_2",
    note: "Gastrans transit exit to Hungary (Balkan Stream).",
  },
  {
    id: "bg_rs_kz",
    name: "Kireevo / Zaječar",
    group: "serbia",
    from: "BG",
    to: "RS",
    ip: 3,
    point: "kireevo",
    note: "Balkan Stream entry into Serbia (Gastrans).",
  },
  {
    id: "bg_rs_kal",
    name: "Kalotina / Dimitrovgrad",
    group: "serbia",
    from: "BG",
    to: "RS",
    ip: 2,
    point: "kalotina",
    note: "Interconnector Bulgaria–Serbia (IBS).",
  },
  {
    id: "rs_ba_zv",
    name: "Zvornik (Bosnia flow)",
    group: "model",
    from: "RS",
    to: "BA",
    ip: 4,
    note: "Modelled Bosnia share from the gas balance. Not a metered border flow — BiH does not publish on ENTSOG.",
  },

  // Regional — ENTSOG Physical Flow, matched by point label.
  {
    id: "tr_bg_str",
    name: "Strandzha 2 / Malkoçlar",
    group: "regional",
    from: "TR",
    to: "BG",
    ip: 2,
    keywords: ["strandzha", "malkoclar"],
    note: "TurkStream onshore entry into Bulgaria.",
  },
  {
    id: "gr_bg_kul",
    name: "Kulata / Sidirokastro",
    group: "regional",
    from: "GR",
    to: "BG",
    ip: 3,
    keywords: ["kulata", "sidirokastr"],
    note: "Bidirectional Greece–Bulgaria.",
  },
  {
    id: "gr_bg_igb",
    name: "IGB · Komotini / Stara Zagora",
    group: "regional",
    from: "GR",
    to: "BG",
    ip: 2,
    keywords: ["igb", "stara zagora", "komotini"],
    note: "Interconnector Greece–Bulgaria.",
  },
  {
    id: "ro_bg_neg",
    name: "Negru Vodă / Kardam",
    group: "regional",
    from: "RO",
    to: "BG",
    ip: 3,
    keywords: ["negru voda", "kardam"],
    note: "Trans-Balkan corridor.",
  },
  {
    id: "ro_bg_ruse",
    name: "Ruse / Giurgiu",
    group: "regional",
    from: "RO",
    to: "BG",
    ip: 3,
    keywords: ["ruse", "giurgiu"],
    note: "Danube interconnector.",
  },
  {
    id: "ro_hu_csa",
    name: "Csanádpalota",
    group: "regional",
    from: "RO",
    to: "HU",
    ip: 3,
    keywords: ["csanadpalota"],
    note: "Romania–Hungary (BRUA).",
  },
  {
    id: "hu_hr_drav",
    name: "Drávaszerdahely",
    group: "regional",
    from: "HU",
    to: "HR",
    ip: 3,
    keywords: ["dravaszerdahely", "donji miholjac"],
    note: "Hungary–Croatia.",
  },
  {
    id: "si_hr_rog",
    name: "Rogatec",
    group: "regional",
    from: "SI",
    to: "HR",
    ip: 2,
    keywords: ["rogatec"],
    note: "Slovenia–Croatia.",
  },
  {
    id: "lng_krk",
    name: "Krk LNG",
    group: "regional",
    from: "LNG",
    to: "HR",
    ip: 1,
    lng: true,
    keywords: ["krk", "omisalj", "lng hrvatska"],
    note: "FSRU send-out into Croatia.",
  },
  {
    id: "lng_alex",
    name: "Alexandroupolis FSRU",
    group: "regional",
    from: "LNG",
    to: "GR",
    ip: 1,
    lng: true,
    keywords: ["alexandroupoli", "amfitriti"],
    note: "FSRU send-out into Greece.",
  },
  {
    id: "lng_rev",
    name: "Revithoussa LNG",
    group: "regional",
    from: "LNG",
    to: "GR",
    ip: 1,
    lng: true,
    keywords: ["revithoussa", "agia triada"],
    note: "LNG terminal send-out into Greece.",
  },
  {
    id: "tr_gr_kipi",
    name: "Kipi",
    group: "regional",
    from: "TR",
    to: "GR",
    ip: 1,
    keywords: ["kipi"],
    note: "Turkey–Greece.",
  },
  // TAP — Trans Adriatic Pipeline (ENTSOG operator AL-TSO-0001 "TAP", registered in CH).
  {
    id: "tap_kipoi",
    name: "TAP · Kipoi entry (from TANAP)",
    group: "regional",
    from: "TR",
    to: "GR",
    ip: 1,
    entsog: { forward: ["al-tso-0001itp-00274entry"] },
    note: "Azeri gas entering TAP from TANAP at the Turkish–Greek border.",
  },
  {
    id: "gr_al_tap",
    name: "TAP · Melendugno exit to Italy",
    group: "regional",
    from: "GR",
    to: "AL",
    ip: 10,
    entsog: {
      forward: ["al-tso-0001itp-00008exit"],
      reverse: ["al-tso-0001itp-00008entry"],
    },
    note: "TAP flow delivered to SNAM at Melendugno (Greece → Albania → Italy).",
  },
  {
    id: "tap_komotini",
    name: "TAP → IGB · Komotini",
    group: "regional",
    from: "GR",
    to: "BG",
    ip: 0,
    entsog: {
      forward: ["al-tso-0001itp-00275exit"],
      reverse: ["al-tso-0001itp-00275entry"],
    },
    note: "TAP gas handed to IGB towards Bulgaria (and on to Serbia).",
  },
  {
    id: "tap_nm",
    name: "TAP → DESFA · Nea Mesimvria",
    group: "regional",
    from: "GR",
    to: "GR",
    ip: 0,
    entsog: {
      forward: ["al-tso-0001itp-00427exit"],
      reverse: ["al-tso-0001itp-00427entry"],
    },
    note: "TAP gas handed to the Greek grid (DESFA) near Thessaloniki.",
  },
  {
    id: "bg_mk_zid",
    name: "Kyustendil / Zidilovo",
    group: "regional",
    from: "BG",
    to: "MK",
    ip: 3,
    keywords: ["kyustendil", "zidilovo"],
    note: "North Macedonia's import route.",
  },
  {
    id: "ua_ro_isac",
    name: "Isaccea / Orlovka",
    group: "regional",
    from: "UA",
    to: "RO",
    ip: 2,
    keywords: ["isaccea", "orlovka"],
    note: "Trans-Balkan north end.",
  },
  {
    id: "at_hu_mos",
    name: "Mosonmagyaróvár",
    group: "regional",
    from: "AT",
    to: "HU",
    ip: 2,
    keywords: ["mosonmagyarovar"],
    note: "Austria–Hungary (HAG).",
  },
  {
    id: "hu_sk_bal",
    name: "Balassagyarmat / Veľké Zlievce",
    group: "regional",
    from: "HU",
    to: "SK",
    ip: 2,
    keywords: ["balassagyarmat", "velke zlievce"],
    note: "Bidirectional Hungary–Slovakia interconnector (FGSZ / Eustream). Positive values indicate HU → SK; negative values SK → HU.",
  },
  {
    id: "ua_hu_ber",
    name: "Beregdaróc",
    group: "regional",
    from: "UA",
    to: "HU",
    ip: 1,
    keywords: ["beregdaroc"],
    note: "Ukraine–Hungary.",
  },

  // Planned / under development — context only.
  { id: "gr_mk_evz", name: "Greece – North Macedonia (Evzoni–Gevgelija)", group: "planned", ip: 2 },
  { id: "rs_mk", name: "Serbia – North Macedonia interconnector", group: "planned", ip: 3 },
  { id: "rs_ro", name: "Serbia – Romania (Mokrin–Arad)", group: "planned", ip: 2 },
  { id: "hr_ba_south", name: "Southern Interconnection Croatia – BiH", group: "planned", ip: 1 },
  { id: "iap", name: "Ionian Adriatic Pipeline (IAP)", group: "planned", ip: 2 },

  { id: "bb_balkanstream_bg", name: "Balkan Stream (Bulgaria)", group: "backbone" },
  { id: "bb_balkanstream_rs", name: "Balkan Stream (Serbia)", group: "backbone" },
  { id: "bb_transbalkan_bg", name: "Trans-Balkan (Bulgaria)", group: "backbone" },
];

export const CORRIDOR_BY_ID: Record<string, Corridor> = Object.fromEntries(
  CORRIDORS.map((corridor) => [corridor.id, corridor]),
);

export const REGIONAL_CORRIDORS = CORRIDORS.filter((corridor) => corridor.group === "regional");

export const CITIES: Array<[node: string, label: string]> = [
  ["BEG", "Belgrade"],
  ["SOF", "Sofia"],
  ["BUD", "Budapest"],
  ["BUC", "Bucharest"],
  ["ATH", "Athens"],
  ["SKP", "Skopje"],
  ["SAR", "Sarajevo"],
  ["ZAG", "Zagreb"],
  ["LJU", "Ljubljana"],
  ["POD", "Podgorica"],
  ["TIR", "Tirana"],
  ["PRI", "Pristina"],
  ["NIS", "Niš"],
  ["NS", "Novi Sad"],
  ["THES", "Thessaloniki"],
];

export const STORAGE_SITES: Array<[node: string, label: string]> = [
  ["BDVOR", "Banatski Dvor UGS"],
  ["CHIREN", "Chiren UGS"],
];

/** Countries drawn with emphasis (the SEE core). */
export const FOCUS_COUNTRIES = new Set([
  "Serbia",
  "Hungary",
  "Romania",
  "Bulgaria",
  "Greece",
  "Macedonia",
  "Albania",
  "Montenegro",
  "Bosnia and Herz.",
  "Croatia",
  "Slovenia",
  "Kosovo",
]);

export const COUNTRY_LABEL: Record<string, string> = {
  "Bosnia and Herz.": "BiH",
  Macedonia: "N. Macedonia",
};

/** Lower-case and strip diacritics so ENTSOG labels match the keywords above. */
export function normaliseLabel(label: string): string {
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase();
}

/** Regional corridors whose keywords appear in an ENTSOG point label (may be several). */
export function matchCorridors(label: string): Corridor[] {
  const text = normaliseLabel(label);
  return REGIONAL_CORRIDORS.filter((corridor) =>
    (corridor.keywords ?? []).some((keyword) =>
      // Short keywords ("tap", "igb") must be whole words.
      keyword.length <= 3 ? new RegExp(`\\b${keyword}\\b`).test(text) : text.includes(keyword),
    ),
  );
}

/**
 * Gas-year 2025/26 reference capacities (mcm/d) in the corridor's forward direction, from the
 * Serbian border-point capacity table supplied by the user. Used only when ENTSOG publishes no
 * daily firm technical capacity for a point, and always labelled as a reference, not a daily value.
 */
export interface ReferenceCapacity {
  technical: number;
  booked: number;
  note?: string;
}
export const REFERENCE_CAPACITY_LABEL = "GY 25/26 ref";
export const REFERENCE_CAPACITY: Record<string, ReferenceCapacity> = {
  bg_rs_kz: { technical: 38.67, booked: 36.35 },
  rs_hu_2: { technical: 23.3, booked: 22.6 },
  hu_rs_1: { technical: 13.51, booked: 12.2 },
  bg_rs_kal: { technical: 2.49, booked: 2.2, note: "technical 5, offered 2.49" },
  rs_ba_zv: { technical: 2.0, booked: 1.4 },
  bg_mk_zid: { technical: 2.9, booked: 2.84 },
};
