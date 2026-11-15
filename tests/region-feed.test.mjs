import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combineCorridor,
  parseOperatorPointDirection,
  selectCorridorPoints,
  toMcmPerDay,
} from "../src/lib/region/regional-feed.ts";
import { matchCorridors, normaliseLabel } from "../src/lib/region/registry.ts";

const ref = (label, country, direction, pd, adjacent = null) => ({
  pointDirection: pd,
  label,
  country,
  adjacent,
  direction,
  operator: `${country}-TSO-0001`,
});

test("unit normaliser converts explicitly and drops unknown units", () => {
  assert.ok(Math.abs(toMcmPerDay(10_550_000, "kWh/d") - 1) < 1e-9);
  assert.ok(Math.abs(toMcmPerDay(10_550, "MWh/d") - 1) < 1e-9);
  assert.ok(Math.abs(toMcmPerDay(10.55, "GWh/d") - 1) < 1e-9);
  assert.ok(Math.abs(toMcmPerDay(439_583.33, "kWh/h") - 1) < 1e-6);
  assert.equal(toMcmPerDay(1, "m3/d"), null);
  assert.equal(toMcmPerDay(1, ""), null);
});

test("labels match corridors without diacritics; short keywords are whole words", () => {
  assert.equal(normaliseLabel("Malkoçlar"), "malkoclar");
  assert.deepEqual(
    matchCorridors("Strandzha 2 (BG) / Malkoçlar (TR)").map((c) => c.id),
    ["tr_bg_str"],
  );
  assert.deepEqual(
    matchCorridors("Csanádpalota").map((c) => c.id),
    ["ro_hu_csa"],
  );
  assert.equal(matchCorridors("Kapitan Andreevo").length, 0);
});

test("operator point direction records are keyed like the dashboard ENTSOG keys", () => {
  const parsed = parseOperatorPointDirection({
    operatorKey: "BG-TSO-0001",
    pointKey: "ITP-00529",
    directionKey: "exit",
    pointLabel: "Kalotina",
    tSOCountry: "BG",
    adjacentCountry: "RS",
  });
  assert.equal(parsed.pointDirection, "bg-tso-0001itp-00529exit");
  assert.equal(parsed.country, "BG");
  assert.equal(parsed.adjacent, "RS");
  assert.equal(parseOperatorPointDirection({ pointLabel: "x", directionKey: "both" }), null);
});

test("points land on the corridor whose country pair fits, exit side preferred", () => {
  const sel = selectCorridorPoints([
    ref("Kulata (BG) / Sidirokastron (GR)", "GR", "exit", "gr-exit", "BG"),
    ref("Kulata (BG) / Sidirokastron (GR)", "BG", "entry", "bg-entry", "GR"),
    ref("Kulata (BG) / Sidirokastron (GR)", "BG", "exit", "bg-exit", "GR"),
    ref("Kulata somewhere", "RO", "exit", "ro-exit", "HU"),
  ]);
  assert.deepEqual(
    sel.gr_bg_kul.forwardExit.map((r) => r.pointDirection),
    ["gr-exit"],
  );
  assert.deepEqual(
    sel.gr_bg_kul.forwardEntry.map((r) => r.pointDirection),
    ["bg-entry"],
  );
  assert.deepEqual(
    sel.gr_bg_kul.reverseExit.map((r) => r.pointDirection),
    ["bg-exit"],
  );

  const series = new Map([
    ["gr-exit", new Map([["2026-11-01", 1.0]])],
    ["bg-entry", new Map([["2026-11-01", 1.1]])], // other side of the same flow: must not double count
    [
      "bg-exit",
      new Map([
        ["2026-11-01", 3.0],
        ["2026-11-02", 2.0],
      ]),
    ],
  ]);
  const out = combineCorridor("gr_bg_kul", sel.gr_bg_kul, series);
  assert.deepEqual(out.days, [
    { date: "2026-11-01", forward: 1.0, reverse: 3.0, net: -2.0 },
    { date: "2026-11-02", forward: null, reverse: 2.0, net: -2.0 },
  ]);
});

test("entry side is used only when the exit side published nothing", () => {
  const sel = selectCorridorPoints([
    ref("Strandzha 2 / Malkoclar", "TR", "exit", "tr-exit", "BG"),
    ref("Strandzha 2 / Malkoclar", "BG", "entry", "bg-entry", "TR"),
  ]);
  const out = combineCorridor(
    "tr_bg_str",
    sel.tr_bg_str,
    new Map([["bg-entry", new Map([["2026-11-01", 40]])]]),
  );
  assert.equal(out.days[0].net, 40);
  assert.equal(out.points[0].role, "entry");
});

test("LNG terminals take the entry into the receiving country only", () => {
  const sel = selectCorridorPoints([
    ref("LNG Hrvatska (Omišalj)", "HR", "entry", "hr-lng-entry"),
    ref("LNG Hrvatska (Omišalj)", "HR", "exit", "hr-lng-exit"),
  ]);
  assert.deepEqual(
    sel.lng_krk.forwardEntry.map((r) => r.pointDirection),
    ["hr-lng-entry"],
  );
  assert.equal(sel.lng_krk.forwardExit.length, 0);
});

test("corridors with no published series are omitted, not zero-filled", () => {
  const sel = selectCorridorPoints([ref("Rogatec", "SI", "exit", "si-exit", "HR")]);
  assert.equal(combineCorridor("si_hr_rog", sel.si_hr_rog, new Map()), null);
});
