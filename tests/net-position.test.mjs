// Country net positions, tested on ENTSOG data captured from the live API (gas day 2026-11-14).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applySupplements,
  averageComponents,
  fromParts,
  neighbourOf,
  parseAggregated,
} from "../src/lib/region/net-position.ts";
import { indexOperationalRows } from "../src/lib/region/regional-feed.ts";
import { balanceGap, buildNetRows } from "../src/lib/region/net-position-view.ts";

const fx = JSON.parse(
  readFileSync(new URL("./fixtures/entsog-aggregated-20261114.json", import.meta.url), "utf8"),
);
const D = "2026-11-14";
const near = (a, b, tol = 0.005) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test("neighbour codes from adjacent-system keys", () => {
  assert.equal(neighbourOf("TransmissionBG-NGTS----"), "BG");
  assert.equal(neighbourOf("TransmissionRO-TBP-----"), "RO");
  assert.equal(neighbourOf("Transmission"), "non-EU");
});

test("Bulgaria: imports + storage − exports matches reported consumption", () => {
  const bg = parseAggregated(fx.aggregated).get("BG").get(D);
  near(bg.imports, 58.228); // incl. ICGB entry from Greece (BG-TSO-0003)
  near(bg.storage, 3.831);
  near(bg.exports, 54.444);
  near(bg.net, 7.615);
  near(bg.consumption, 7.833);
  assert.ok(Math.abs(balanceGap(bg)) < 0.3);
  assert.equal(bg.provisional, true);
});

test("Hungary: production net of blending exit; storage withdrawal; SK export", () => {
  const hu = parseAggregated(fx.aggregated).get("HU").get(D);
  near(hu.production, 3.318);
  near(hu.storage, 6.125);
  near(hu.imports, 34.411);
  near(hu.exports, 13.039);
  near(hu.net, 30.815);
  near(hu.consumption, 31.943);
  near(hu.byNeighbour.SK, -12.006);
});

test("Greece: aggregate misses the FSRU and TAP; supplements close the gap", () => {
  const net = parseAggregated(fx.aggregated);
  const before = net.get("GR").get(D).net;
  near(before, 8.114);
  const flows = new Map(
    [...indexOperationalRows(fx.points, "Physical Flow", D, D, new Map(), {})].map(([pd, m]) => [
      pd,
      new Map([...m].map(([d, v]) => [d, v.value])),
    ]),
  );
  applySupplements(net, flows);
  const gr = net.get("GR").get(D);
  near(gr.lng, 3.431);
  near(gr.byNeighbour.TAP, 2.708);
  near(gr.net, 14.044);
  near(gr.consumption, 15.083);
});

test("empty values are missing, not zero; internal TSO transfers excluded", () => {
  const rows = [
    {
      countryKey: "BG",
      directionKey: "entry",
      adjacentSystemsKey: "TransmissionBG-NGTS----",
      periodFrom: `${D}T06:00:00+01:00`,
      unit: "kWh/d",
      value: 1e8,
    },
    {
      countryKey: "BG",
      directionKey: "exit",
      adjacentSystemsKey: "Final Consumers",
      periodFrom: `${D}T06:00:00+01:00`,
      unit: "kWh/d",
      value: "",
    },
  ];
  const bg = parseAggregated(rows).get("BG").get(D);
  assert.equal(bg.imports, 0);
  assert.equal(bg.consumption, null);
});

test("period average and non-ENTSOG countries from corridor values", () => {
  const a = fromParts({ imports: 10, exports: 4, consumption: 6 });
  const b = fromParts({ imports: 12, exports: 4, consumption: null });
  const avg = averageComponents([a, b]);
  assert.equal(avg.net, 7);
  assert.equal(avg.consumption, 6); // averaged over days where it was published
  const values = {
    hu_rs_1: { value: 0.1 },
    rs_hu_2: { value: 22.57 },
    bg_rs_kz: { value: 31.4 },
    bg_rs_kal: { value: 0.1 },
    rs_ba_zv: { value: 0.6 },
    bg_mk_zid: { value: 1.4 },
  };
  const balance = [
    {
      date: D,
      is_forecast: false,
      domestic_production_mcm: 0.9,
      storage_withdrawal_mcm: 1.0,
      storage_injection_mcm: 0,
      demand_mcm: 10.2,
    },
  ];
  const rows = buildNetRows({ mode: "day", date: D, days: [D], entsog: null, values, balance });
  const rs = rows.find((r) => r.code === "RS").c;
  near(rs.imports, 31.6);
  near(rs.exports, 23.17);
  near(rs.net, 31.6 + 1.0 + 0.9 - 23.17);
  near(rs.byNeighbour.HU, 0.1 - 22.57);
  assert.equal(rows.find((r) => r.code === "MK").c.imports, 1.4);
  assert.equal(rows.find((r) => r.code === "BA").source, "model");
  assert.equal(rows.find((r) => r.code === "BG").c, null); // no ENTSOG data passed
});
