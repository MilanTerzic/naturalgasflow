import { test } from "node:test";
import assert from "node:assert/strict";
import { splitHungaryEntry } from "../src/lib/gas/met-nominations.ts";

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

test("a missing MET nomination must not pretend MET has zero", () => {
  const split = splitHungaryEntry(1.2, null);
  assert.equal(split.status, "missing_nomination");
  assert.equal(split.metMcm, null);
  assert.equal(split.othersMcm, null);
  assert.equal(split.unattributedMcm, 1.2);
});

test("nomination exceeding HU allocation flags mismatch and preserves total", () => {
  const split = splitHungaryEntry(0.5, 10_550);
  assert.equal(split.status, "over_nomination");
  assert.equal(split.othersMcm, null);
  assert.equal(split.unattributedMcm, 0.5);
  assert.ok(Math.abs(split.mismatchMcm - 0.5) < 1e-8);
});

test("nomination is retained when HU allocation is unavailable", () => {
  const split = splitHungaryEntry(null, 10_550);
  assert.equal(split.status, "missing_allocation");
  assert.equal(split.metMcm, null);
  assert.equal(split.othersMcm, null);
});
