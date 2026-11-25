import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildAlerts, d1Check, d1CheckSentence } from "../src/lib/newsletter/compute.ts";
import { mergeHistory } from "../src/lib/prices/hub-history.server.ts";

const base = {
  flowDay: "2026-11-24",
  borderPoints: [],
  net: { net: 11.6, avg7: 10.9, change: 0.7 },
  d1Net: 11.0,
  d1Day: "2026-11-26",
  check: null,
  arbitrage: [],
  priceDays: [],
};

test("quiet day: no alerts", () => {
  assert.deepEqual(buildAlerts(base), []);
});

test("alerts: utilisation, booked, net move, arbitrage first", () => {
  const out = buildAlerts({
    ...base,
    borderPoints: [
      { name: "Horgoš", flow: -22.91, technical: 23.3, booked: 22.9 },
      { name: "Kireevo", flow: 18, technical: 23.3, booked: 23.0 },
      { name: "Kalotina", flow: 0.1, technical: 5, booked: 0.1 },
      { name: "Unknown", flow: 3, technical: null, booked: null },
    ],
    net: { net: 11.6, avg7: 9.1, change: 2.5 },
    arbitrage: [{ short: "BG→HU via Gastrans", netMargin: 1.4, day: "2026-11-26" }],
    priceDays: [
      { hub: "TTF", change: -3.04, spreadTtf: null, spreadDay: null },
      { hub: "BGH", change: 1.4, spreadTtf: -5.34, spreadDay: "2026-11-26" },
      { hub: "CEGH", change: -2, spreadTtf: 1.78, spreadDay: "2026-11-26" },
    ],
  });
  assert.equal(out[0].level, "high");
  assert.match(out[0].text, /Arbitrage open/);
  assert.ok(out.some((a) => a.level === "high" && /Horgoš running at 98%/.test(a.text)));
  assert.ok(out.some((a) => /Kireevo firm capacity 99% booked/.test(a.text)));
  assert.ok(!out.some((a) => /Kalotina|Unknown|CEGH/.test(a.text)));
  assert.ok(out.some((a) => /\+2\.5 vs 7-day average/.test(a.text)));
  assert.ok(out.some((a) => /TTF day-ahead down €3\.04/.test(a.text)));
  assert.ok(out.some((a) => /BGH discount to TTF €5\.34/.test(a.text)));
});

test("D+1 check only for the flow day, signed actual − expected", () => {
  const stored = { made_on: "2026-11-23", forecast_for: "2026-11-24", net_mcm: 10.7 };
  assert.equal(d1Check(stored, "2026-11-25", 11), null);
  assert.equal(d1Check(stored, "2026-11-24", null), null);
  const c = d1Check(stored, "2026-11-24", 11.58);
  assert.equal(Number(c.error.toFixed(2)), 0.88);
  assert.match(d1CheckSentence(c), /expected 10\.7 .* actual 11\.6 .*\+0\.9/);
  const miss = buildAlerts({ ...base, check: { ...c, actual: 13, error: 2.3 } });
  assert.ok(miss.some((a) => /missed by 2\.3/.test(a.text)));
});

test("stored price history: live fills in, provisional never replaces final", () => {
  const stored = [
    { date: "2026-11-20", label: "a", price: 80, final: true },
    { date: "2026-11-24", label: "b", price: 90, final: true },
  ];
  const live = [
    { date: "2026-11-24", label: "c", price: 91, final: false },
    { date: "2026-11-25", label: "d", price: 92, final: false },
  ];
  assert.deepEqual(
    mergeHistory(stored, live).map((p) => [p.date, p.price]),
    [
      ["2026-11-20", 80],
      ["2026-11-24", 90],
      ["2026-11-25", 92],
    ],
  );
});
