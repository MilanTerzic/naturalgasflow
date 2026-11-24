import { test } from "node:test";
import assert from "node:assert/strict";
import { missingDateRanges, readThroughEntsog } from "../src/lib/data/entsog-cache.ts";

const base = "https://transparency.entsog.eu/api/v1/operationaldata.json?pointDirection=BG-TSO-0001testexit&indicator=Allocation&periodType=day&limit=-1";
const url = (from, to) => `${base}&from=${from}&to=${to}`;
const row = (day, value = 100) => ({ periodFrom: `${day}T06:00:00+01:00`, value, unit: "kWh/d" });
function storage() {
  const rows = new Map();
  return {
    rows,
    async read(keys, from, to) { return [...rows.values()].filter((r) => keys.includes(r.series_key) && r.gas_day >= from && r.gas_day <= to); },
    async save(days) { for (const day of days) { const key = `${day.series_key}|${day.gas_day}`; if (!rows.has(key)) rows.set(key, structuredClone(day)); } },
  };
}
const today = "2026-11-24";

test("successful observations persist and reopening/refreshed queries never fetch saved days", async () => {
  const store = storage();
  let calls = 0;
  const request = async () => { calls++; return { operationaldata: [row("2026-11-20", 0), row("2026-11-21", 101)] }; };
  await readThroughEntsog(url("2026-11-20", "2026-11-21"), store, request, today);
  const reopened = await readThroughEntsog(url("2026-11-20", "2026-11-21"), store, async () => { throw new Error("Must not fetch"); }, today);
  assert.equal(calls, 1);
  assert.deepEqual(reopened.map((r) => r.value), [0, 101]);
  assert.equal(store.rows.size, 2);
});

test("extending the selected period fetches only the missing dates", async () => {
  const store = storage();
  await readThroughEntsog(url("2026-11-20", "2026-11-21"), store, async () => ({ operationaldata: [row("2026-11-20"), row("2026-11-21")] }), today);
  const calls = [];
  const result = await readThroughEntsog(url("2026-11-19", "2026-11-22"), store, async (query) => {
    const u = new URL(query);
    calls.push([u.searchParams.get("from"), u.searchParams.get("to")]);
    return { operationaldata: [row(u.searchParams.get("from"), 200)] };
  }, today);
  assert.deepEqual(calls, [["2026-11-19", "2026-11-19"], ["2026-11-22", "2026-11-22"]]);
  assert.equal(result.length, 4);
});

test("partial failures keep previous data and save successful gap responses", async () => {
  const store = storage();
  await readThroughEntsog(url("2026-11-20", "2026-11-20"), store, async () => ({ operationaldata: [row("2026-11-20", 123)] }), today);
  const result = await readThroughEntsog(url("2026-11-19", "2026-11-21"), store, async (query) => {
    const from = new URL(query).searchParams.get("from");
    if (from === "2026-11-19") throw new Error("HTTP 500");
    return { operationaldata: [row("2026-11-21", 456)] };
  }, today);
  assert.deepEqual(result.map((r) => r.value), [123, 456]);
  assert.equal(store.rows.size, 2);
});

test("empty and invalid responses leave gaps retryable and never become zero observations", async () => {
  const store = storage();
  await readThroughEntsog(url("2026-11-20", "2026-11-21"), store, async () => ({ operationaldata: [row("2026-11-20", null), row("2026-11-21", "not numeric")] }), today);
  assert.equal(store.rows.size, 0);
  let calls = 0;
  await readThroughEntsog(url("2026-11-20", "2026-11-21"), store, async () => { calls++; return {}; }, today);
  assert.equal(calls, 1);
});

test("flows, allocations, nominations and capacities use independent cache series", async () => {
  const store = storage();
  for (const indicator of ["Allocation", "Physical Flow", "Nomination", "Renomination", "Firm Technical", "Firm Booked"]) {
    await readThroughEntsog(url("2026-11-20", "2026-11-20").replace("indicator=Allocation", `indicator=${encodeURIComponent(indicator)}`), store, async () => ({ operationaldata: [row("2026-11-20")] }), today);
  }
  assert.equal(store.rows.size, 6);
});

test("unfinished current-day physical flow is not frozen as a completed daily observation", async () => {
  const store = storage();
  const query = url(today, today).replace("indicator=Allocation", "indicator=Physical%20Flow");
  const result = await readThroughEntsog(query, store, async () => ({ operationaldata: [row(today, 10)] }), today);
  assert.equal(result[0]?.value, 10);
  assert.equal(store.rows.size, 0);
  await readThroughEntsog(query, store, async () => ({ operationaldata: [row(today, 100)] }), "2026-11-25");
  assert.equal(store.rows.size, 1);
});

test("country aggregates retain all components, and batch requests fetch only each missing point", async () => {
  const store = storage();
  const aggregate = "https://transparency.entsog.eu/api/v1/aggregatedData?countryKey=BG&indicator=Physical%20Flow&periodType=day&from=2026-11-20&to=2026-11-20";
  await readThroughEntsog(aggregate, store, async () => ({ aggregatedData: [{ ...row("2026-11-20", 5), countryKey: "BG", directionKey: "entry" }, { ...row("2026-11-20", 3), countryKey: "BG", directionKey: "exit" }] }), today);
  const cached = await readThroughEntsog(aggregate, store, async () => { throw new Error("Must not fetch"); }, today);
  assert.equal(cached.length, 2);
  assert.deepEqual(cached.map((r) => r.value), [5, 3]);
  await readThroughEntsog(url("2026-11-20", "2026-11-20"), store, async () => ({ operationaldata: [row("2026-11-20")] }), today);
  let requested = "";
  await readThroughEntsog(url("2026-11-20", "2026-11-20").replace("BG-TSO-0001testexit", "BG-TSO-0001testexit,HU-testentry"), store, async (query) => { requested = new URL(query).searchParams.get("pointDirection"); return { operationaldata: [row("2026-11-20", 9)] }; }, today);
  assert.equal(requested, "hu-testentry");
});

test("missing ranges exclude saved dates and validate range bounds", () => {
  assert.deepEqual(missingDateRanges("2026-11-20", "2026-11-24", new Set(["2026-11-21", "2026-11-23"])), [["2026-11-20", "2026-11-20"], ["2026-11-22", "2026-11-22"], ["2026-11-24", "2026-11-24"]]);
  assert.throws(() => missingDateRanges("invalid", "2026-11-24", new Set()));
});

test("capacity validity periods save each covered day and reuse them for a new range", async () => {
  const store = storage();
  const query = url("2026-11-20", "2026-11-22").replace("indicator=Allocation", "indicator=Firm%20Technical");
  await readThroughEntsog(query, store, async () => ({ operationaldata: [{ ...row("2026-10-01", 42), periodTo: "2041-10-01T06:00:00+01:00" }] }), today);
  assert.equal(store.rows.size, 3);
  const result = await readThroughEntsog(query.replace("from=2026-11-20", "from=2026-11-21"), store, async () => { throw new Error("Must not fetch"); }, today);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.value, 42);
});

test("batched rows without pointDirection are matched by operator, point and direction", async () => {
  const store = storage();
  const query = url("2026-11-20", "2026-11-20").replace("BG-TSO-0001testexit", "BG-TSO-0001testexit,HU-otherentry");
  await readThroughEntsog(query, store, async () => ({ operationaldata: [{ ...row("2026-11-20", 9), operatorKey: "BG-TSO-0001", pointKey: "test", directionKey: "exit" }] }), today);
  assert.equal(store.rows.size, 1);
  assert.equal([...store.rows.values()][0]?.records[0]?.value, 9);
});

test("saved-only reads return existing observations immediately without requesting any gaps", async () => {
  const store = storage();
  await readThroughEntsog(url("2026-11-20", "2026-11-20"), store, async () => ({ operationaldata: [row("2026-11-20", 77)] }), today);
  const result = await readThroughEntsog(url("2026-11-19", "2026-11-21"), store, async () => { throw new Error("Must not request missing dates yet"); }, today, true);
  assert.deepEqual(result.map((r) => r.value), [77]);
});