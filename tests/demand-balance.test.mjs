import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBalance } from "../src/lib/gas/demand.ts";

const complete = ["kiskundorozsma_hu", "kireevo", "kiskundorozsma_2", "kalotina"];

test("published zero physical flows remain actual zero observations", () => {
  const rows = buildBalance({
    dates: ["2026-09-23"],
    todayIso: "2026-09-23",
    flows: [{
      date: "2026-09-23",
      kiskundorozsma_hu: 0,
      kireevo: 0,
      kiskundorozsma_2: 0,
      kalotina: 0,
      published_points: complete,
    }],
    temps: [{ date: "2026-09-23", temperature_c: 15 }],
    domesticProduction: 0.5,
  });

  assert.equal(rows[0].supply_available, true);
  assert.equal(rows[0].is_estimated, false);
  assert.equal(rows[0].serbian_available_supply_mcm, 0.5);
});

test("missing point uses an explicitly marked historical fallback", () => {
  const rows = buildBalance({
    dates: ["2026-09-22", "2026-09-23"],
    todayIso: "2026-09-23",
    flows: [
      {
        date: "2026-09-22",
        kiskundorozsma_hu: 1,
        kireevo: 10,
        kiskundorozsma_2: 7,
        kalotina: 1,
        published_points: complete,
      },
      {
        date: "2026-09-23",
        kiskundorozsma_hu: 1,
        kireevo: 10,
        kiskundorozsma_2: 0,
        kalotina: 1,
        published_points: ["kiskundorozsma_hu", "kireevo", "kalotina"],
      },
    ],
    temps: [
      { date: "2026-09-22", temperature_c: 15 },
      { date: "2026-09-23", temperature_c: 15 },
    ],
  });

  assert.equal(rows[1].supply_available, true);
  assert.equal(rows[1].is_estimated, true);
  assert.equal(rows[1].source_type, "historical_fallback");
  assert.match(rows[1].estimated_from ?? "", /2026-09-22/);
  assert.equal(rows[1].imports_from_bulgaria_mcm, 3);
});

test("future demand does not create a fake future supply or balance forecast", () => {
  const rows = buildBalance({
    dates: ["2026-09-23", "2026-09-24"],
    todayIso: "2026-09-23",
    flows: [{
      date: "2026-09-23",
      kiskundorozsma_hu: 1,
      kireevo: 10,
      kiskundorozsma_2: 7,
      kalotina: 1,
      published_points: complete,
    }],
    temps: [
      { date: "2026-09-23", temperature_c: 15 },
      { date: "2026-09-24", temperature_c: 14 },
    ],
  });

  assert.equal(rows[1].is_forecast, true);
  assert.equal(rows[1].supply_available, false);
  assert.equal(rows[1].source_type, "none");
  assert.equal(rows[1].storage_imbalance_raw_mcm, 0);
  assert.equal(rows[1].storage_imbalance_mcm, 0);
  assert.ok(rows[1].demand_mcm > 0);
});

test("raw system deficit is separated from feasible storage action and residual gap", () => {
  const rows = buildBalance({
    dates: ["2026-09-23"],
    todayIso: "2026-09-23",
    flows: [{
      date: "2026-09-23",
      kiskundorozsma_hu: 0,
      kireevo: 0,
      kiskundorozsma_2: 0,
      kalotina: 0,
      published_points: complete,
    }],
    temps: [{ date: "2026-09-23", temperature_c: 0 }],
    domesticProduction: 0.5,
    maxStorageWithdrawal: 5,
  });

  const row = rows[0];
  assert.ok(row.storage_imbalance_raw_mcm < -5);
  assert.equal(row.storage_imbalance_mcm, -5);
  assert.equal(
    row.residual_gap_mcm,
    row.storage_imbalance_raw_mcm - row.storage_imbalance_mcm,
  );
  assert.ok(row.residual_gap_mcm < 0);
});
