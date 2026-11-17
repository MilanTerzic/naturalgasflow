// Exchange price providers (BGH, CEEGEX, HEnEx, BRM).
// Fixtures are SYNTHETIC: built to each source's published column layout (HEnEx DOL
// content documentation, CEEGEX daily-data labels, BGH table headers). They are not
// captured live responses — the build environment cannot reach the exchanges. Replace
// them with captured files once `bun run prices:refresh --json` has run where the
// sources are reachable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  addDays,
  benchmarkSeries,
  dedupeObservations,
  expectedTradingDate,
  findDate,
  localNow,
  MARKET_META,
  parseNum,
} from "../src/lib/prices/exchanges/types.ts";
import { readXlsx } from "../src/lib/prices/exchanges/xlsx.ts";
import { setRetryBaseDelay } from "../src/lib/prices/exchanges/http.ts";
setRetryBaseDelay(1);
import {
  fetchHenex,
  henexFileUrl,
  parseHenexDol,
  parseHenexListing,
} from "../src/lib/prices/exchanges/henex.ts";
import { ceegexProduct, parseCeegexDaily } from "../src/lib/prices/exchanges/ceegex.ts";
import {
  fetchBgh,
  parseBghDa,
  parseBghPage,
  previousWeekday,
} from "../src/lib/prices/exchanges/bgh.ts";
import {
  brmDaDelivery,
  parseBnrRates,
  parseBrm,
  rateFor,
} from "../src/lib/prices/exchanges/brm.ts";
import { henexDatesToFetch, runProvider, summarise } from "../src/lib/prices/exchanges/run.ts";
import { fromRow, toRow } from "../src/lib/prices/exchanges/store.server.ts";
import { ExchangeDetail } from "../src/components/region/ExchangeDetail.tsx";

const ctx = { sourceUrl: "https://example.test/src", fetchedAt: "2026-11-15T18:00:00.000Z" };
const fixture = (name) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

// ------------------------------------------------------------------ numbers and dates

test("numbers: dashes, blanks and text are null, never zero", () => {
  for (const v of ["-", "—", "", "  ", "n/a", null, undefined, "abc"])
    assert.equal(parseNum(v), null);
  assert.equal(parseNum("1.234,56"), 1234.56);
  assert.equal(parseNum("1,234.56"), 1234.56);
  assert.equal(parseNum("34,5"), 34.5);
  assert.equal(parseNum("92.335 €/MWh"), 92.335);
  assert.equal(parseNum(0), 0);
  assert.equal(parseNum("1,250"), 1250);
  assert.equal(parseNum("92,410", "decimal"), 92.41);
});

test("dates: exchange formats, invalid days rejected", () => {
  assert.equal(findDate("GDA 14/11/2026"), "2026-11-14");
  assert.equal(findDate("2026.11.14."), "2026-11-14");
  assert.equal(findDate("20261114_NGAS"), "2026-11-14");
  assert.equal(findDate("14-Nov-26"), "2026-11-14");
  assert.equal(findDate("31/02/2026"), null);
  assert.equal(findDate("Day Ahead"), null);
});

test("DST: local dates and publication cut-off are correct across the October change", () => {
  // 25 Oct 2026, clocks go back at 01:00 UTC. Athens is UTC+3 before, UTC+2 after.
  assert.deepEqual(localNow("Europe/Athens", new Date("2026-10-25T00:30:00Z")), {
    date: "2026-10-25",
    time: "03:30",
  });
  assert.deepEqual(localNow("Europe/Athens", new Date("2026-10-25T01:30:00Z")), {
    date: "2026-10-25",
    time: "03:30",
  });
  // HEnEx publishes after 19:15 Athens. 17:10 UTC = 19:10 EET → still yesterday.
  assert.equal(
    expectedTradingDate(MARKET_META.HENEX, new Date("2026-10-26T17:10:00Z")),
    "2026-10-25",
  );
  assert.equal(
    expectedTradingDate(MARKET_META.HENEX, new Date("2026-10-26T17:20:00Z")),
    "2026-10-26",
  );
  // Summer time: 19:15 EEST = 16:15 UTC.
  assert.equal(
    expectedTradingDate(MARKET_META.HENEX, new Date("2026-07-01T16:20:00Z")),
    "2026-07-01",
  );
  assert.equal(addDays("2026-03-28", 2), "2026-03-30"); // spring DST weekend
});

// ------------------------------------------------------------------ HEnEx

test("HEnEx: reads DOL_NGAS by column name; HGSIDA → next gas day; HGSIWD ignored", async () => {
  const wb = await readXlsx(fixture("synthetic-henex-dol-20261113.xlsx"));
  assert.ok(wb.sheetNames.includes("DOL_NGAS"));
  const r = parseHenexDol(wb.sheets, { tradingDate: "2026-11-13", ...ctx, version: "v01" });
  assert.equal(r.status, "OK");
  const idx = r.observations.find((o) => o.metric === "HGSIDA");
  assert.equal(idx.priceEurMwh, 40.611);
  assert.equal(idx.deliveryDate, "2026-11-14");
  assert.equal(idx.tradingDate, "2026-11-13");
  const vwaps = r.observations.filter((o) => o.metric === "VWAP");
  assert.deepEqual(vwaps.map((o) => o.deliveryDate).sort(), ["2026-11-14", "2026-11-15"]);
  assert.equal(vwaps.find((o) => o.deliveryDate === "2026-11-14").volumeMwh, 12400);
  assert.ok(
    !r.observations.some((o) => o.priceEurMwh === 39.288 || o.priceEurMwh === 39.21),
    "within-day values must not appear",
  );
  assert.ok(!r.observations.some((o) => o.priceEurMwh === 40.95), "closing price is not HGSIDA");
});

test("HEnEx: no trades → NO_TRADES and no price; changed layout → PARSE_ERROR", async () => {
  const wb = await readXlsx(fixture("synthetic-henex-dol-notrades.xlsx"));
  const r = parseHenexDol(wb.sheets, { tradingDate: "2026-11-13", ...ctx, version: "v01" });
  assert.equal(r.status, "NO_TRADES");
  assert.equal(r.observations.length, 0);
  assert.equal(
    parseHenexDol({ Sheet1: [["a"]] }, { tradingDate: "2026-11-13", ...ctx, version: "v01" })
      .status,
    "PARSE_ERROR",
  );
  const noIndex = {
    DOL_NGAS: [
      ["Trade Date", "Trading Series", "Contract", "VWAP (€/MWh)"],
      ["13/11/2026", "Day Ahead", "x", "40"],
    ],
  };
  assert.equal(
    parseHenexDol(noIndex, { tradingDate: "2026-11-13", ...ctx, version: "v01" }).status,
    "PARSE_ERROR",
  );
});

test("HEnEx: listing finds the highest version; direct URL follows the documented pattern", () => {
  const html = `
    <a href="/c/document_library/get_file?uuid=aaa&amp;groupId=20126">x</a> 20261113_NGAS_DOL_EN_v01
    <a href="/c/document_library/get_file?uuid=bbb&amp;groupId=20126">x</a> 20261113_NGAS_DOL_EN_v02`;
  const m = parseHenexListing(html);
  assert.equal(m.get("2026-11-13").version, 2);
  assert.equal(
    m.get("2026-11-13").url,
    "https://www.enexgroup.gr/c/document_library/get_file?uuid=bbb&groupId=20126",
  );
  assert.equal(
    henexFileUrl("2026-11-13"),
    "https://www.enexgroup.gr/documents/20126/997118/20261113_NGAS_DOL_EN_v01.xlsx",
  );
});

test("HEnEx: missing file → NOT_PUBLISHED; older file still read (mocked fetch)", async () => {
  const orig = globalThis.fetch;
  const bytes = fixture("synthetic-henex-dol-20261113.xlsx");
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("20261113_NGAS")) return new Response(bytes, { status: 200 });
    return new Response("", { status: 404 });
  };
  try {
    const r = await fetchHenex(["2026-11-14", "2026-11-13"]);
    assert.equal(r.status, "OK");
    assert.ok(r.observations.some((o) => o.metric === "HGSIDA" && o.deliveryDate === "2026-11-14"));
    const none = await fetchHenex(["2026-11-14"]);
    assert.equal(none.status, "NOT_PUBLISHED");
    assert.equal(none.observations.length, 0);
  } finally {
    globalThis.fetch = orig;
  }
});

test("HEnEx backfill: newest expected day first, then missing days, capped per run", () => {
  const at = new Date("2026-11-15T18:00:00Z"); // 20:00 Athens → today expected
  const stored = new Set(["2026-11-14", "2026-11-13"]);
  const dates = henexDatesToFetch(stored, at);
  assert.equal(dates[0], "2026-11-15");
  assert.ok(!dates.includes("2026-11-14"));
  assert.equal(dates.length, 8);
});

// ------------------------------------------------------------------ CEEGEX

const ceegexHtml = `
<table><thead><tr><th>Trading Day</th><th>Contract</th><th>Start of Delivery</th><th>End of Delivery</th>
<th>Traded Volume (MWh)</th><th>Number of Trades</th><th>Volume Weighted Average Price (EUR/MWh)</th><th>CEEREP</th><th>CEEREP Change (%)</th></tr></thead>
<tbody>
<tr><td>2026.11.13.</td><td>DA</td><td>2026.11.14.</td><td>2026.11.14.</td><td>1 250</td><td>14</td><td>92,410</td><td>92,500</td><td>0,4</td></tr>
<tr><td>2026.11.13.</td><td>W/END</td><td>2026.11.14.</td><td>2026.11.15.</td><td>600</td><td>3</td><td>91,900</td><td>-</td><td>-</td></tr>
<tr><td>2026.11.13.</td><td>Sunday</td><td>2026.11.15.</td><td>2026.11.15.</td><td>-</td><td>0</td><td>-</td><td>92,100</td><td>-</td></tr>
<tr><td>2026.11.13.</td><td>Within Day</td><td>2026.11.13.</td><td>2026.11.13.</td><td>300</td><td>5</td><td>93,000</td><td>-</td><td>-</td></tr>
</tbody></table>`;

test("CEEGEX: VWAP and CEEREP kept separate; delivery from columns; dashes stay empty", () => {
  const r = parseCeegexDaily(ceegexHtml, ctx);
  assert.equal(r.status, "OK");
  const da = r.observations.filter((o) => o.product === "DA");
  assert.deepEqual(da.map((o) => [o.metric, o.priceEurMwh]).sort(), [
    ["CEEREP", 92.5],
    ["VWAP", 92.41],
  ]);
  assert.equal(da[0].deliveryDate, "2026-11-14");
  assert.equal(da[0].tradingDate, "2026-11-13");
  const we = r.observations.find((o) => o.product === "WE");
  assert.equal(we.deliveryEndDate, "2026-11-15");
  assert.equal(we.metric, "VWAP"); // CEEREP "-" → no observation
  const sun = r.observations.filter((o) => o.product === "SUN");
  assert.deepEqual(
    sun.map((o) => o.metric),
    ["CEEREP"],
  ); // 0 trades → no VWAP
  assert.ok(!r.observations.some((o) => o.priceEurMwh === 93));
  assert.equal(ceegexProduct("Within Day"), null);
});

test("CEEGEX: script-rendered page or renamed columns → PARSE_ERROR", () => {
  assert.equal(parseCeegexDaily("<div id='app'></div>", ctx).status, "PARSE_ERROR");
  assert.equal(
    parseCeegexDaily("<table><tr><th>Day</th><th>Price</th></tr></table>", ctx).status,
    "PARSE_ERROR",
  );
});

test("benchmark: preferred metric per day, weekend spread without double counting volume", () => {
  const r = parseCeegexDaily(ceegexHtml, ctx);
  const s = benchmarkSeries(r.observations, MARKET_META.CEEGEX.benchmarks);
  assert.deepEqual(
    s.map((p) => [p.deliveryDate, p.metric, p.price]),
    [
      ["2026-11-14", "CEEREP", 92.5],
      ["2026-11-15", "CEEREP", 92.1],
    ],
  );
  const vwapOnly = benchmarkSeries(
    r.observations.filter((o) => o.metric === "VWAP"),
    ["VWAP"],
  );
  // 14th: single-day DA wins over the weekend contract; 15th: weekend contract, volume not repeated.
  assert.equal(vwapOnly.find((p) => p.deliveryDate === "2026-11-14").product, "DA");
  const sunday = vwapOnly.find((p) => p.deliveryDate === "2026-11-15");
  assert.equal(sunday.product, "WE");
  assert.equal(sunday.volumeMwh, null);
});

// ------------------------------------------------------------------ BGH

// BGH fixtures below are REAL: captured from www.balkangashub.bg/public on 2026-11-17
// 15:58 CET in a browser (page excerpt + the page's own spotMarketData responses).
const bghFixture = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

test("BGH page: DA tab active, data request found, no zone selector", () => {
  const info = parseBghPage(bghFixture("bgh-public-page-20261117.html"));
  assert.equal(info.activeTab, "DA");
  assert.deepEqual(info.tabs, ["WD", "DA", "WEEK", "MONTH", "QUARTER"]);
  assert.equal(info.dataUrl, "https://www.balkangashub.bg/ajax/spotMarketData");
  assert.equal(info.csrf, "TEST_CSRF_TOKEN");
  assert.deepEqual(info.holidays, ["2026-12-24", "2026-12-25", "2026-12-28"]);
  assert.throws(() => parseBghPage("<html>maintenance</html>"), /page changed/);
  assert.throws(
    () =>
      parseBghPage(
        bghFixture("bgh-public-page-20261117.html") +
          `<select name="zone"><option>VTP Bulgaria</option></select>`,
      ),
    /zone selector/,
  );
});

test("BGH DA: matches 5+ official rows exactly; provisional and index kept apart", () => {
  const json = JSON.parse(bghFixture("bgh-da-20261117.json"));
  const r = parseBghDa(json, { ...ctx, today: "2026-11-17" });
  const vwap = r.observations.filter((o) => o.metric === "VWAP");
  // Values as displayed on the BGH Day Ahead table, 2026-11-17.
  assert.deepEqual(
    vwap.map((o) => [o.deliveryDate, o.priceEurMwh, o.volumeMwh, o.trades]),
    [
      ["2026-11-17", 79.99, 32586, 137],
      ["2026-11-16", 82.08, 59068, 209],
      ["2026-11-15", 80.9, 58249, 223],
      ["2026-11-14", 80.91, 58749, 224],
      ["2026-11-13", 80.43, 50744, 243],
      ["2026-11-12", 77.1, 53637, 222],
    ],
  );
  assert.ok(vwap.every((o) => o.product === "DA" && o.originalCurrency === "EUR"));
  // Gas day 18th is still trading at capture time → not published as a price.
  assert.deepEqual(r.provisionalDays, ["2026-11-18"]);
  // Once BGH publishes the reference price, the next-day VWAP is final (77.01 is a
  // synthetic stand-in for the not-yet-published index).
  const closed = json.map((row) =>
    row.day === "2026-11-18" ? { ...row, reference_price: "77.01" } : row,
  );
  const r2 = parseBghDa(closed, { ...ctx, today: "2026-11-17" });
  assert.equal(r2.observations.find((o) => o.deliveryDate === "2026-11-18").priceEurMwh, 76.98);
  // BGHSPOTIndex is a separate metric (80.93 vs VWAP 80.90 on the 15th).
  const idx = r.observations.find((o) => o.metric === "BGHSPOT" && o.deliveryDate === "2026-11-15");
  assert.equal(idx.priceEurMwh, 80.93);
  // Only VWAP is the map benchmark.
  const series = benchmarkSeries(r.observations, MARKET_META.BGH.benchmarks);
  assert.equal(series.at(-1).price, 79.99);
  assert.ok(series.every((p) => p.metric === "VWAP"));
  assert.equal(vwap[0].tradingDate, "2026-11-16"); // derived, previous weekday
  assert.equal(previousWeekday("2026-11-16"), "2026-11-13");
});

test("BGH DA: no-trade rows ('-') stay empty, never zero; non-EUR rejected", () => {
  const wd = JSON.parse(bghFixture("bgh-wd-20261117.json"));
  const r = parseBghDa(wd, { ...ctx, today: "2026-11-17" });
  assert.deepEqual(r.noTradeDays, ["2026-11-18"]);
  const bgn = parseBghDa(
    [{ day: "2026-11-10", volume: 10, trades_cnt: 3, vwa_price: "150", currency: "BGN" }],
    {
      ...ctx,
      today: "2026-11-17",
    },
  );
  assert.equal(bgn.observations.length, 0);
  assert.throws(() => parseBghDa({ error: "x" }, { ...ctx, today: "2026-11-17" }), /not a list/);
});

test("BGH fetch: replays the page request with type=DA and CSRF", async () => {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (!init.method)
      return new Response(bghFixture("bgh-public-page-20261117.html"), {
        status: 200,
        headers: { "set-cookie": "XSRF-TOKEN=abc%3D; path=/" },
      });
    return new Response(bghFixture("bgh-da-20261117.json"), { status: 200 });
  };
  try {
    const res = await fetchBgh(new Date("2026-11-17T15:00:00Z"));
    assert.equal(res.status, "OK");
    const post = calls[1];
    const body = new URLSearchParams(post.init.body);
    assert.equal(body.get("type"), "DA");
    assert.equal(body.get("currency"), "EUR");
    assert.equal(post.init.headers["x-csrf-token"], "TEST_CSRF_TOKEN");
    assert.equal(post.init.headers["x-xsrf-token"], "abc=");
    assert.equal(res.diagnostics.activeTabOnPage, "DA");
  } finally {
    globalThis.fetch = orig;
  }
});

// ------------------------------------------------------------------ BRM
// BRM/BNR fixtures are REAL: dayaheadgas.brm.ro/gassstats/quotes (fields used by the page
// kept, others dropped) and curs.bnr.ro/nbrfxrates10days.xml (EUR/USD/HUF kept), both
// captured 2026-11-17. Expected values are those shown in BRM's on-screen "Cotații" table.

const brmQuotes = () => JSON.parse(bghFixture("brm-quotes-20261117.json"));
const bnrRates = () => parseBnrRates(bghFixture("bnr-10days-20261117.xml"));

test("BNR: rates from curs.bnr.ro; no same-day rate on a business day → wait", () => {
  const rates = bnrRates();
  assert.equal(rates.get("2026-11-17"), 5.3485);
  assert.equal(rates.size, 10);
  assert.deepEqual(rateFor(rates, "2026-11-15"), { rate: 5.3498, date: "2026-11-13" }); // Sunday
  assert.deepEqual(rateFor(rates, "2026-11-14"), { rate: 5.3498, date: "2026-11-13" }); // Saturday
  assert.equal(rateFor(rates, "2026-11-18"), null); // Wednesday rate not out yet
  assert.equal(rateFor(new Map(), "2026-11-17"), null);
});

test("BRM DA: Day-Ahead ring only, matches BRM's table, converted at the trading-day BNR rate", () => {
  const r = parseBrm(brmQuotes(), { ...ctx, rates: bnrRates() });
  const vwap = r.observations.filter((o) => o.metric === "VWAP");
  assert.deepEqual(
    vwap.map((o) => [o.tradingDate, o.deliveryDate, o.originalPrice, o.volumeMwh, o.trades]),
    [
      ["2026-11-17", "2026-11-18", 417.219277, 62211, 160],
      ["2026-11-16", "2026-11-17", 427.743535, 59528, 158],
      ["2026-11-15", "2026-11-16", 444.188101, 16725, 26],
      ["2026-11-14", "2026-11-15", 447.159278, 97, 3],
      ["2026-11-12", "2026-11-13", 438.450136, 75863, 196],
      ["2026-11-11", "2026-11-12", 423.585339, 80518, 161],
    ],
  );
  assert.ok(vwap.every((o) => o.product === "DA" && o.originalCurrency === "RON"));
  const d18 = vwap[0];
  assert.equal(d18.fxRate, 5.3485);
  assert.equal(d18.fxDate, "2026-11-17");
  assert.equal(d18.priceEurMwh, +(417.219277 / 5.3485).toFixed(3)); // 78.007
  assert.equal(vwap[2].fxDate, "2026-11-13"); // Sunday trade → Friday fixing
  // 14 Nov DA had no trades (BRM shows N/A) → no price; weekend product NOT substituted.
  assert.deepEqual(r.noTradeDays, ["2026-11-14"]);
  assert.ok(!r.observations.some((o) => o.deliveryDate === "2026-11-14" && o.metric === "VWAP"));
  // Global PMP kept separate (16 Nov: 443.69893 vs DA 444.188101).
  const g = r.observations.find(
    (o) => o.metric === "PMP_GLOBAL" && o.deliveryDate === "2026-11-16",
  );
  assert.equal(g.originalPrice, 443.69893);
  const series = benchmarkSeries(r.observations, MARKET_META.BRM.benchmarks);
  assert.ok(series.every((p) => p.metric === "VWAP"));
  assert.equal(series.at(-1).deliveryDate, "2026-11-18");
});

test("BRM DA: product name is the only delivery source; bad shapes rejected", () => {
  assert.equal(brmDaDelivery("BRMGAS_DA18_M11_2026"), "2026-11-18");
  assert.equal(brmDaDelivery("BRMGAS_DA31_M02_2026"), null);
  assert.equal(brmDaDelivery("BRMWK_14-11-2026"), null);
  const rates = bnrRates();
  // FX not out yet → waits, never uses an older rate on a business day
  const pending = parseBrm(brmQuotes(), { ...ctx, rates: new Map([["2026-11-16", 5.3494]]) });
  assert.ok(pending.pendingFx.includes("2026-11-18"));
  const eur = parseBrm([{ ...brmQuotes()[0], currencyCode: "EUR" }], { ...ctx, rates });
  assert.equal(eur.observations.length, 0);
  assert.throws(() => parseBrm({ error: 1 }, { ...ctx, rates }), /not a list/);
});

// ------------------------------------------------------------------ store, summary, isolation

test("dedupe/upsert key: one row per market/product/metric/trading/delivery; newer version wins", () => {
  const base = {
    market: "HENEX",
    country: "GR",
    tradingDate: "2026-11-13",
    deliveryDate: "2026-11-14",
    product: "DA",
    metric: "HGSIDA",
    volumeMwh: null,
    trades: null,
    sourceUrl: "u",
    status: "OK",
  };
  const out = dedupeObservations([
    { ...base, priceEurMwh: 40, fetchedAt: "2026-11-14T08:00:00Z", sourceVersion: "v01" },
    { ...base, priceEurMwh: 40.2, fetchedAt: "2026-11-14T07:00:00Z", sourceVersion: "v02" },
    { ...base, priceEurMwh: 40, fetchedAt: "2026-11-14T09:00:00Z", sourceVersion: "v01" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].priceEurMwh, 40.2);
  const row = toRow(out[0]);
  assert.equal(row.trading_date, "2026-11-13");
  assert.deepEqual(fromRow({ ...row, price_eur_mwh: "40.2000" }).priceEurMwh, 40.2);
});

test("summary: change only vs same metric; stale when behind schedule; status of failed fetch", () => {
  const mk = (d, metric, p) => ({
    market: "HENEX",
    country: "GR",
    tradingDate: addDays(d, -1),
    deliveryDate: d,
    product: "DA",
    metric,
    priceEurMwh: p,
    volumeMwh: null,
    trades: null,
    sourceUrl: "u",
    fetchedAt: "x",
    status: "OK",
  });
  const obs = [
    mk("2026-11-13", "HGSIDA", 40),
    mk("2026-11-14", "VWAP", 41),
    mk("2026-11-15", "HGSIDA", 42),
  ];
  const at = new Date("2026-11-15T10:00:00Z");
  const s = summarise("HENEX", obs, { status: "OK", at: "t", lastSuccessAt: "t" }, at);
  assert.equal(s.latest.price, 42);
  assert.equal(s.previous.price, 40); // VWAP day skipped: not comparable
  assert.equal(s.change, 2);
  assert.equal(s.status, "OK");
  const old = summarise(
    "HENEX",
    [mk("2026-11-05", "HGSIDA", 40)],
    { status: "OK", at: "t", lastSuccessAt: "t" },
    at,
  );
  assert.equal(old.status, "STALE");
  const failed = summarise(
    "HENEX",
    obs,
    { status: "SOURCE_UNAVAILABLE", at: "t", lastSuccessAt: "t" },
    at,
  );
  assert.equal(failed.status, "STALE"); // keeps showing the last verified price, marked stale
  const none = summarise(
    "BGH",
    [],
    { status: "LICENCE_REQUIRED", message: "registration", at: "t", lastSuccessAt: null },
    at,
  );
  assert.equal(none.latest, null);
  assert.equal(none.status, "LICENCE_REQUIRED");
});

test("providers are isolated: a throwing fetch yields a status, not an exception", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const results = await Promise.all(["BGH", "CEEGEX", "HENEX", "BRM"].map((m) => runProvider(m)));
    for (const r of results) {
      assert.equal(r.observations.length, 0);
      assert.ok(
        ["SOURCE_UNAVAILABLE", "PARSE_ERROR"].includes(r.status),
        `${r.market}: ${r.status}`,
      );
    }
  } finally {
    globalThis.fetch = orig;
  }
});

// ------------------------------------------------------------------ frontend

test("UI detail line shows metric, delivery day, change, volume, FX and freshness", () => {
  const ex = {
    market: "BRM",
    status: "OK",
    fetchStatus: "OK",
    latest: {
      deliveryDate: "2026-11-14",
      tradingDate: "2026-11-13",
      product: "GLOBAL",
      metric: "PMP_GLOBAL",
      price: 92.48,
      volumeMwh: 12000,
      trades: 18,
      originalPrice: 470.25,
      originalCurrency: "RON",
      fxRate: 5.085,
      multiDay: false,
    },
    previous: null,
    change: -1.25,
    series: [],
    lastAttemptAt: "2026-11-15T15:00:00Z",
    lastSuccessAt: "2026-11-15T15:00:00Z",
    sourcePage: "https://brm.ro/PIATA-SPOT-GN/",
    sourceUrl: null,
  };
  const html = renderToStaticMarkup(React.createElement(ExchangeDetail, { ex }));
  assert.match(html, /PMP_GLOBAL/);
  assert.match(html, /delivery 2026-11-14/);
  assert.match(html, /traded 2026-11-13/);
  assert.match(html, /▼1\.25/);
  assert.match(html, /12,000 MWh/);
  assert.match(html, /470\.25 RON\/MWh @ 5\.0850/);
  assert.match(html, /OK/);
  const blocked = renderToStaticMarkup(
    React.createElement(ExchangeDetail, {
      ex: {
        ...ex,
        latest: null,
        change: null,
        status: "LICENCE_REQUIRED",
        message: "Needs BGH API agreement",
        lastSuccessAt: null,
      },
    }),
  );
  assert.match(blocked, /access needed/);
  assert.match(blocked, /Needs BGH API agreement/);
  assert.match(blocked, /last success never/);
});
