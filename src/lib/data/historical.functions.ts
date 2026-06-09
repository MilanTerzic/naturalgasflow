// Historical data fetches for the Srbijagas analysis tab.
// - fetchHistoricalFlows: wraps ENTSOG (works ~2 years back).
// - fetchEcbFx: pulls EUR/USD monthly averages from ECB Statistical Data Warehouse (free, no key).
// - fetchEntsoeGasGeneration: ENTSO-E Transparency – actual generation per type (Fossil Gas = B04) for Serbia.
import { createServerFn } from "@tanstack/react-start";
import { fetchEntsogFlows } from "./entsog.functions";

export interface HistoricalFlowsArgs {
  from: string;
  to: string;
}

export const fetchHistoricalFlows = createServerFn({ method: "POST" })
  .inputValidator((d: HistoricalFlowsArgs) => d)
  .handler(async ({ data }) => {
    // ENTSOG typically caps at ~2 years; we attempt the requested window and return
    // whatever rows are available. Caller is responsible for noting gaps.
    return await fetchEntsogFlows({ data });
  });

// ECB EXR series: D.USD.EUR.SP00.A -> daily reference rate (USD per 1 EUR).
// We monthly-average client-side.
interface FxArgs {
  fromISO: string; // YYYY-MM-DD
  toISO: string;
}
export interface FxResult {
  data: Record<string, number>; // month YYYY-MM -> EUR/USD avg
  error: string | null;
  fetchedAt: string;
}

export const fetchEcbFx = createServerFn({ method: "POST" })
  .inputValidator((d: FxArgs) => d)
  .handler(async ({ data }): Promise<FxResult> => {
    try {
      const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=${data.fromISO}&endPeriod=${data.toISO}&format=csvdata`;
      const res = await fetch(url, { headers: { accept: "text/csv" } });
      if (!res.ok) throw new Error(`ECB HTTP ${res.status}`);
      const csv = await res.text();
      const lines = csv.trim().split("\n");
      const header = lines[0].split(",").map((s) => s.replace(/^"|"$/g, ""));
      const dateIdx = header.indexOf("TIME_PERIOD");
      const valIdx = header.indexOf("OBS_VALUE");
      if (dateIdx < 0 || valIdx < 0) throw new Error("ECB: unexpected CSV header");
      const agg: Record<string, { sum: number; n: number }> = {};
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",").map((s) => s.replace(/^"|"$/g, ""));
        const date = parts[dateIdx];
        const val = parseFloat(parts[valIdx]);
        if (!date || Number.isNaN(val)) continue;
        const m = date.slice(0, 7);
        const a = (agg[m] ??= { sum: 0, n: 0 });
        a.sum += val;
        a.n += 1;
      }
      const out: Record<string, number> = {};
      for (const [m, a] of Object.entries(agg)) out[m] = +(a.sum / a.n).toFixed(4);
      return { data: out, error: null, fetchedAt: new Date().toISOString() };
    } catch (err) {
      return {
        data: {},
        error: err instanceof Error ? err.message : "Unknown ECB error",
        fetchedAt: new Date().toISOString(),
      };
    }
  });

// ---------------------------------------------------------------------------
// ENTSO-E – Actual Generation per Production Type (A75 / Fossil Gas B04)
// Serbia bidding zone EIC: 10YCS-SERBIATSOV
// Docs: https://documenter.getpostman.com/view/7009892/2s93JtP3F6
// Max ~1 year per call, hourly resolution → daily GWh.
// ---------------------------------------------------------------------------
interface EntsoeArgs {
  fromISO: string; // YYYY-MM-DD
  toISO: string;
}
export interface EntsoeGenResult {
  data: Record<string, number>; // date YYYY-MM-DD -> GWh/day (fossil gas)
  error: string | null;
  fetchedAt: string;
  source: "entsoe";
}

function toEntsoeStamp(iso: string, end = false): string {
  // periodStart/periodEnd format: yyyyMMddHHmm (UTC).
  const d = new Date(`${iso}T00:00:00Z`);
  if (end) d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}0000`;
}

function addYearsIso(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}
function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

// Very small XML extractor (workerd has no DOMParser). We only need
// Period blocks with resolution + timeInterval/start + Point list.
function parseEntsoeXml(xml: string): Record<string, number> {
  const out: Record<string, number> = {};
  const periodRegex = /<Period>([\s\S]*?)<\/Period>/g;
  let pm: RegExpExecArray | null;
  while ((pm = periodRegex.exec(xml)) !== null) {
    const block = pm[1];
    const resMatch = block.match(/<resolution>([^<]+)<\/resolution>/);
    const startMatch = block.match(/<timeInterval>[\s\S]*?<start>([^<]+)<\/start>/);
    if (!resMatch || !startMatch) continue;
    const resolution = resMatch[1].trim(); // e.g. PT60M, PT15M
    const start = new Date(startMatch[1].trim());
    if (Number.isNaN(start.getTime())) continue;
    const minutesPerStep =
      resolution === "PT15M" ? 15 :
      resolution === "PT30M" ? 30 :
      resolution === "PT60M" || resolution === "PT1H" ? 60 :
      60;
    const pointRegex = /<Point>\s*<position>(\d+)<\/position>\s*<quantity>([\d.\-eE+]+)<\/quantity>\s*<\/Point>/g;
    let qm: RegExpExecArray | null;
    while ((qm = pointRegex.exec(block)) !== null) {
      const pos = parseInt(qm[1], 10);
      const mw = parseFloat(qm[2]);
      if (!Number.isFinite(mw)) continue;
      const ts = new Date(start.getTime() + (pos - 1) * minutesPerStep * 60_000);
      const dateKey = ts.toISOString().slice(0, 10);
      // MW over (minutesPerStep) minutes -> MWh
      const mwh = mw * (minutesPerStep / 60);
      out[dateKey] = (out[dateKey] ?? 0) + mwh;
    }
  }
  // Convert MWh -> GWh
  for (const k of Object.keys(out)) out[k] = +(out[k] / 1000).toFixed(3);
  return out;
}

async function fetchEntsoeChunk(token: string, fromISO: string, toISO: string): Promise<Record<string, number>> {
  const params = new URLSearchParams({
    securityToken: token,
    documentType: "A75",
    processType: "A16",
    in_Domain: "10YCS-SERBIATSOV",
    psrType: "B04",
    periodStart: toEntsoeStamp(fromISO),
    periodEnd: toEntsoeStamp(toISO, true),
  });
  const res = await fetch(`https://web-api.tp.entsoe.eu/api?${params.toString()}`, {
    headers: { accept: "application/xml" },
  });
  const text = await res.text();
  if (!res.ok) {
    // ENTSO-E returns Acknowledgement_MarketDocument with reason on no-data; treat as empty
    if (/No matching data found/i.test(text)) return {};
    throw new Error(`ENTSO-E HTTP ${res.status}`);
  }
  return parseEntsoeXml(text);
}

export const fetchEntsoeGasGeneration = createServerFn({ method: "POST" })
  .inputValidator((d: EntsoeArgs) => d)
  .handler(async ({ data }): Promise<EntsoeGenResult> => {
    const token = process.env.ENTSOE_API_TOKEN;
    if (!token) {
      return {
        data: {},
        error: "ENTSOE_API_TOKEN not configured",
        fetchedAt: new Date().toISOString(),
        source: "entsoe",
      };
    }
    try {
      const merged: Record<string, number> = {};
      // Chunk by 1-year windows (API limit).
      let chunkStart = data.fromISO;
      while (chunkStart <= data.toISO) {
        const chunkEnd = minIso(addYearsIso(chunkStart, 1), data.toISO);
        const part = await fetchEntsoeChunk(token, chunkStart, chunkEnd);
        Object.assign(merged, part);
        if (chunkEnd === data.toISO) break;
        // advance 1 day past chunkEnd
        const next = new Date(`${chunkEnd}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        chunkStart = next.toISOString().slice(0, 10);
      }
      return { data: merged, error: null, fetchedAt: new Date().toISOString(), source: "entsoe" };
    } catch (err) {
      return {
        data: {},
        error: err instanceof Error ? err.message : "Unknown ENTSO-E error",
        fetchedAt: new Date().toISOString(),
        source: "entsoe",
      };
    }
  });
