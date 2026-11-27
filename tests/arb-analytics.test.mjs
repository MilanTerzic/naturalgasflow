import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, mergeDaily, normCdf, quantile } from "../src/lib/gas/arb/series.ts";
import { ema, rsi, sma, bollinger, technicalSignals } from "../src/lib/gas/arb/ta.ts";
import {
  backtest,
  fitAr1,
  forecastEnsemble,
  probAbove,
  ridge,
  runModel,
} from "../src/lib/gas/arb/forecast.ts";
import { buildDrivers, storageGap } from "../src/lib/gas/arb/drivers.ts";
import { proxyDay, spreadHistory, windowStats, monthlyGrid } from "../src/lib/gas/arb/history.ts";
import { monthlyOutlook, addMonths } from "../src/lib/gas/arb/monthly.ts";
import {
  classifyHeader,
  excelSerialToIso,
  parseCsv,
  parseDate,
  parseNumber,
  parsePriceSheet,
} from "../src/lib/gas/arb/import.ts";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const fx = { date: "2026-11-24", hufPerEur: 385, rsdPerEur: 117.2, source: "test" };

// Deterministic pseudo-random normal (mulberry32 + Box–Muller).
function rng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** AR(1) spread around `mu` with persistence `phi`. */
function arSeries(n, mu, phi, sigma, seed = 7) {
  const z = rng(seed);
  const y = [mu];
  for (let i = 1; i < n; i++) y.push(mu + phi * (y[i - 1] - mu) + sigma * z());
  return y;
}

test("series helpers", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  close(normCdf(0), 0.5);
  close(normCdf(1.959964), 0.975, 1e-5);
  close(quantile([1, 2, 3, 4], 0.5), 2.5);
  const m = mergeDaily(
    [{ date: "2026-01-01", price: 30, final: true }],
    [
      { date: "2026-01-01", price: 31, final: false },
      { date: "2026-01-02", price: 32, final: false },
    ],
  );
  assert.equal(m[0].price, 30, "provisional never replaces final");
  assert.equal(m[1].price, 32);
});

test("technical indicators", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(sma(xs, 3).slice(0, 3), [null, null, 2]);
  close(ema(xs, 3)[2], 2);
  close(ema(xs, 3)[3], 3); // 4·0.5 + 2·0.5
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => i))[29], 100, "only gains → RSI 100");
  const b = bollinger(Array(25).fill(5));
  assert.equal(b[24].z, 0);
  const sig = technicalSignals(arSeries(120, 2, 0.8, 0.5));
  assert.ok(sig.length >= 5);
  assert.ok(sig.every((s) => ["up", "down", "neutral"].includes(s.bias)));
});

test("AR(1) fit recovers persistence and mean", () => {
  const y = arSeries(2000, 3, 0.8, 0.5);
  const f = fitAr1(y, 2000);
  assert.ok(Math.abs(f.phi - 0.8) < 0.05, `phi ${f.phi}`);
  assert.ok(Math.abs(f.mu - 3) < 0.3, `mu ${f.mu}`);
});

test("ridge recovers known coefficients", () => {
  const z = rng(3);
  const X = Array.from({ length: 400 }, () => [z(), z()]);
  const y = X.map(([a, b]) => 1 + 2 * a - 0.5 * b + 0.01 * z());
  const r = ridge(X, y, 0.001);
  close(r.intercept, 1, 0.01);
  close(r.coef[0], 2, 0.01);
  close(r.coef[1], -0.5, 0.01);
});

test("mean reversion pulls a stretched spread back towards its mean", () => {
  const y = arSeries(400, 2, 0.8, 0.3);
  y.push(6); // shock far above the mean
  const dates = y.map((_, i) => addDays("2025-01-01", i));
  const m = runModel("meanrev", { dates, y, horizon: 10 });
  assert.equal(m.status, "ok");
  assert.ok(m.path[0].p50 < 6 && m.path[9].p50 < m.path[0].p50);
  assert.ok(m.path[9].hi - m.path[9].lo > m.path[0].hi - m.path[0].lo, "band widens");
  assert.equal(m.path[0].date, addDays(dates[dates.length - 1], 1));
});

test("models flag short history instead of forecasting", () => {
  const y = arSeries(20, 2, 0.8, 0.3);
  const dates = y.map((_, i) => addDays("2025-01-01", i));
  assert.equal(runModel("meanrev", { dates, y, horizon: 5 }).status, "insufficient");
  assert.equal(runModel("fundamental", { dates, y, horizon: 5 }).status, "insufficient");
  assert.equal(runModel("naive", { dates, y, horizon: 5 }).status, "ok");
});

test("ensemble beats the random walk on a mean-reverting series and backtests honestly", () => {
  const y = arSeries(500, 2, 0.6, 0.4, 11);
  const dates = y.map((_, i) => addDays("2024-06-01", i));
  const res = forecastEnsemble({ dates, y, horizon: 7 }, 80);
  assert.equal(res.ensemble.length, 7);
  const ens = res.scores.find((s) => s.id === "ensemble");
  const mr = res.scores.find((s) => s.id === "meanrev");
  assert.ok(mr.skill[6] > 0.1, `mean reversion skill at h=7: ${mr.skill[6]}`);
  assert.ok(ens.skill[6] > 0, `ensemble skill at h=7: ${ens.skill[6]}`);
  assert.equal(res.bandSource, "empirical");
  for (let k = 0; k < 7; k++) {
    const w = ["naive", "meanrev", "trend"].reduce((s, id) => s + res.weights[id][k], 0);
    close(w, 1, 1e-9);
  }
  // Backtest never looks ahead: each origin's history ends before its actuals.
  const bt = backtest({ dates, y, horizon: 3 }, 20);
  bt.starts.forEach((t, o) => assert.deepEqual(bt.actuals[o], y.slice(t, t + 3)));
});

test("fundamental model picks up a weather driver", () => {
  const z = rng(5);
  const n = 400;
  const dates = Array.from({ length: n + 10 }, (_, i) => addDays("2025-01-01", i));
  const temp = new Map(dates.map((d, i) => [d, 10 + 10 * Math.sin(i / 20)]));
  const hddOf = (d) => Math.max(0, 15.5 - temp.get(d));
  const y = [];
  for (let i = 0; i < n; i++) y.push(0.4 * (y[i - 1] ?? 0) + 0.3 * hddOf(dates[i]) + 0.1 * z());
  const { drivers, report } = buildDrivers(dates.slice(0, n), dates.slice(n), {
    temps: { budapest: temp },
  });
  assert.ok(report.find((r) => r.name === "HDD Budapest").used);
  const m = runModel("fundamental", { dates: dates.slice(0, n), y, horizon: 10, drivers });
  assert.equal(m.status, "ok");
  close(m.params["HDD Budapest"], 0.3, 0.05);
  assert.ok(m.contrib.length === drivers.names.length + 1);
});

test("drivers with poor coverage are dropped with a reason", () => {
  const dates = Array.from({ length: 100 }, (_, i) => addDays("2025-01-01", i));
  const sparse = new Map(dates.slice(0, 10).map((d) => [d, 5]));
  const { drivers, report } = buildDrivers(dates, [], { temps: { sofia: sparse } });
  const r = report.find((x) => x.name === "HDD Sofia");
  assert.equal(r.used, false);
  assert.match(r.reason, /covers/);
  assert.equal(drivers, null, "weekend alone is not a fundamental model");
});

test("storage gap against earlier years", () => {
  const fill = new Map([
    ["2024-11-01", 90],
    ["2025-11-01", 80],
    ["2026-11-01", 75],
  ]);
  const g = storageGap(fill, "2026-11-01");
  assert.equal(g.normal, true);
  close(g.gap, 75 - 85);
  assert.deepEqual(storageGap(new Map([["2026-11-01", 70]]), "2026-11-01"), {
    gap: 70,
    normal: false,
  });
});

test("probability of clearing a threshold", () => {
  const pt = { date: "x", p50: 2, lo: 2 - 1.2815515655446004, hi: 2 + 1.2815515655446004 };
  close(probAbove(pt, 2), 0.5, 1e-6);
  close(probAbove(pt, 0), 0.97725, 1e-3);
});

test("history: tariff proxy, spread, windows and streaks", () => {
  assert.equal(proxyDay("2024-01-15"), "2027-01-15");
  assert.equal(proxyDay("2023-10-05"), "2026-10-05");
  assert.equal(proxyDay("2024-02-29"), "2027-02-28");
  assert.equal(proxyDay("2026-12-01"), "2026-12-01");
  const days = ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"];
  const bgh = days.map((d, i) => ({ date: d, price: 30, final: true }));
  const ceegex = days.map((d, i) => ({ date: d, price: [31, 40, 41, 42][i], final: i < 3 }));
  const rows = spreadHistory({ BGH: bgh, CEEGEX: ceegex }, fx);
  assert.equal(rows.length, 4);
  close(rows[1].spread, 10);
  assert.ok(rows[0].costBgHu > 1 && rows[0].costBgHu < 10, `cost ${rows[0].costBgHu}`);
  close(rows[1].netBgHu, 10 - rows[1].costBgHu);
  assert.equal(rows[0].tariffProxy, false);
  assert.equal(rows[3].provisional, true);
  const s = windowStats(rows);
  assert.equal(s.openBgHu, 3);
  assert.equal(s.currentStreakBgHu, 3);
  assert.equal(s.longestStreakBgHu, 3);
  assert.equal(s.openHuBg, 0);
  const grid = monthlyGrid(rows);
  assert.equal(grid.length, 1);
  close(grid[0].shareBgHu, 0.75);
  const old = spreadHistory(
    {
      BGH: [{ date: "2022-06-01", price: 100, final: true }],
      CEEGEX: [{ date: "2022-06-01", price: 110, final: true }],
    },
    fx,
  );
  assert.equal(old[0].tariffProxy, true);
  assert.equal(old[0].crisis, true);
});

test("monthly outlook decays today's deviation towards the seasonal norm", () => {
  assert.equal(addMonths("2026-11", 2), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  const n = 900;
  const y = arSeries(n, 1.5, 0.7, 0.4, 21);
  const start = "2024-05-01";
  const rows = y.map((s, i) => ({
    date: addDays(start, i),
    bgh: 30,
    ceegex: 30 + s,
    ttf: null,
    cegh: null,
    spread: s + (i > n - 25 ? 4 : 0),
    costBgHu: 2,
    costHuBg: 3,
    netBgHu: s - 2,
    netHuBg: -s - 3,
    tariffProxy: false,
    crisis: false,
    provisional: false,
  }));
  const { outlook, note } = monthlyOutlook(rows, { months: 6 });
  assert.equal(outlook.length, 6);
  const dev = (o) => Math.abs(o.p50 - (o.seasonal ?? 1.5));
  assert.ok(dev(outlook[5]) <= dev(outlook[0]) + 1e-9, "deviation fades");
  assert.ok(outlook.every((o) => o.hi > o.lo));
  assert.match(note, /calendar year/);
  assert.equal(monthlyOutlook(rows.slice(0, 10)).outlook.length, 0);
});

test("importer: dates, numbers, headers", () => {
  assert.equal(excelSerialToIso(45658), "2025-01-01");
  assert.equal(parseDate("01.02.2025."), "2025-02-01");
  assert.equal(parseDate("2025-02-01"), "2025-02-01");
  assert.equal(parseDate("31/12/2024"), "2024-12-31");
  assert.equal(parseDate("31.02.2025"), null);
  assert.equal(parseNumber("84,80"), 84.8);
  assert.equal(parseNumber("1.234,56"), 1234.56);
  assert.equal(parseNumber("1,234.56"), 1234.56);
  assert.equal(parseNumber("n/a"), null);
  assert.equal(classifyHeader("BGH DA (EUR/MWh)"), "BGH");
  assert.equal(classifyHeader("CEEGEX HUDEX DA"), "CEEGEX");
  assert.equal(classifyHeader("CEGH VTP"), "CEGH");
  assert.equal(classifyHeader("TTF front month"), "TTF_MA");
  assert.equal(classifyHeader("BGH volume MWh"), null);
  assert.equal(classifyHeader("HU-BG spread"), null);
});

test("importer: whole sheet with title rows, gaps and bad cells", () => {
  const rows = parseCsv(
    [
      "Price history export;;;;",
      "Datum;BGH DA;CEEGEX DA;TTF;BGH volume",
      "01.11.2026;30,50;32,10;31,00;1000",
      "02.11.2026;;32,40;31,20;900",
      "03.11.2026;30,90;abc;31,30;800",
      "03.11.2026;31,00;33,00;31,40;800",
      "bad date;1;2;3;4",
    ].join("\n"),
  );
  const r = parsePriceSheet(rows);
  assert.equal(r.headerRow, 1);
  assert.equal(r.dateColumn, 0);
  assert.deepEqual(
    r.columns.map((c) => c.hub),
    [null, "BGH", "CEEGEX", "TTF", null],
  );
  assert.deepEqual(r.series.BGH, [
    { date: "2026-11-01", price: 30.5 },
    { date: "2026-11-03", price: 31 },
  ]);
  assert.equal(r.series.CEEGEX.length, 3);
  assert.ok(r.rejected >= 2);
  assert.ok(r.issues.some((i) => /duplicate/.test(i)));
});

test("transport cost for a future day matches the route engine", async () => {
  const { transportCost, ROUTE_BG_HU } = await import("../src/lib/gas/arb/history.ts");
  const rows = spreadHistory(
    {
      BGH: [{ date: "2026-12-01", price: 30, final: true }],
      CEEGEX: [{ date: "2026-12-01", price: 35, final: true }],
    },
    fx,
  );
  close(transportCost(ROUTE_BG_HU, "2026-12-01", 30, fx), rows[0].costBgHu);
  assert.equal(
    transportCost(ROUTE_BG_HU, "2026-12-01", 30, null),
    null,
    "no FX → no FGSZ cost → unknown",
  );
});

test("Datascope wide export: column roles, BGN peg, days, weekends, front month", async () => {
  const fs = await import("node:fs");
  const { hubOf } = await import("../src/lib/gas/arb/datascope.ts");
  const header = fs
    .readFileSync(new URL("./fixtures/datascope-header.tsv", import.meta.url), "utf8")
    .trimEnd()
    .split("\n")
    .map((l) => l.split("\t"));
  const width = header[header.length - 1].length; // 4 key columns + 32 data columns
  const row = (pub, period, start, end, values) => {
    const r = Array(width).fill("");
    r[0] = pub;
    r[1] = period;
    r[2] = start;
    r[3] = end;
    for (const [k, v] of Object.entries(values)) r[4 + Number(k)] = v;
    return r;
  };
  // Data column k: 1 = BGH EUR VWAP, 12 = BGH BGN spot VWAP, 19 = CEEGEX Settlement,
  // 20 = CEEGEX VWAP, 23 = TTF Settlement, 27 = CEGH VWAP, 21 = NBP (ignored).
  const rows = [
    ...header,
    row("20.11.2026", "DA", "21.11.2026", "21.11.2026", {
      1: "30,50",
      19: "32,00",
      20: "31,90",
      23: "29,00",
      27: "30,10",
      21: "75",
    }),
    row("20.11.2026", "WE", "21.11.2026", "22.11.2026", { 1: "30,00", 19: "31,00" }),
    row("21.11.2026", "DA", "23.11.2026", "23.11.2026", { 12: "60,00", 20: "33,00" }),
    row("20.11.2026", "M+1", "01.12.2026", "31.12.2026", { 23: "31,50", 27: "32,00" }),
    row("20.11.2026", "M+2", "01.01.2027", "31.01.2027", { 23: "33,00" }),
  ];
  const r = parsePriceSheet(rows);
  const used = r.columns.filter((c) => c.hub);
  assert.ok(
    used.some(
      (c) =>
        c.hub === "BGH" && c.reason === "primary" && /VWAP/.test(c.header) && /EUR/.test(c.header),
    ),
  );
  assert.ok(
    used.some((c) => c.hub === "CEEGEX" && c.reason === "primary" && /Settlement/.test(c.header)),
  );
  assert.ok(
    used.every((c) => ["BGH", "CEEGEX", "TTF", "CEGH"].includes(c.hub)),
    "NBP/THE/GR ignored",
  );
  // Single-day contract beats the weekend block; weekend fills the Sunday.
  assert.deepEqual(r.series.BGH, [
    { date: "2026-11-21", price: 30.5 },
    { date: "2026-11-22", price: 30 },
    { date: "2026-11-23", price: 60 / 1.95583 },
  ]);
  assert.deepEqual(
    r.series.CEEGEX.map((x) => x.price),
    [32, 31, 33],
    "Settlement preferred, VWAP fills gaps",
  );
  assert.deepEqual(r.series.TTF, [{ date: "2026-11-21", price: 29 }]);
  assert.deepEqual(r.series.TTF_MA, [{ date: "2026-11-20", price: 31.5 }], "front month only");
  assert.deepEqual(r.series.CEGH_MA, [{ date: "2026-11-20", price: 32 }]);
  assert.ok(r.issues.some((i) => /1\.95583/.test(i)));
  assert.equal(
    hubOf({ source: "DATASCOPE", type: "Futures", area: "NBP", country: "GB", unit: "GBp/Therm" }),
    null,
  );
});

test("backtest holds persisted drivers (TTF, storage) at their last known value", () => {
  const n = 300;
  const z = rng(9);
  const dates = Array.from({ length: n }, (_, i) => addDays("2025-01-01", i));
  // Price = TTF + noise, TTF a random walk: knowing future TTF would make the model perfect.
  let t = 30;
  const ttf = new Map();
  const y = [];
  for (const d of dates) {
    t += z();
    ttf.set(d, t);
    y.push(t + 0.05 * z());
  }
  const { drivers } = buildDrivers(dates, [], { ttf });
  assert.deepEqual(drivers.persist, [true, false]);
  const res = forecastEnsemble({ dates, y, horizon: 7, drivers }, 60);
  const fm = res.scores.find((s) => s.id === "fundamental");
  // Without look-ahead it can be no better than the random walk on a random walk.
  assert.ok(fm.skill[6] < 0.2, `fundamental skill at 7d ${fm.skill[6]} implies look-ahead`);
});
