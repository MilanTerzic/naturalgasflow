// Historical data fetches for the Srbijagas analysis tab.
// - fetchHistoricalFlows: wraps ENTSOG (works ~2 years back).
// - fetchEcbFx: pulls EUR/USD monthly averages from ECB Statistical Data Warehouse (free, no key).
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
