// Open-Meteo: free, keyless. Archive for history, forecast for next days.
import { createServerFn } from "@tanstack/react-start";
import { BELGRADE_LAT, BELGRADE_LON } from "@/lib/gas/config";
import type { TempRow } from "@/lib/gas/types";

interface FetchTempArgs {
  from: string; // ISO YYYY-MM-DD
  to: string;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

export const fetchBelgradeTemperatures = createServerFn({ method: "POST" })
  .inputValidator((d: FetchTempArgs) => d)
  .handler(async ({ data }): Promise<{ data: TempRow[]; error: string | null }> => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const archiveEnd = data.to < todayStr ? data.to : todayStr;
    const lat = BELGRADE_LAT;
    const lon = BELGRADE_LON;
    const out = new Map<string, number>();
    try {
      if (data.from <= archiveEnd) {
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${data.from}&end_date=${archiveEnd}&daily=temperature_2m_mean&timezone=Europe%2FBelgrade`;
        const json = (await fetchJson(url)) as {
          daily?: { time?: string[]; temperature_2m_mean?: (number | null)[] };
        };
        const t = json.daily?.time ?? [];
        const v = json.daily?.temperature_2m_mean ?? [];
        for (let i = 0; i < t.length; i++) {
          if (v[i] != null) out.set(t[i], v[i] as number);
        }
      }
      // Forecast (covers today + future). Includes "past_days" for overlap fill.
      if (data.to >= todayStr) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_mean&past_days=7&forecast_days=16&timezone=Europe%2FBelgrade`;
        const json = (await fetchJson(url)) as {
          daily?: { time?: string[]; temperature_2m_mean?: (number | null)[] };
        };
        const t = json.daily?.time ?? [];
        const v = json.daily?.temperature_2m_mean ?? [];
        for (let i = 0; i < t.length; i++) {
          const d = t[i];
          if (v[i] != null && d >= data.from && d <= data.to) {
            // Forecast wins for today/future; archive wins for history.
            if (d >= todayStr || !out.has(d)) out.set(d, v[i] as number);
          }
        }
      }
      const rows: TempRow[] = Array.from(out.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, temperature_c]) => ({ date, temperature_c }));
      return { data: rows, error: null };
    } catch (err) {
      console.error("Open-Meteo fetch failed", err);
      return { data: [], error: err instanceof Error ? err.message : "Unknown error" };
    }
  });
