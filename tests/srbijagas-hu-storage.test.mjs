import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHuStorage } from "../src/lib/gas/srbijagas-hu-storage.ts";

const anchors = {
  others: { date: "2026-10-01", mcm: 201 },
  met: { date: "2026-10-03", mcm: 25 },
};
const MWH = 10_550; // per mcm

test("Others subtracts HU entry that was not MET; MET runs from its anchor both ways", () => {
  const rows = buildHuStorage({
    anchors,
    to: "2026-10-04",
    huEntryMcm: new Map([
      ["2026-10-01", 3],
      ["2026-10-02", 4],
      ["2026-10-03", 2],
      ["2026-10-04", 1],
    ]),
    nominationsMwh: new Map([
      ["2026-10-02", 1 * MWH],
      ["2026-10-03", 0.5 * MWH],
      ["2026-10-04", 2 * MWH],
    ]),
  });
  const by = Object.fromEntries(rows.map((r) => [r.date, r]));
  // Others: 201 − 3 − (4−1) − (2−0.5) − max(0, 1−2)
  assert.equal(by["2026-10-01"].others, 198);
  assert.equal(by["2026-10-02"].others, 195);
  assert.equal(by["2026-10-03"].others, 193.5);
  assert.equal(by["2026-10-04"].others, 193.5);
  assert.equal(by["2026-10-04"].overNomination, true);
  // MET: 25 at the start of 3 Oct → end of 2 Oct is 25, end of 1 Oct is 26
  assert.equal(by["2026-10-02"].met, 25);
  assert.equal(by["2026-10-01"].met, 26);
  assert.equal(by["2026-10-03"].met, 24.5);
  assert.equal(by["2026-10-04"].met, 22.5);
  assert.equal(by["2026-10-03"].total, 24.5 + 193.5);
});

test("Others stops at the first unpublished allocation day; MET continues", () => {
  const rows = buildHuStorage({
    anchors,
    to: "2026-10-04",
    huEntryMcm: new Map([
      ["2026-10-01", 3],
      ["2026-10-02", null],
      ["2026-10-03", 2],
    ]),
    nominationsMwh: new Map(),
  });
  assert.deepEqual(
    rows.map((r) => r.others),
    [198, null, null, null],
  );
  assert.equal(rows[3].met, 25);
  assert.equal(rows[3].total, null);
});
