import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCapacityRouteSummaries,
  capacityUnitToMwhDay,
  deduplicateCapacityAggregate,
  selectCapacityForReferenceDate,
} from "../src/lib/gas/capacity-utils.ts";
import { CAPACITY_ROUTES } from "../src/lib/gas/capacity-routes.ts";

const baseRow = (overrides) => ({
  route_id: "fgsz-kiskundorozsma-hu-exit",
  tso: "FGSZ",
  border_point: "Kiskundorozsma (HU) / Kiskundorozsma (RS)",
  direction: "exit",
  product: "daily",
  period: "2026-01-01",
  technical_mwh: 1000,
  offered_mwh: 1000,
  booked_mwh: 500,
  utilisation_pct: 50,
  price: 0,
  currency: "HUF",
  price_unit: "HUF/kWh/h/day",
  source: "ENTSOG",
  source_date: "2026-01-01",
  capacity_source_date: "2026-01-01",
  fetched_at: "2026-01-01T00:00:00Z",
  is_proxy: false,
  is_carried_forward: false,
  is_stale: false,
  data_status: "live",
  ...overrides,
});

test("capacity-unit conversion supports documented units", () => {
  assert.equal(capacityUnitToMwhDay(1000, "kWh/d"), 1);
  assert.equal(capacityUnitToMwhDay(2, "MWh/d"), 2);
  assert.equal(capacityUnitToMwhDay(3, "GWh/d"), 3000);
  assert.equal(capacityUnitToMwhDay(1000, "kWh/h"), 24);
  assert.throws(() => capacityUnitToMwhDay(1, "therm/d"), /Unsupported capacity unit/);
  assert.throws(() => capacityUnitToMwhDay(-1, "kWh/d"), /Negative capacity/);
});

test("route mapping preserves the required six-row order", () => {
  assert.deepEqual(
    CAPACITY_ROUTES.map((route) => route.id),
    [
      "fgsz-kiskundorozsma-hu-exit",
      "bgt-kireevo-bg-exit",
      "gastrans-kireevo-entry",
      "bgt-kalotina-bg-exit",
      "gastrans-kiskundorozsma2-exit",
      "fgsz-kiskundorozsma2-entry",
    ],
  );
});

test("counterparty proxy routes remain visibly marked", () => {
  const rows = [
    baseRow({
      route_id: "gastrans-kireevo-entry",
      tso: "Gastrans",
      border_point: "Kireevo (BG) / Zaychar (RS)",
      direction: "entry",
      source: "ENTSOG counterpart",
      data_status: "proxy",
      is_proxy: true,
    }),
  ];
  const summaries = buildCapacityRouteSummaries(rows, [
    {
      date: "2026-01-01",
      kiskundorozsma_hu: 0,
      kireevo: 1,
      kalotina: 0,
      kiskundorozsma_2: 0,
    },
  ]);
  const proxy = summaries.find((summary) => summary.route.id === "gastrans-kireevo-entry");
  assert.equal(proxy?.is_proxy, true);
  assert.equal(proxy?.source, "ENTSOG counterpart");
  assert.equal(proxy?.data_status, "proxy");
});

test("reference-date selection uses latest row on or before the flow date", () => {
  const rows = [
    baseRow({ period: "2026-01-01", technical_mwh: 1000, offered_mwh: 1000 }),
    baseRow({ period: "2026-01-03", technical_mwh: 3000, offered_mwh: 3000 }),
    baseRow({ period: "2026-01-05", technical_mwh: 5000, offered_mwh: 5000 }),
  ];
  const selected = selectCapacityForReferenceDate(
    rows,
    "fgsz-kiskundorozsma-hu-exit",
    "2026-01-04",
  );
  assert.equal(selected?.period, "2026-01-03");
  assert.equal(selected?.technical_mwh, 3000);
});

test("paired-route aggregate deduplicates physical corridors", () => {
  const rows = [
    baseRow({
      route_id: "bgt-kireevo-bg-exit",
      tso: "Bulgartransgaz",
      border_point: "Kireevo (BG) / Zaychar (RS)",
      technical_mwh: 10_550,
      offered_mwh: 10_550,
      booked_mwh: 5_275,
    }),
    baseRow({
      route_id: "gastrans-kireevo-entry",
      tso: "Gastrans",
      border_point: "Kireevo (BG) / Zaychar (RS)",
      direction: "entry",
      technical_mwh: 10_550,
      offered_mwh: 10_550,
      booked_mwh: 5_275,
      source: "ENTSOG counterpart",
      data_status: "proxy",
      is_proxy: true,
    }),
  ];
  const summaries = buildCapacityRouteSummaries(rows, [
    {
      date: "2026-01-01",
      kiskundorozsma_hu: 0,
      kireevo: 1,
      kalotina: 0,
      kiskundorozsma_2: 0,
    },
  ]);
  const aggregate = deduplicateCapacityAggregate(summaries);
  assert.equal(aggregate.technical_mcm, 1);
  assert.equal(aggregate.booked_mcm, 0.5);
  assert.equal(aggregate.used_mcm, 1);
});

test("unavailable values remain null while real zero capacity is preserved", () => {
  const zeroRow = baseRow({
    route_id: "bgt-kalotina-bg-exit",
    tso: "Bulgartransgaz",
    border_point: "Kalotina (BG) / Dimitrovgrad (RS)",
    technical_mwh: 0,
    offered_mwh: 0,
    booked_mwh: 0,
  });
  const summaries = buildCapacityRouteSummaries(
    [zeroRow],
    [
      {
        date: "2026-01-01",
        kiskundorozsma_hu: 0,
        kireevo: 1,
        kalotina: 0,
        kiskundorozsma_2: 0,
      },
    ],
  );
  const kalotina = summaries.find((summary) => summary.route.id === "bgt-kalotina-bg-exit");
  const unavailable = summaries.find(
    (summary) => summary.route.id === "fgsz-kiskundorozsma2-entry",
  );
  assert.equal(kalotina?.technical_mcm, 0);
  assert.equal(kalotina?.booked_mcm, 0);
  assert.equal(kalotina?.used_mcm, 0);
  assert.equal(unavailable?.technical_mcm, null);
  assert.equal(unavailable?.booked_mcm, null);
});
