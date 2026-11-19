import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateByDay, parseRbpRow, rbpUnit, toMcmPerDay } from "../src/lib/rbp/bookings.ts";

// Rows taken from a real RBP CapacityAuctions export (Oct 2026), mapped to API field names.
const rows = JSON.parse(
  readFileSync(new URL("./fixtures/rbp-export-sample.json", import.meta.url), "utf8"),
);
const near = (a, b, tol = 0.001) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test("units come from the price unit: Gastrans kWh/h, Transportgas kWh/d", () => {
  assert.equal(rbpUnit({ reservePriceUnitEntryTSO: "kWh/h/day" }), "kWh/h");
  assert.equal(rbpUnit({ reservePriceUnitExitTSO: "kWh/d/month" }), "kWh/d");
  assert.equal(rbpUnit({}), null); // unknown unit: skipped, not guessed
  near(toMcmPerDay(270000, "kWh/h"), (270000 * 24) / 10.55e6);
  near(toMcmPerDay(4393000, "kWh/d"), 4393000 / 10.55e6);
});

test("real export: Kireevo day-ahead and Horgoš monthly allocations", () => {
  const parsed = rows.map(parseRbpRow).filter(Boolean);
  const kz = parsed.find((a) => a.auctionCode === "68441233-RBP");
  assert.equal(kz.unit, "kWh/h");
  near(kz.allocatedMcm, 0.6142); // 270 000 kWh/h
  near(kz.offeredMcm, 3.9266); // 1 726 071 kWh/h
  const kkd2 = parsed.find((a) => a.point === "Kiskundorozsma 2" && a.product === "Monthly");
  near(kkd2.allocatedMcm, 2.3295); // 1 024 022 kWh/h
  assert.equal(kkd2.from, "2026-10-01");
  assert.equal(kkd2.to, "2026-11-01");
  const kal = parsed.find((a) => a.point.startsWith("Kalotina"));
  assert.equal(kal.unit, "kWh/d");
});

test("aggregation: monthly covers every day, day-ahead only its day; no allocation ≠ zero", () => {
  const allocs = [
    { point: "P", product: "Monthly", from: "2026-10-01", to: "2026-11-01", allocatedMcm: 2 },
    { point: "P", product: "Day ahead", from: "2026-10-08", to: "2026-10-09", allocatedMcm: 0.5 },
    { point: "P", product: "Yearly", from: "2026-10-01", to: "2027-10-01", allocatedMcm: 1 },
    { point: "P", product: "Monthly", from: "2026-10-01", to: "2026-11-01", allocatedMcm: null },
  ];
  const { days, unpublished } = aggregateByDay(allocs, "2026-10-07", "2026-10-10");
  assert.deepEqual(
    days.map((d) => d.total),
    [3, 3.5, 3],
  );
  assert.equal(days[1].byProduct["Day ahead"], 0.5);
  assert.equal(unpublished, 1);
});
