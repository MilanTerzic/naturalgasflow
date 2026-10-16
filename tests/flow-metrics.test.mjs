import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gastransAfterHungaryMcm,
  grossPipelineEntryMcm,
  hasOperationalObservation,
  isGastransResidualOutlier,
} from "../src/lib/gas/flow-metrics.ts";

function makeRow(kireevo, horgos, publishedPoints = [
  "kiskundorozsma_hu",
  "kireevo",
  "kiskundorozsma_2",
  "kalotina",
]) {
  return {
    date: "2026-10-14",
    kiskundorozsma_hu: 0,
    kireevo,
    kiskundorozsma_2: horgos,
    kalotina: 0.11,
    published_points: publishedPoints,
  };
}

test("gross pipeline entry includes transit, not just Serbia's domestic offtake", () => {
  const row = makeRow(27.05, 23.07);
  assert.equal(grossPipelineEntryMcm(row), 27.16);
  assert.ok(Math.abs(gastransAfterHungaryMcm(row) - 3.98) < 0.0001);
  assert.equal(isGastransResidualOutlier(row), false);
});

test("large mismatch between Kireevo and Horgos is explicitly flagged", () => {
  const row = makeRow(27.05, 6.53);
  assert.ok(Math.abs(gastransAfterHungaryMcm(row) - 20.52) < 0.0001);
  assert.equal(isGastransResidualOutlier(row), true);
});

test("a missing entry or exit never silently becomes a published zero", () => {
  const row = makeRow(27.05, 0, ["kireevo", "kalotina"]);
  assert.equal(grossPipelineEntryMcm(row), null);
  assert.equal(gastransAfterHungaryMcm(row), null);
  assert.equal(isGastransResidualOutlier(row), false);
});

test("published zero is valid, even with partial explicit provenance", () => {
  const row = makeRow(0, 0);
  row.point_source = { kireevo: "allocation", kiskundorozsma_2: "allocation" };
  assert.equal(hasOperationalObservation(row, "kiskundorozsma_hu"), true);
  assert.equal(grossPipelineEntryMcm(row), 0.11);
  assert.equal(gastransAfterHungaryMcm(row), 0);
});
