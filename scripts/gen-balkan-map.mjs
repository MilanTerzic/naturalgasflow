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
  KISK: [19.98, 46.17],
  KZ: [22.52, 43.86],
  KAL: [22.85, 43.0],
  ZVOR: [19.1, 44.4],
  // regional IPs
  STR: [27.05, 41.97],
  KUL: [23.36, 41.4],
  IGB: [25.55, 41.5],
  NEG: [28.17, 43.79],
  RUSE: [25.97, 43.87],
  CSA: [20.73, 46.25],
  DRAV: [17.96, 45.84],
  ROG: [15.7, 46.23],
  KRK: [14.56, 45.22],
  ALEX: [25.95, 40.75],
  REV: [23.4, 37.96],
  KIPI: [26.3, 40.92],
  ZID: [22.58, 42.27],
  ISAC: [28.46, 45.27],
  MOS: [17.27, 47.88],
  // Hungary–Slovakia gas IP: coordinates from the bilateral pipeline agreement.
  BAL: [19.313333, 48.086056],
  BER: [22.55, 48.2],
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
  PRI: [21.16, 42.66],
  NIS: [21.9, 43.32],
  NS: [19.84, 45.25],
  SZE: [20.15, 46.25],
  ARAD: [21.31, 46.17],
  VARNA: [27.91, 43.21],
  STZ: [25.63, 42.42],
  KOM: [25.4, 41.12],
  THES: [22.94, 40.64],
  ISTB: [28.6, 41.2],
  KIYI: [27.55, 41.62],
  ODE: [29.0, 45.6],
  VIENNA: [16.9, 48.1],
  UZH: [22.3, 48.6],
  BDVOR: [20.47, 45.53],
  CHIREN: [23.53, 43.3],
  OMIS: [14.6, 45.27],
  IT: [18.6, 40.4],
  TORDA: [20.3, 45.6],
  MOKRIN: [20.42, 45.93],
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
const L = {
  hu_rs_1: [
    [19.62, 46.85],
    [19.98, 46.17],
    [20.02, 45.62],
    [20.3, 45.05],
  ],
  rs_hu_2: [
    [19.8, 45.3],
    [19.8, 45.85],
    [19.86, 46.17],
    [19.45, 46.8],
  ],
  bg_rs_kz: [
    [24.0, 43.55],
    [23.15, 43.72],
    [22.52, 43.86],
    [21.95, 43.95],
    [21.35, 43.98],
  ],
  bg_rs_kal: [
    [23.32, 42.7],
    [22.85, 43.0],
    [22.35, 43.18],
    [21.9, 43.32],
  ],
  rs_ba_zv: [
    [20.3, 44.62],
    [19.62, 44.47],
    [19.1, 44.4],
    [18.7, 44.18],
    [18.41, 43.86],
  ],
  tr_bg_str: [
    [28.1, 41.4],
    [27.55, 41.72],
    [27.05, 41.97],
    [26.75, 42.35],
  ],
  gr_bg_kul: [
    [22.94, 40.64],
    [23.2, 41.0],
    [23.36, 41.4],
    [23.28, 41.95],
    [23.32, 42.55],
  ],
  gr_bg_igb: [
    [25.4, 41.12],
    [25.55, 41.5],
    [25.62, 41.98],
    [25.63, 42.42],
  ],
  ro_bg_neg: [
    [28.35, 44.45],
    [28.17, 43.79],
    [27.95, 43.35],
  ],
  ro_bg_ruse: [
    [26.1, 44.33],
    [25.97, 43.87],
    [25.7, 43.45],
  ],
  ro_hu_csa: [
    [21.31, 46.17],
    [20.73, 46.25],
    [20.25, 46.38],
  ],
  hu_hr_drav: [
    [18.25, 46.3],
    [17.96, 45.84],
    [17.4, 45.62],
    [16.3, 45.78],
  ],
  si_hr_rog: [
    [15.15, 46.3],
    [15.7, 46.23],
    [15.95, 45.88],
  ],
  lng_krk: [
    [14.3, 45.02],
    [14.56, 45.22],
    [15.1, 45.5],
    [15.85, 45.78],
  ],
  lng_alex: [
    [25.8, 40.5],
    [25.95, 40.75],
    [25.62, 41.02],
  ],
  lng_rev: [
    [23.15, 37.72],
    [23.4, 37.96],
    [23.72, 38.12],
  ],
  tr_gr_kipi: [
    [26.95, 41.05],
    [26.3, 40.92],
    [25.9, 40.98],
  ],
  gr_al_tap: [
    [26.3, 40.92],
    [25.4, 41.12],
    [24.1, 40.98],
    [22.94, 40.7],
    [21.6, 40.62],
    [20.99, 40.62],
    [20.1, 40.68],
    [19.56, 40.72],
    [18.9, 40.55],
    [18.6, 40.4],
  ],
  tap_kipoi: [
    [26.9, 41.2],
    [26.3, 40.92],
  ],
  tap_komotini: [
    [25.4, 41.12],
    [25.42, 41.34],
  ],
  tap_nm: [
    [22.94, 40.7],
    [22.86, 40.52],
  ],
  bg_mk_zid: [
    [23.05, 42.42],
    [22.58, 42.27],
    [22.0, 42.12],
    [21.43, 42.0],
  ],
  ua_ro_isac: [
    [28.95, 45.62],
    [28.46, 45.27],
    [28.2, 44.85],
  ],
  at_hu_mos: [
    [16.92, 48.02],
    [17.27, 47.88],
    [17.95, 47.7],
    [18.65, 47.55],
  ],
  hu_sk_bal: [
    [19.42, 47.63],
    [19.37, 47.83],
    [19.313333, 48.086056], // HU–SK border crossing (Balassagyarmat / Veľké Zlievce)
    [19.28, 48.2],
  ],
  ua_hu_ber: [
    [22.95, 48.45],
    [22.55, 48.2],
    [21.9, 47.95],
  ],
  // planned / under development
  gr_mk_evz: [
    [22.94, 40.64],
    [22.55, 41.12],
    [22.2, 41.48],
  ],
  rs_mk: [
    [21.9, 43.32],
    [21.72, 42.8],
    [21.43, 42.0],
  ],
  rs_ro: [
    [20.42, 45.93],
    [20.9, 46.05],
    [21.31, 46.17],
  ],
  hr_ba_south: [
    [17.43, 43.05],
    [17.75, 43.32],
    [18.41, 43.86],
  ],
  iap: [
    [19.56, 40.72],
    [19.5, 41.35],
    [19.26, 42.44],
    [18.6, 42.95],
    [17.43, 43.05],
    [16.45, 43.52],
  ],
  // static backbones (no data, context only)
  bb_balkanstream_bg: [
    [26.75, 42.35],
    [26.3, 42.85],
    [25.6, 43.25],
    [24.7, 43.5],
    [24.0, 43.55],
  ],
  bb_balkanstream_rs: [
    [21.35, 43.98],
    [21.05, 44.35],
    [20.55, 44.85],
    [19.8, 45.3],
  ],
  bb_transbalkan_bg: [
    [27.95, 43.35],
    [27.8, 42.8],
    [27.4, 42.2],
    [27.05, 41.97],
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
