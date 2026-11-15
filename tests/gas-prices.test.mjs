import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCeghDayAhead, parseDate, parseEexNgpCsv } from "../src/lib/prices/parsers.ts";

test("dates in the common exchange formats", () => {
  assert.equal(parseDate("2026-11-14"), "2026-11-14");
  assert.equal(parseDate("14.11.2026"), "2026-11-14");
  assert.equal(parseDate("4/11/2026"), "2026-11-04");
  assert.equal(parseDate("Monday"), null);
});

test("EEX NGP csv: finds delivery-day and price columns, ignores volume and junk", () => {
  const csv = [
    "EEX Neutral Gas Price TTF",
    "Delivery Day;Volume (MWh);TTF NGP (EUR/MWh)",
    "13.11.2026;1.250.000;88,415",
    "14.11.2026;980.000;89,102",
    "15.11.2026;;",
  ].join("\n");
  const out = parseEexNgpCsv(csv, true);
  assert.deepEqual(
    out.map((p) => [p.date, p.price]),
    [
      ["2026-11-13", 88.415],
      ["2026-11-14", 89.102],
    ],
  );
  assert.equal(out[0].final, true);
});

test("EEX NGP csv with an unknown header returns nothing instead of guessing", () => {
  assert.deepEqual(parseEexNgpCsv("a,b,c\n2026-11-14,1,2\n", true), []);
  assert.deepEqual(parseEexNgpCsv("", true), []);
});

test("CEGH homepage day-ahead table", () => {
  const html = `<h3>DAY AHEAD MARKET</h3><table><tr><th>Trading Day</th><th>Contract</th><th>VWAP / CEGHIX<br>€/MWh</th></tr>
    <tr><td>15.11.</td><td>Monday</td><td>92.335</td></tr>
    <tr><td>15.11.</td><td>Sunday</td><td>92.344</td></tr>
    <tr><td>14.11.</td><td>Weekend</td><td>93.571</td></tr></table>
    <h3>FUTURES MARKET</h3><table><tr><td>14.11.</td><td>December 2026</td><td>90.100</td></tr></table>`;
  const out = parseCeghDayAhead(html, "2026-11-15");
  assert.deepEqual(
    out.map((p) => [p.date, p.label, p.price]),
    [
      ["2026-11-15", "Monday contract", 92.335],
      ["2026-11-15", "Sunday contract", 92.344],
      ["2026-11-14", "Weekend contract", 93.571],
    ],
  );
  assert.deepEqual(parseCeghDayAhead("<p>maintenance</p>", "2026-11-15"), []);
});

test("CEGH trading day in December read in January belongs to the previous year", () => {
  const html = "DAY AHEAD MARKET <tr><td>31.12.</td><td>Thursday</td><td>40.5</td></tr>";
  assert.equal(parseCeghDayAhead(html, "2027-01-02")[0].date, "2026-12-31");
});
