import { test } from "node:test";
import assert from "node:assert/strict";
import {
  netIntoSerbia,
  pickFlowDay,
  pointRows,
  priceChartRows,
  priceRows,
  storageRow,
  summarySentences,
} from "../src/lib/newsletter/compute.ts";

const ALL = ["kiskundorozsma_hu", "kireevo", "kiskundorozsma_2", "kalotina"];
const row = (date, extra = {}) => ({
  date,
  kiskundorozsma_hu: 1,
  kireevo: 30,
  kiskundorozsma_2: 20,
  kalotina: 2,
  point_source: Object.fromEntries(ALL.map((p) => [p, "physical_flow"])),
  ...extra,
});

test("flow day is the newest complete day before today; nominations do not count", () => {
  const rows = [
    row("2026-11-20"),
    row("2026-11-21"),
    row("2026-11-22", {
      point_source: { kireevo: "physical_flow", kalotina: "nomination" },
      published_points: ["kireevo"],
    }),
    row("2026-11-23"),
  ];
  assert.deepEqual(pickFlowDay(rows, "2026-11-23"), { date: "2026-11-21", complete: true });
  assert.deepEqual(pickFlowDay([rows[2]], "2026-11-23"), { date: "2026-11-22", complete: false });
  assert.deepEqual(pickFlowDay([], "2026-11-23"), { date: null, complete: false });
});

test("point rows compare the flow day with the seven days before it and keep gaps empty", () => {
  const rows = [
    row("2026-11-19", { kireevo: 28 }),
    row("2026-11-20", { kireevo: 32 }),
    row("2026-11-21", {
      kireevo: 35,
      point_source: { kireevo: "physical_flow" },
      published_points: ["kireevo"],
    }),
  ];
  const out = Object.fromEntries(pointRows(rows, "2026-11-21").map((r) => [r.point, r]));
  assert.equal(out.kireevo.value, 35);
  assert.equal(out.kireevo.avg7, 30);
  assert.equal(out.kireevo.change, 5);
  assert.equal(out.kalotina.value, null);
  assert.equal(out.kalotina.change, null);
});

test("net into Serbia uses the map definition and needs the Bosnia model", () => {
  const rows = [row("2026-11-20"), row("2026-11-21")];
  const balance = [
    { date: "2026-11-20", bosnia_consumption_mcm: 1 },
    { date: "2026-11-21", bosnia_consumption_mcm: 1 },
  ];
  const out = netIntoSerbia(rows, balance, "2026-11-21");
  assert.equal(out.net, 1 + 30 + 2 - 20 - 1);
  assert.equal(out.change, 0);
  assert.equal(netIntoSerbia(rows, [], "2026-11-21").net, null);
});

test("price rows give change and same-day TTF spread only", () => {
  const p = (date, price) => ({ date, label: date, price, final: true });
  const rows = Object.fromEntries(
    priceRows({
      TTF: [p("2026-11-22", 30), p("2026-11-23", 31)],
      CEGH: [p("2026-11-22", 33), p("2026-11-23", 34.5)],
      BGH: [p("2026-11-24", 36)],
      HENEX: [],
    }).map((r) => [r.hub, r]),
  );
  assert.equal(rows.CEGH.change, 1.5);
  assert.equal(rows.CEGH.spreadTtf, 3.5);
  assert.equal(rows.TTF.spreadTtf, null);
  assert.equal(rows.BGH.change, null);
  assert.equal(rows.BGH.spreadTtf, null, "no TTF for that day: no spread invented");
  assert.equal(rows.HENEX.latest, null);
  const chart = priceChartRows(
    { TTF: [p("2026-11-22", 30)], BGH: [p("2026-11-24", 36)] },
    "2026-11-01",
  );
  assert.deepEqual(chart, [
    { date: "2026-11-22", TTF: 30, BGH: null },
    { date: "2026-11-24", BGH: 36, TTF: null },
  ]);
});

test("storage row reports fill, weekly change and net injection", () => {
  const d = (gasDayStart, full, injection = 10, withdrawal = 40) => ({
    gasDayStart,
    full,
    gasInStorage: full / 10,
    injection,
    withdrawal,
  });
  const out = storageRow([d("2026-11-14", 90), d("2026-11-21", 88.5), d("2026-11-17", 89)]);
  assert.equal(out.date, "2026-11-21");
  assert.equal(out.changeWeek, -1.5);
  assert.equal(out.netInjection, -30);
  assert.equal(storageRow(undefined).full, null);
});

test("summary drops sentences whose data is missing", () => {
  const lines = summarySentences({
    flowDay: "2026-11-22",
    flowComplete: true,
    net: { net: 12.3, avg7: 11, change: 1.3 },
    points: [{ point: "kireevo", value: 35, avg7: 30, change: 5 }],
    deliveryDay: "2026-11-24",
    demandD1: { demand: 14.2, temperature: 2.1 },
    today: "2026-11-23",
    priceDays: [
      {
        hub: "TTF",
        a: { date: "2026-11-23", label: "", price: 31, final: true },
        b: null,
        change: null,
        spreadTtf: null,
        spreadDay: null,
      },
    ],
    storageRs: null,
  });
  assert.equal(lines.length, 4);
  assert.match(lines[0], /12\.3 mcm\/d \(\+1\.3 vs 7-day average\)/);
  assert.match(lines[1], /Kireevo\/Zaječar 35\.0 mcm\/d \(\+5\.0\)/);
  assert.match(lines[3], /delivery 2026-11-23 .*TTF €31\.00/);
});

test("price day rows put every hub on the same delivery days", async () => {
  const { priceDayRows } = await import("../src/lib/newsletter/compute.ts");
  const p = (date, price, final = true) => ({ date, label: date, price, final });
  const rows = Object.fromEntries(
    priceDayRows(
      {
        TTF: [p("2026-11-24", 91), p("2026-11-25", 90, false)],
        CEGH: [p("2026-11-23", 93), p("2026-11-24", 92)],
        BGH: [p("2026-11-24", 79), p("2026-11-25", 80)],
      },
      "2026-11-24",
      "2026-11-25",
    ).map((r) => [r.hub, r]),
  );
  assert.equal(rows.CEGH.a.price, 92);
  assert.equal(rows.CEGH.b, null, "a hub without tomorrow stays pending");
  assert.equal(rows.CEGH.change, null);
  assert.equal(rows.CEGH.spreadDay, "2026-11-24");
  assert.equal(rows.CEGH.spreadTtf, 1);
  assert.equal(rows.BGH.change, 1);
  assert.equal(rows.BGH.spreadDay, "2026-11-25");
  assert.equal(rows.BGH.spreadTtf, -10);
});
