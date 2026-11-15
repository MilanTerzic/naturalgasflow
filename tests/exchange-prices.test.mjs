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
import { parseBghHome, previousWeekday } from "../src/lib/prices/exchanges/bgh.ts";
import { brmFieldMap, parseBnrRates, parseBrm, rateFor } from "../src/lib/prices/exchanges/brm.ts";
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

test("BGH: empty server table → no prices; EUR rows parsed; BGN table rejected", () => {
  const empty = `<table><tr><th>Gas day</th><th>Traded Volume (MWh/d)</th><th>Trades</th><th>VWAP (EUR/MWh)</th><th>VWAP Relative(%)</th><th>Reference Price / BGHSPOTIndex(EUR/MWh)</th></tr></table>`;
  assert.equal(parseBghHome(empty, ctx).observations.length, 0);
  const full = empty.replace(
    "</table>",
    `<tr><td>16.11.2026</td><td>4 200</td><td>9</td><td>45,10</td><td>1,2</td><td>45,05</td></tr><tr><td>15.11.2026</td><td>120</td><td>2</td><td>44,00</td><td>-</td><td></td></tr></table>`,
  );
  const r = parseBghHome(full, ctx);
  assert.deepEqual(
    r.observations.map((o) => [o.deliveryDate, o.metric, o.priceEurMwh]),
    [
      ["2026-11-16", "VWAP", 45.1],
      ["2026-11-16", "BGHSPOT", 45.05],
      ["2026-11-15", "VWAP", 44],
    ],
  ); // 15th: below liquidity rule → BGHSPOT blank, not invented
  assert.equal(r.observations[0].tradingDate, "2026-11-13"); // Monday delivery traded Friday
  assert.equal(previousWeekday("2026-11-17"), "2026-11-16");
  assert.equal(parseBghHome(full.replace(/EUR/g, "BGN"), ctx).observations.length, 0);
});

// ------------------------------------------------------------------ BRM

const bnrXml = `<DataSet><Body><Cube date="2026-11-12"><Rate currency="EUR">5.0812</Rate></Cube>
<Cube date="2026-11-13"><Rate currency="USD">4.40</Rate><Rate currency="EUR">5.0850</Rate></Cube></Body></DataSet>`;

test("BRM: RON converted with the BNR fixing of the trading day; original kept", () => {
  const rates = parseBnrRates(bnrXml);
  assert.equal(rates.get("2026-11-13"), 5.085);
  assert.deepEqual(rateFor(rates, "2026-11-15"), { rate: 5.085, date: "2026-11-13" }); // weekend → Friday
  assert.equal(rateFor(rates, "2026-11-30"), null); // too far from any fixing
  const recs = [
    {
      quoteDate: "2026-11-13T00:00:00",
      deliveryDate: "2026-11-14",
      weightedAveragePrice: 470.25,
      quantity: 12000,
      trades: 18,
    },
    {
      quoteDate: "2026-11-13T00:00:00",
      deliveryDate: "2026-11-15",
      weightedAveragePrice: "-",
      quantity: 0,
      trades: 0,
    },
  ];
  const r = parseBrm(recs, { metric: "VWAP", ...ctx, rates });
  assert.equal(r.status, "OK");
  assert.equal(r.observations.length, 1);
  const o = r.observations[0];
  assert.equal(o.originalPrice, 470.25);
  assert.equal(o.originalCurrency, "RON");
  assert.equal(o.fxRate, 5.085);
  assert.equal(o.priceEurMwh, +(470.25 / 5.085).toFixed(3));
  assert.equal(o.deliveryDate, "2026-11-14");
});

test("BRM: EUR stated → no conversion; unknown currency rejected; unknown JSON → PARSE_ERROR", () => {
  const rates = parseBnrRates(bnrXml);
  const eur = parseBrm(
    [
      {
        quoteDate: "2026-11-13",
        deliveryDate: "2026-11-14",
        price: 93.1,
        quantity: 10,
        currency: "EUR",
      },
    ],
    { metric: "VWAP", ...ctx, rates },
  );
  assert.equal(eur.observations[0].priceEurMwh, 93.1);
  assert.equal(eur.observations[0].fxRate, null);
  const usd = parseBrm(
    [
      {
        quoteDate: "2026-11-13",
        deliveryDate: "2026-11-14",
        price: 93.1,
        quantity: 10,
        currency: "USD",
      },
    ],
    { metric: "VWAP", ...ctx, rates },
  );
  assert.equal(usd.observations.length, 0);
  const changed = parseBrm([{ foo: 1, bar: "x" }], { metric: "VWAP", ...ctx, rates });
  assert.equal(changed.status, "PARSE_ERROR");
  assert.match(changed.message, /foo/);
  // No delivery day in the record → never assume trading day = delivery day.
  const noDelivery = parseBrm([{ quoteDate: "2026-11-13", price: 470, quantity: 5 }], {
    metric: "VWAP",
    ...ctx,
    rates,
  });
  assert.equal(noDelivery.status, "PARSE_ERROR");
  assert.equal(noDelivery.observations.length, 0);
  assert.equal(
    brmFieldMap([{ quoteDate: 1, minPrice: 1, weightedAveragePrice: 2 }]).price,
    "weightedaverageprice",
  );
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
