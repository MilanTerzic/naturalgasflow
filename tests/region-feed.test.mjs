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

test("capacity uses the exit side when it publishes technical capacity, else the entry side", async () => {
  const { combineCapacity } = await import("../src/lib/region/regional-feed.ts");
  const sel = {
    forwardExit: [ref("Strandzha 2", "TR", "exit", "tr-exit", "BG")],
    forwardEntry: [ref("Strandzha 2", "BG", "entry", "bg-entry", "TR")],
    reverseExit: [],
    reverseEntry: [],
  };
  const technical = new Map([["bg-entry", new Map([["2026-11-01", 50]])]]);
  const booked = new Map([
    ["bg-entry", new Map([["2026-11-01", 45]])],
    ["tr-exit", new Map([["2026-11-01", 99]])],
  ]);
  const cap = combineCapacity("tr_bg_str", sel, technical, booked);
  assert.deepEqual(cap.days, [
    {
      date: "2026-11-01",
      forwardTechnical: 50,
      forwardBooked: 45,
      reverseTechnical: null,
      reverseBooked: null,
    },
  ]);
  assert.equal(combineCapacity("tr_bg_str", sel, new Map(), booked), null);
});

test("country fields are accepted as ISO codes or English names; operator prefix is the fallback", async () => {
  const { countryCode } = await import("../src/lib/region/regional-feed.ts");
  assert.equal(countryCode("bg"), "BG");
  assert.equal(countryCode("North Macedonia"), "MK");
  assert.equal(countryCode("Atlantis"), null);
  const parsed = parseOperatorPointDirection({
    operatorKey: "GR-TSO-0001",
    pointKey: "ITP-00078",
    directionKey: "exit",
    pointLabel: "Kulata (BG) / Sidirokastron (GR)",
    adjacentCountry: "Bulgaria",
  });
  assert.equal(parsed.country, "GR");
  assert.equal(parsed.adjacent, "BG");
});

// ------------------------------------------------------------------ real ENTSOG rows (captured)
import { readFileSync as readFixture } from "node:fs";
import { expandPeriod, indexOperationalRows } from "../src/lib/region/regional-feed.ts";
import { CORRIDOR_BY_ID } from "../src/lib/region/registry.ts";

const entsog = JSON.parse(
  readFixture(new URL("./fixtures/entsog-tap-capacity-20261116.json", import.meta.url), "utf8"),
);

test("expandPeriod: validity periods become gas days, clipped, end exclusive", () => {
  assert.deepEqual(expandPeriod("2026-11-14", "2026-11-15", "2026-11-10", "2026-11-15"), [
    "2026-11-14",
  ]);
  assert.deepEqual(expandPeriod("2026-10-01", "2041-10-01", "2026-11-13", "2026-11-15"), [
    "2026-11-13",
    "2026-11-14",
    "2026-11-15",
  ]);
  assert.deepEqual(expandPeriod("2026-11-07", "2026-11-12", "2026-11-10", "2026-11-15"), [
    "2026-11-10",
    "2026-11-11",
  ]);
  assert.deepEqual(expandPeriod("2026-11-20", "2026-11-24", "2026-11-10", "2026-11-15"), []);
});

test("captured ENTSOG capacity periods fill every gas day (TAP, Kireevo, Kalotina)", () => {
  const dropped = {};
  const tech = indexOperationalRows(
    entsog["Firm Technical"],
    "Firm Technical",
    "2026-11-10",
    "2026-11-15",
    new Map(),
    dropped,
  );
  const booked = indexOperationalRows(
    entsog["Firm Booked"],
    "Firm Booked",
    "2026-11-10",
    "2026-11-15",
    new Map(),
    dropped,
  );
  const mcm = (m, pd, d) => +m.get(pd).get(d).value.toFixed(2);
  // Kipoi: 390 GWh/d technical valid 2026-10-25 → 2028-12-31, applies to every day in window.
  for (const d of ["2026-11-10", "2026-11-14", "2026-11-15"])
    assert.equal(mcm(tech, "al-tso-0001itp-00274entry", d), 36.97);
  // Kalotina: 53.16 GWh/d ≈ 5.04 mcm/d (matches the "5" in the GY 25/26 table).
  assert.equal(mcm(tech, "bg-tso-0001itp-00134exit", "2026-11-14"), 5.04);
  assert.equal(mcm(tech, "bg-tso-0001itp-00529exit", "2026-11-14"), 38.72);
  // Nea Mesimvria technical changes on 11-11: the period starting latest wins from then on.
  assert.equal(mcm(tech, "al-tso-0001itp-00427exit", "2026-11-10"), 6.48);
  assert.equal(mcm(tech, "al-tso-0001itp-00427exit", "2026-11-11"), 7.0);
  // Melendugno booked: gap on 11-12 in this subset stays empty, never filled.
  assert.equal(booked.get("al-tso-0001itp-00008exit").has("2026-11-12"), false);
  assert.equal(mcm(booked, "al-tso-0001itp-00008exit", "2026-11-14"), 31.21);
  // "" values (dead reverse directions) are missing, not zero.
  assert.equal(tech.has("al-tso-0001itp-00275entry"), false);
  assert.deepEqual(dropped, {});
});

test("captured flows: real zero kept, empty string dropped", () => {
  const flows = indexOperationalRows(
    entsog["Physical Flow"],
    "Physical Flow",
    "2026-11-10",
    "2026-11-15",
    new Map(),
    {},
  );
  assert.equal(+flows.get("al-tso-0001itp-00274entry").get("2026-11-14").value.toFixed(2), 37.55);
  assert.equal(flows.get("al-tso-0001itp-00427entry").get("2026-11-14").value, 0);
  assert.equal(flows.has("al-tso-0001itp-00275entry"), false);
});

test("TAP corridors are bound to TAP's ENTSOG point directions (TSO registered in CH)", () => {
  assert.deepEqual(CORRIDOR_BY_ID.tap_kipoi.entsog.forward, ["al-tso-0001itp-00274entry"]);
  assert.deepEqual(CORRIDOR_BY_ID.gr_al_tap.entsog.forward, ["al-tso-0001itp-00008exit"]);
  assert.deepEqual(CORRIDOR_BY_ID.tap_komotini.entsog.forward, ["al-tso-0001itp-00275exit"]);
  assert.deepEqual(CORRIDOR_BY_ID.tap_nm.entsog.forward, ["al-tso-0001itp-00427exit"]);
  // No keyword matching for TAP any more (it would catch DESFA's Nea Mesimvria).
  assert.ok(
    !matchCorridors("Nea Mesimvria").some((c) => c.id.startsWith("tap") || c.id === "gr_al_tap"),
  );
});
