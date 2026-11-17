// Regenerates src/lib/region/balkan-map.generated.json (Natural Earth 1:50m, public domain).
// Run once in a scratch folder:  npm i world-atlas@2 topojson-client d3-geo  &&  node gen-balkan-map.mjs
// then copy map.json to src/lib/region/balkan-map.generated.json.
import fs from "fs";
import * as topo from "topojson-client";
import * as d3 from "d3-geo";
const world = JSON.parse(fs.readFileSync("node_modules/world-atlas/countries-50m.json"));
const fc = topo.feature(world, world.objects.countries);
const W = 1000,
  H = 820;
const bbox = {
  type: "MultiPoint",
  coordinates: [
    [13.2, 37.4],
    [30.2, 37.4],
    [13.2, 48.7],
    [30.2, 48.7],
  ],
};
const proj = d3.geoMercator().fitExtent(
  [
    [0, 0],
    [W, H],
  ],
  bbox,
);
const _b = d3.geoPath(proj).bounds(bbox);
proj.translate([proj.translate()[0] - _b[0][0], proj.translate()[1] - _b[0][1]]);
const fitW = _b[1][0] - _b[0][0],
  fitH = _b[1][1] - _b[0][1];
proj.clipExtent([
  [-2, -2],
  [fitW + 2, fitH + 2],
]);
const path = d3.geoPath(proj).digits(1);
const focus = new Set([
  "Serbia",
  "Hungary",
  "Romania",
  "Bulgaria",
  "Greece",
  "North Macedonia",
  "Macedonia",
  "Albania",
  "Montenegro",
  "Bosnia and Herz.",
  "Croatia",
  "Slovenia",
  "Kosovo",
  "Turkey",
  "Austria",
  "Slovakia",
  "Ukraine",
  "Moldova",
  "Italy",
  "Czechia",
  "Poland",
  "Bosnia and Herzegovina",
  "Türkiye",
]);
const countries = [];
for (const f of fc.features) {
  const n = f.properties.name;
  const b = d3.geoBounds(f);
  if (b[1][0] < 12 || b[0][0] > 31 || b[1][1] < 36.5 || b[0][1] > 49.5) continue;
  const d = path(f);
  if (!d) continue;
  const c = proj(d3.geoCentroid(f));
  countries.push({ id: f.id, name: n, d, cx: +c[0].toFixed(1), cy: +c[1].toFixed(1) });
}
const P = (lon, lat) => proj([lon, lat]).map((v) => +v.toFixed(1));
const geo = {
  // Serbian interconnection points
  KISK: [19.99, 46.17],
  KZ: [22.52, 43.93],
  KAL: [22.86, 42.99],
  ZVOR: [19.11, 44.39],
  // regional IPs
  STR: [27.57, 41.97],
  KUL: [23.36, 41.4],
  IGB: [25.38, 41.44],
  NEG: [28.21, 43.79],
  RUSE: [25.96, 43.86],
  CSA: [20.75, 46.2],
  DRAV: [18.05, 45.79],
  ROG: [15.7, 46.22],
  KRK: [14.56, 45.22],
  ALEX: [25.92, 40.73],
  REV: [23.4, 37.95],
  KIPI: [26.31, 40.96],
  ZID: [22.42, 42.21],
  ISAC: [28.46, 45.3],
  MOS: [17.16, 47.95],
  // Hungary–Slovakia gas IP: coordinates from the bilateral pipeline agreement.
  BAL: [19.313333, 48.086056],
  BER: [22.53, 48.2],
  BIL: [20.99, 40.62],
  FIER: [19.56, 40.72],
  EVZ: [22.55, 41.12],
  // cities / hubs
  BEG: [20.46, 44.82],
  SOF: [23.32, 42.7],
  BUD: [19.04, 47.5],
  BUC: [26.1, 44.43],
  ATH: [23.73, 37.98],
  SKP: [21.43, 42.0],
  SAR: [18.41, 43.86],
  ZAG: [15.98, 45.81],
  LJU: [14.51, 46.06],
  POD: [19.26, 42.44],
  TIR: [19.82, 41.33],
  PRI: [21.17, 42.66],
  NIS: [21.9, 43.32],
  NS: [19.84, 45.27],
  SZE: [20.15, 46.25],
  ARAD: [21.31, 46.18],
  VARNA: [27.91, 43.21],
  STZ: [25.63, 42.42],
  KOM: [25.4, 41.12],
  THES: [22.94, 40.64],
  ISTB: [28.98, 41.01],
  KIYI: [28.08, 41.63],
  ODE: [30.73, 46.48],
  VIENNA: [16.37, 48.21],
  UZH: [22.3, 48.62],
  BDVOR: [20.52, 45.52],
  CHIREN: [23.56, 43.31],
  OMIS: [14.56, 45.22],
  IT: [18.33, 40.27],
  TORDA: [20.44, 45.58],
  MOKRIN: [20.41, 45.93],
  DONJI: [18.6, 43.6],
  PLOCE: [17.43, 43.05],
};
const nodes = {};
for (const k in geo) nodes[k] = P(...geo[k]);
fs.writeFileSync(
  "map.json",
  JSON.stringify({ W: Math.round(fitW), H: Math.round(fitH), countries, nodes }),
);
console.log(countries.length, countries.map((c) => c.name).join(", "));
console.log(fs.statSync("map.json").size);

// ---- corridor geometries (lon,lat) ----
// Routes traced against the ENTSOG capacity map (Balkan section). Serbian legacy line and
// Gastrans/Balkan Stream through Vojvodina follow known towns; in-between segments are approximate.
const L = {
  hu_rs_1: [
    [19.76, 46.82],
    [19.98, 46.47],
    [20.06, 46.28],
    [19.99, 46.17],
    [20.08, 45.92],
    [20.03, 45.62],
    [19.98, 45.4],
    [20.1, 45.1],
    [20.28, 44.92],
  ],
  rs_hu_2: [
    [20.13, 45.6],
    [20.2, 45.82],
    [20.1, 46.04],
    [20.04, 46.16],
    [20.07, 46.3],
    [19.88, 46.58],
    [19.76, 46.82],
  ],
  bg_rs_kz: [
    [23.56, 43.24],
    [23.22, 43.44],
    [22.85, 43.72],
    [22.52, 43.93],
    [22.28, 43.9],
    [21.96, 43.83],
    [21.41, 43.86],
  ],
  bg_rs_kal: [
    [23.33, 42.8],
    [23.05, 42.88],
    [22.86, 42.99],
    [22.78, 43.02],
    [22.59, 43.15],
    [22.31, 43.22],
    [21.9, 43.32],
  ],
  rs_ba_zv: [
    [20.28, 44.92],
    [19.95, 44.78],
    [19.69, 44.75],
    [19.22, 44.53],
    [19.11, 44.39],
    [18.69, 44.23],
    [18.55, 44.05],
    [18.41, 43.86],
  ],
  tr_bg_str: [
    [28.08, 41.63],
    [27.8, 41.8],
    [27.57, 41.97],
    [27.35, 42.15],
    [27.1, 42.33],
  ],
  gr_bg_kul: [
    [22.93, 40.72],
    [23.15, 40.98],
    [23.39, 41.24],
    [23.36, 41.4],
    [23.2, 41.62],
    [23.1, 42.01],
    [23.08, 42.3],
    [23.15, 42.55],
    [23.33, 42.7],
  ],
  gr_bg_igb: [
    [25.4, 41.12],
    [25.39, 41.3],
    [25.38, 41.44],
    [25.37, 41.65],
    [25.55, 41.93],
    [25.6, 42.1],
    [25.63, 42.42],
  ],
  ro_bg_neg: [
    [28.4, 44.75],
    [28.27, 44.25],
    [28.22, 43.95],
    [28.21, 43.79],
    [28.0, 43.65],
    [27.8, 43.5],
  ],
  ro_bg_ruse: [
    [26.1, 44.4],
    [26.0, 44.15],
    [25.97, 43.95],
    [25.96, 43.86],
    [25.95, 43.7],
    [25.8, 43.42],
  ],
  ro_hu_csa: [
    [21.45, 46.2],
    [21.31, 46.18],
    [21.0, 46.19],
    [20.75, 46.2],
    [20.45, 46.38],
    [20.22, 46.36],
  ],
  hu_hr_drav: [
    [19.0, 46.62],
    [18.4, 46.2],
    [18.0, 45.9],
    [18.05, 45.79],
    [18.12, 45.55],
    [17.93, 45.18],
    [17.3, 45.3],
    [16.78, 45.48],
    [16.4, 45.71],
    [15.98, 45.81],
  ],
  si_hr_rog: [
    [15.25, 46.24],
    [15.55, 46.22],
    [15.7, 46.22],
    [15.9, 46.02],
    [15.98, 45.82],
  ],
  lng_krk: [
    [14.48, 45.16],
    [14.56, 45.22],
    [14.68, 45.31],
    [15.0, 45.35],
    [15.3, 45.42],
    [15.6, 45.6],
    [15.92, 45.77],
  ],
  lng_alex: [
    [25.97, 40.66],
    [25.92, 40.73],
    [25.8, 40.88],
    [25.55, 41.03],
    [25.4, 41.12],
  ],
  lng_rev: [
    [23.3, 37.88],
    [23.4, 37.95],
    [23.52, 38.02],
    [23.66, 38.0],
  ],
  tr_gr_kipi: [
    [26.65, 41.0],
    [26.31, 40.96],
    [25.95, 40.93],
    [25.65, 41.05],
    [25.4, 41.12],
  ],
  gr_al_tap: [
    [26.31, 40.96],
    [25.4, 41.12],
    [24.4, 41.0],
    [23.8, 40.95],
    [23.2, 40.85],
    [22.92, 40.72],
    [22.5, 40.78],
    [22.05, 40.8],
    [21.62, 40.6],
    [21.27, 40.55],
    [20.99, 40.62],
    [20.78, 40.62],
    [20.3, 40.8],
    [19.9, 40.75],
    [19.56, 40.72],
    [19.35, 40.7],
    [18.85, 40.5],
    [18.33, 40.27],
  ],
  bg_mk_zid: [
    [23.3, 42.68],
    [23.04, 42.6],
    [22.69, 42.28],
    [22.42, 42.21],
    [22.2, 42.18],
    [21.71, 42.13],
    [21.43, 42.0],
  ],
  ua_ro_isac: [
    [29.0, 45.75],
    [28.7, 45.45],
    [28.46, 45.3],
    [28.45, 45.05],
    [28.4, 44.75],
  ],
  at_hu_mos: [
    [16.87, 48.3],
    [17.05, 48.05],
    [17.16, 47.95],
    [17.27, 47.87],
    [17.63, 47.68],
    [18.3, 47.55],
    [18.8, 47.5],
  ],
  ua_hu_ber: [
    [22.85, 48.45],
    [22.53, 48.2],
    [22.0, 47.95],
    [21.6, 47.7],
  ],
  gr_mk_evz: [
    [22.93, 40.72],
    [22.62, 40.98],
    [22.55, 41.12],
    [22.3, 41.3],
    [22.09, 41.48],
  ],
  rs_mk: [
    [21.9, 43.32],
    [21.95, 43.0],
    [21.9, 42.55],
    [21.78, 42.3],
    [21.71, 42.13],
    [21.43, 42.0],
  ],
  rs_ro: [
    [20.41, 45.93],
    [20.7, 46.05],
    [21.0, 46.12],
    [21.31, 46.18],
  ],
  hr_ba_south: [
    [17.05, 43.4],
    [17.2, 43.44],
    [17.33, 43.47],
    [17.5, 43.75],
    [17.66, 44.17],
  ],
  iap: [
    [19.56, 40.72],
    [19.55, 41.0],
    [19.45, 41.32],
    [19.55, 41.75],
    [19.51, 42.07],
    [19.26, 42.44],
    [18.85, 42.35],
    [18.55, 42.45],
    [18.11, 42.65],
    [17.7, 42.9],
    [17.43, 43.05],
    [16.95, 43.3],
    [16.45, 43.52],
  ],
  bb_balkanstream_bg: [
    [27.1, 42.33],
    [27.3, 42.7],
    [27.44, 43.18],
    [26.95, 43.3],
    [26.3, 43.45],
    [25.55, 43.4],
    [24.85, 43.4],
    [24.2, 43.33],
    [23.56, 43.24],
  ],
  bb_balkanstream_rs: [
    [21.41, 43.86],
    [21.2, 44.23],
    [21.08, 44.33],
    [20.93, 44.66],
    [20.97, 44.76],
    [20.75, 44.95],
    [20.39, 45.38],
    [20.13, 45.6],
  ],
  bb_transbalkan_bg: [
    [27.8, 43.5],
    [27.44, 43.18],
    [27.22, 42.7],
    [27.05, 42.35],
    [27.3, 42.1],
    [27.57, 41.97],
  ],
  tap_kipoi: [
    [26.9, 41.2],
    [26.31, 40.96],
  ],
  tap_komotini: [
    [25.4, 41.12],
    [25.39, 41.3],
  ],
  tap_nm: [
    [22.92, 40.72],
    [22.86, 40.52],
  ],
  hu_sk_bal: [
    [19.42, 47.63],
    [19.37, 47.83],
    [19.313333, 48.086056],
    [19.28, 48.2],
  ],
};
const lines = {};
for (const k in L) lines[k] = L[k].map((p) => P(...p));
const LAB = {
  Serbia: [20.35, 43.62],
  Hungary: [19.0, 46.95],
  Romania: [24.8, 45.6],
  Bulgaria: [24.9, 42.75],
  Greece: [22.2, 39.4],
  Macedonia: [21.7, 41.65],
  Albania: [20.1, 41.0],
  Montenegro: [19.25, 42.85],
  "Bosnia and Herz.": [17.8, 44.2],
  Croatia: [16.0, 45.25],
  Slovenia: [14.8, 46.15],
  Kosovo: [20.9, 42.55],
  Turkey: [27.3, 40.6],
  Austria: [15.4, 47.6],
  Slovakia: [19.5, 48.45],
  Ukraine: [25.4, 48.3],
  Moldova: [28.6, 47.2],
  Italy: [16.2, 40.9],
};
const labels = {};
for (const k in LAB) labels[k] = P(...LAB[k]);
const out = JSON.parse(fs.readFileSync("map.json"));
out.countries = out.countries.filter((c) => !["Vatican", "San Marino"].includes(c.name));
out.lines = lines;
out.labels = labels;
fs.writeFileSync("map.json", JSON.stringify(out));
console.log("with lines", fs.statSync("map.json").size);
