import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyEurPerMwh, gasDayHours, gasYearMonth } from "../src/lib/gas/tariffs/convert.ts";
import { TARIFF_BY_ID } from "../src/lib/gas/tariffs/data.ts";
import { arbitrageSentences, computeAll, computeRoute, ROUTES } from "../src/lib/gas/arbitrage.ts";

const fx = { date: "2026-11-24", hufPerEur: 385, rsdPerEur: 117.2, source: "test" };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("gas-year month index and DST gas days", () => {
  assert.equal(gasYearMonth("2026-10-15"), 0);
  assert.equal(gasYearMonth("2026-11-26"), 1);
  assert.equal(gasYearMonth("2027-01-10"), 3);
  assert.equal(gasYearMonth("2027-09-30"), 11);
  assert.equal(gasDayHours("2026-11-26"), 24);
  // 2027: clocks forward Sun 28 Mar, back Sun 31 Oct; the gas day starting Saturday spans it.
  assert.equal(gasDayHours("2027-03-27"), 23);
  assert.equal(gasDayHours("2027-03-28"), 24);
  assert.equal(gasDayHours("2027-10-30"), 25);
});

test("unit conversions to EUR/MWh at full utilisation", () => {
  // BTG: EUR/MWh/day is already per MWh; seasonal: Nov, Jan, Jul.
  close(dailyEurPerMwh(TARIFF_BY_ID["btg-kireevo-exit"], "2026-11-26", fx).eurPerMwh, 2.0432);
  close(dailyEurPerMwh(TARIFF_BY_ID["btg-kireevo-exit"], "2027-01-15", fx).eurPerMwh, 2.5808);
  close(dailyEurPerMwh(TARIFF_BY_ID["btg-kireevo-exit"], "2027-07-15", fx).eurPerMwh, 1.1112);
  // Gastrans: EUR/(kWh/h) per day → ×1000/24, and /23 on the short DST gas day.
  close(dailyEurPerMwh(TARIFF_BY_ID["gt-kirevo-entry"], "2026-11-26", fx).eurPerMwh, 34 / 24);
  close(dailyEurPerMwh(TARIFF_BY_ID["gt-kirevo-entry"], "2027-03-27", fx).eurPerMwh, 34 / 23);
  // FGSZ: HUF/(kWh/h)/year × daily multiplier (Nov 0.60%, Jan 0.75%) ×1000/24 / HUF per EUR.
  close(
    dailyEurPerMwh(TARIFF_BY_ID["fgsz-kkd-exit"], "2026-11-26", fx).eurPerMwh,
    (1326.48 * 0.006 * 1000) / 24 / 385,
  );
  close(
    dailyEurPerMwh(TARIFF_BY_ID["fgsz-kkd-entry"], "2027-01-15", fx).eurPerMwh,
    (1149.06 * 0.0075 * 1000) / 24 / 385,
  );
  // Transportgas: RSD/(kWh/day) for one day ×1000 / RSD per EUR.
  close(dailyEurPerMwh(TARIFF_BY_ID["tgs-entry-ts"], "2026-11-26", fx).eurPerMwh, 83.1 / 117.2);
});

test("missing FX or out-of-period tariff is UNAVAILABLE, never zero", () => {
  const r = dailyEurPerMwh(TARIFF_BY_ID["fgsz-kkd-exit"], "2026-11-26", { ...fx, hufPerEur: null });
  assert.equal(r.eurPerMwh, null);
  assert.equal(r.status, "UNAVAILABLE");
  assert.equal(
    dailyEurPerMwh(TARIFF_BY_ID["btg-kireevo-exit"], "2027-10-01", fx).status,
    "UNAVAILABLE",
  );
});

const day = "2026-11-26";
const p = (price, final = true, date = day) => ({ date, price, final });

test("BG→RS→HU forward: costs, fuel, net margin and status", () => {
  const route = ROUTES.find((r) => r.id === "bg-rs-hu");
  const r = computeRoute(route, day, { origin: p(80), destination: p(86, false) }, fx);
  const cap = 2.0432 + 34 / 24 + 38.8 / 24 + (1149.06 * 0.006 * 1000) / 24 / 385;
  close(r.capacityCost, cap);
  close(r.otherFees, 0.1072 - 0.0101);
  close(r.fuelCost, (80 * 0.003) / 0.997);
  close(r.delivered, 80 + r.transportCost);
  close(r.gross, 6);
  close(r.netMargin, 86 - r.delivered);
  assert.equal(r.status, "ESTIMATED", "fuel methodology is estimated");
  assert.equal(r.provisional, true);
  assert.equal(r.availability, "unknown");
});

test("HU→RS→BG reverse: reverse capacity, FGSZ volume fee, no fuel", () => {
  const route = ROUTES.find((r) => r.id === "hu-rs-bg");
  const r = computeRoute(route, day, { origin: p(85), destination: p(79) }, fx);
  const cap = (1326.48 * 0.006 * 1000) / 24 / 385 + 18.4 / 24 + 16.2 / 24 + 1.0166;
  close(r.capacityCost, cap);
  close(r.otherFees, 29.22 / 385 + 0.1072 - 0.0101);
  assert.equal(r.fuelCost, 0);
  assert.equal(r.status, "VERIFIED");
  assert.ok(r.netMargin < 0);
});

test("delivery dates are never mixed and missing prices make the route unavailable", () => {
  const route = ROUTES.find((r) => r.id === "bg-rs-hu");
  const r = computeRoute(route, day, { origin: p(80), destination: p(86, true, "2026-11-25") }, fx);
  assert.equal(r.destination, null);
  assert.equal(r.netMargin, null);
  assert.equal(r.status, "UNAVAILABLE");
  const kal = computeRoute(
    ROUTES.find((x) => x.id === "bg-rs-kalotina"),
    day,
    { origin: null, destination: null },
    fx,
  );
  assert.equal(kal.delivered, null);
  assert.equal(kal.status, "UNAVAILABLE");
});

test("delivered-into-Serbia routes and summary sentences", () => {
  const all = computeAll(day, { BGH: [p(80)], CEEGEX: [p(86)] }, fx);
  const kal = all.find((r) => r.route.id === "bg-rs-kalotina");
  close(kal.delivered, 80 + 1.0265 + 0.1072 - 0.0101 + 83.1 / 117.2);
  const lines = arbitrageSentences(computeAll(day, { BGH: [p(80)], CEEGEX: [p(90)] }, fx));
  assert.ok(
    lines.some((l) => l.startsWith("Arbitrage (indicative")),
    "BG→HU margin above €1 is flagged",
  );
  assert.ok(lines.some((l) => /^Cheapest gas delivered into Serbia for 2026-11-26: /.test(l)));
  const none = arbitrageSentences(computeAll(day, { BGH: [p(85)], CEEGEX: [p(85.5)] }, fx));
  assert.ok(!none.some((l) => l.startsWith("Arbitrage")), "no signal below the threshold");
});

test("BNR crosses: EUR/HUF uses the 100-HUF multiplier; newest fixing on or before the day", async () => {
  const { parseBnrCrosses } = await import("../src/lib/gas/tariffs/fx.ts");
  const xml = `<DataSet><Body>
    <Cube date="2026-11-24"><Rate currency="EUR">5.0900</Rate><Rate currency="HUF" multiplier="100">1.3220</Rate><Rate currency="RSD">0.0434</Rate></Cube>
    <Cube date="2026-11-25"><Rate currency="EUR">5.1000</Rate><Rate currency="HUF" multiplier="100">1.3300</Rate><Rate currency="RSD">0.0435</Rate></Cube>
  </Body></DataSet>`;
  const fx = parseBnrCrosses(xml, "2026-11-24");
  assert.equal(fx.date, "2026-11-24");
  close(fx.hufPerEur, 5.09 / 0.01322);
  close(fx.rsdPerEur, 5.09 / 0.0434);
  assert.equal(parseBnrCrosses(xml, "2026-11-01"), null);
});
