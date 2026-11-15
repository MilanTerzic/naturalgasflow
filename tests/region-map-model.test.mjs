import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLinkValues, linkWidth } from "../src/lib/region/map-model.ts";

const row = (date, extra = {}) => ({
  date,
  kiskundorozsma_hu: 0.5,
  kireevo: 30,
  kiskundorozsma_2: 23,
  kalotina: 1.2,
  published_points: ["kiskundorozsma_hu", "kireevo", "kiskundorozsma_2", "kalotina"],
  ...extra,
});
const bal = (date, bosnia) => ({ date, bosnia_consumption_mcm: bosnia, is_forecast: false });

test("day mode reads Serbian points with provenance and leaves missing points empty", () => {
  const rows = [
    row("2026-11-01"),
    row("2026-11-02", {
      published_points: ["kireevo"],
      point_source: { kireevo: "allocation", kalotina: "renomination" },
    }),
  ];
  const v = buildLinkValues({
    mode: "day",
    date: "2026-11-02",
    rows,
    balance: [bal("2026-11-02", 0.6)],
    primary: "allocation",
    regional: null,
  });
  assert.deepEqual(v.bg_rs_kz, {
    value: 30,
    status: "actual",
    label: "2026-11-02",
    source: "allocation",
  });
  assert.equal(v.bg_rs_kal.status, "provisional");
  assert.equal(v.hu_rs_1.value, null);
  assert.equal(v.hu_rs_1.status, "missing");
  assert.equal(v.rs_ba_zv.status, "model");
  assert.equal(v.tr_bg_str.status, "missing");
});

test("period average uses only reported days of the primary series", () => {
  const rows = [
    row("2026-11-01", { kireevo: 20 }),
    row("2026-11-02", { kireevo: 40 }),
    row("2026-11-03", { published_points: [] }),
  ];
  const v = buildLinkValues({
    mode: "average",
    date: null,
    rows,
    balance: [],
    primary: "allocation",
    regional: null,
  });
  assert.equal(v.bg_rs_kz.value, 30);
});

test("regional values are signed net flows for the selected day", () => {
  const regional = {
    gr_bg_kul: {
      id: "gr_bg_kul",
      points: [],
      days: [{ date: "2026-11-01", forward: 1, reverse: 3, net: -2 }],
    },
  };
  const v = buildLinkValues({
    mode: "day",
    date: "2026-11-01",
    rows: [row("2026-11-01")],
    balance: [],
    primary: "allocation",
    regional,
  });
  assert.equal(v.gr_bg_kul.value, -2);
  assert.equal(
    buildLinkValues({
      mode: "day",
      date: "2026-11-02",
      rows: [],
      balance: [],
      primary: "allocation",
      regional,
    }).gr_bg_kul.value,
    null,
  );
});

test("line width grows with volume and is capped", () => {
  assert.ok(linkWidth(10, 40) < linkWidth(40, 40));
  assert.equal(linkWidth(80, 40), linkWidth(40, 40));
  assert.equal(linkWidth(null, 40), 1.6);
});

test("regional values carry the selected indicator as their source", () => {
  const regional = { tr_bg_str: { id: "tr_bg_str", points: [], days: [{ date: "2026-11-01", forward: 40, reverse: null, net: 40 }] } };
  const day = buildLinkValues({ mode: "day", date: "2026-11-01", rows: [], balance: [], primary: "allocation", regional });
  assert.equal(day.tr_bg_str.source, "allocation");
  const avg = buildLinkValues({ mode: "average", date: null, rows: [], balance: [], primary: "physical_flow", regional });
  assert.equal(avg.tr_bg_str.source, "physical_flow");
});

test("capacity follows the flow direction for the selected day and averages over the period", async () => {
  const { sharePct } = await import("../src/lib/region/map-model.ts");
  const regional = { gr_bg_kul: { id: "gr_bg_kul", points: [], days: [{ date: "2026-11-01", forward: 1, reverse: 3, net: -2 }] } };
  const capacity = {
    gr_bg_kul: { id: "gr_bg_kul", days: [{ date: "2026-11-01", forwardTechnical: 10, forwardBooked: 4, reverseTechnical: 8, reverseBooked: 6 }] },
    bg_rs_kz: { id: "bg_rs_kz", days: [
      { date: "2026-11-01", forwardTechnical: 40, forwardBooked: 30, reverseTechnical: null, reverseBooked: null },
      { date: "2026-11-02", forwardTechnical: 40, forwardBooked: 20, reverseTechnical: null, reverseBooked: null },
    ] },
  };
  const rows = [row("2026-11-01"), row("2026-11-02")];
  const day = buildLinkValues({ mode: "day", date: "2026-11-01", rows, balance: [], primary: "allocation", regional, capacity });
  assert.equal(day.gr_bg_kul.technical, 8); // reverse flow → reverse capacity
  assert.equal(day.gr_bg_kul.booked, 6);
  assert.equal(day.bg_rs_kz.technical, 40);
  const avg = buildLinkValues({ mode: "average", date: null, rows, balance: [], primary: "allocation", regional, capacity });
  assert.equal(avg.bg_rs_kz.booked, 25);
  assert.equal(sharePct(30, 40), 75);
  assert.equal(sharePct(1, 0), null);
});
