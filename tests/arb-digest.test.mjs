import { test } from "node:test";
import assert from "node:assert/strict";
import { arbDigest, digestSentences, seasonalStats, taLabel } from "../src/lib/gas/arb/digest.ts";
import { addDays } from "../src/lib/gas/arb/series.ts";

const row = (date, spread, cost = 5) => ({
  date,
  bgh: 80,
  ceegex: 80 + spread,
  ttf: null,
  cegh: null,
  spread,
  costBgHu: cost,
  costHuBg: cost,
  netBgHu: spread - cost,
  netHuBg: -spread - cost,
  tariffProxy: false,
  crisis: false,
  provisional: false,
});

test("empty history gives no digest and no sentences", () => {
  assert.equal(arbDigest([]), null);
  assert.deepEqual(digestSentences(null), []);
});

test("percentile, averages and window counts", () => {
  const rows = [];
  for (let i = 0; i < 400; i++) rows.push(row(addDays("2025-10-01", i), i % 10)); // 0..9
  rows.push(row(addDays("2025-10-01", 400), 6)); // opens BG→HU (6 > 5)
  const d = arbDigest(rows);
  assert.equal(d.day, "2026-11-05");
  assert.equal(d.spread, 6);
  assert.ok(d.percentile365 > 0.65 && d.percentile365 < 0.75);
  assert.equal(d.netBgHu, 1);
  // last 30 rows: spreads 6–9 clear a cost of 5 → 4 per block of ten (×3), plus today
  assert.equal(d.last30.days, 30);
  assert.equal(d.last30.openBgHu, 13);
  assert.equal(d.last30.openHuBg, 0);
  assert.equal(d.monthToDate.days, 5);
  assert.equal(d.seasonal.month, 11);
  assert.equal(d.seasonal.years, 1);
  assert.equal(d.seasonal.days, 30);
  assert.equal(d.percentile365 === null, false);
  const [line] = digestSentences(d);
  assert.match(line, /BG→HU clears transport by 1\.00/);
});

test("short history leaves the percentile out instead of guessing", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(addDays("2026-11-01", i), -1));
  const d = arbDigest(rows);
  assert.equal(d.percentile365, null);
  assert.equal(seasonalStats(rows, "2026-11-20"), null);
  assert.match(digestSentences(d)[0], /both directions below break-even \(closest HU→BG, 4\.00/);
});

test("outlook peaks, skill and technical label", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(addDays("2026-11-01", i), 0));
  const pt = (date, pB, pH) => ({
    date,
    spread: { date, p50: 0, lo: -1, hi: 1 },
    costBgHu: 5,
    costHuBg: 5,
    pBgHu: pB,
    pHuBg: pH,
  });
  const outlook = Array.from({ length: 10 }, (_, i) => pt(addDays("2026-11-21", i), i / 20, null));
  outlook[2].pHuBg = 0.3;
  const d = arbDigest(rows, {
    outlook,
    skill: [0.1, 0, 0, 0, 0, 0, -0.2],
    taScore: 0.5,
    signals: [{ name: "x", value: "1", bias: "up", note: "" }],
  });
  assert.equal(d.outlook.length, 7);
  assert.deepEqual(d.peakBgHu, { date: "2026-11-27", p: 0.3 });
  assert.deepEqual(d.peakHuBg, { date: "2026-11-23", p: 0.3 });
  assert.equal(d.skill1, 0.1);
  assert.equal(d.skill7, -0.2);
  assert.equal(taLabel(d.taScore), "widening (favours BG→HU)");
  assert.match(
    digestSentences(d)[1],
    /up to 30% BG→HU \(2026-11-27\) and 30% HU→BG \(2026-11-23\)/,
  );
  assert.equal(arbDigest(rows).taScore, null);
});
