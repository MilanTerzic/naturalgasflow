import { test } from "node:test";
import assert from "node:assert/strict";
import { nextNominationDay, nominationDays, splitHungaryEntry } from "../src/lib/gas/met-nominations.ts";

test("D+1 is available first even when no future balance dates exist", () => {
  assert.deepEqual(nominationDays(["2026-11-04", "2026-11-05"], "2026-11-05"),
    ["2026-11-06", "2026-11-05", "2026-11-04"]);
});

test("D+1 is not duplicated when tomorrow is already in the forecast", () => {
  assert.deepEqual(nominationDays(["2026-11-05", "2026-11-06", "2026-11-07"], "2026-11-05"),
    ["2026-11-06", "2026-11-05", "2026-11-07"]);
});

test("D+1 advances correctly at month and year boundaries", () => {
  assert.equal(nextNominationDay("2026-11-30"), "2026-12-01");
  assert.equal(nextNominationDay("2026-12-31"), "2027-01-01");
});

test("MET and Others add to the existing HU entry allocation", () => {
  const split = splitHungaryEntry(1.8, 6_330);
  assert.equal(split.status, "split");
  assert.ok(Math.abs(split.metMcm - 0.6) < 1e-8);
  assert.ok(Math.abs(split.othersMcm - 1.2) < 1e-8);
  assert.ok(Math.abs(split.metMcm + split.othersMcm - 1.8) < 1e-8);
});

test("an explicitly saved zero means all observed HU entry is Others", () => {
  const split = splitHungaryEntry(1.2, 0);
  assert.equal(split.status, "split");
  assert.equal(split.metMcm, 0);
  assert.equal(split.othersMcm, 1.2);
});

test("a day with no saved nomination defaults MET to 0 and the rest to Others", () => {
  const split = splitHungaryEntry(1.2, null);
  assert.equal(split.status, "default_zero");
  assert.equal(split.metMcm, 0);
  assert.equal(split.othersMcm, 1.2);
});

test("nomination exceeding HU allocation shows the full entry as Others", () => {
  const split = splitHungaryEntry(0.5, 10_550);
  assert.equal(split.status, "over_nomination");
  assert.equal(split.metMcm, null);
  assert.equal(split.othersMcm, 0.5);
  assert.ok(Math.abs(split.mismatchMcm - 0.5) < 1e-8);
});

test("nomination is retained when HU allocation is unavailable", () => {
  const split = splitHungaryEntry(null, 10_550);
  assert.equal(split.status, "missing_allocation");
  assert.equal(split.metMcm, null);
  assert.equal(split.othersMcm, null);
});
