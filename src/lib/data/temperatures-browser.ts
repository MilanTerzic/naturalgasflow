// Belgrade temperatures for the browser: the server function first, then Open-Meteo
// straight from the browser for any day the server could only fill from a fallback.
//
// Why: the hosted server's requests to Open-Meteo are refused (shared-IP rate limits),
// so it falls back to Visual Crossing or a static file. Open-Meteo allows CORS and
// answers browser requests normally, so the primary source is still reachable here.

import { BELGRADE_LAT, BELGRADE_LON } from "@/lib/gas/config";
import type { TempRow } from "@/lib/gas/types";
import { fetchBelgradeTemperatures, type TempFetchResult } from "./openmeteo.functions";

type Daily = { daily?: { time?: string[]; temperature_2m_mean?: (number | null)[] } };

async function getJson(url: string, timeoutMs = 15_000): Promise<Daily> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    return (await res.json()) as Daily;
  } finally {
    clearTimeout(t);
  }
}

function collect(json: Daily, from: string, to: string, out: Map<string, number>) {
  const t = json.daily?.time ?? [];
  const v = json.daily?.temperature_2m_mean ?? [];
  for (let i = 0; i < t.length; i++) {
    if (v[i] != null && t[i] >= from && t[i] <= to) out.set(t[i], v[i] as number);
  }
}

/** Open-Meteo archive (one request per calendar year) plus forecast for recent/future days. */
export async function fetchOpenMeteoInBrowser(
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const today = new Date().toISOString().slice(0, 10);
  const archiveEnd = to < today ? to : today;
  const base = `latitude=${BELGRADE_LAT}&longitude=${BELGRADE_LON}&daily=temperature_2m_mean&timezone=Europe%2FBelgrade`;
  if (from <= archiveEnd) {
    for (let y = Number(from.slice(0, 4)); y <= Number(archiveEnd.slice(0, 4)); y++) {
      const s = y === Number(from.slice(0, 4)) ? from : `${y}-01-01`;
      const e = y === Number(archiveEnd.slice(0, 4)) ? archiveEnd : `${y}-12-31`;
      collect(
        await getJson(
          `https://archive-api.open-meteo.com/v1/archive?${base}&start_date=${s}&end_date=${e}`,
        ),
        from,
        to,
        out,
      );
    }
  }
  // The archive lags a few days; the forecast endpoint covers the last week and ahead.
  const recentFrom = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  if (to >= recentFrom) {
    const fc = new Map<string, number>();
    collect(
      await getJson(`https://api.open-meteo.com/v1/forecast?${base}&past_days=7&forecast_days=16`),
      from,
      to,
      fc,
    );
    for (const [d, v] of fc) if (d >= today || !out.has(d)) out.set(d, v);
  }
  return out;
}

/**
 * Server result, with Open-Meteo from the browser replacing every day the server did not
 * get from Open-Meteo itself. If the browser request fails too, the server result stands.
 */
export async function fetchBelgradeTemperaturesWithBrowserFallback(args: {
  from: string;
  to: string;
}): Promise<TempFetchResult> {
  const server = await fetchBelgradeTemperatures({ data: args });
  if (server.provider === "open-meteo" && !server.warning) return server;
  try {
    const om = await fetchOpenMeteoInBrowser(args.from, args.to);
    if (om.size === 0) return server;
    const byDate = new Map<string, number | null>(
      server.data.map((r) => [r.date, r.temperature_c]),
    );
    for (const [d, v] of om) byDate.set(d, v);
    const data: TempRow[] = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, temperature_c]) => ({ date, temperature_c }));
    const covered = data.every((r) => om.has(r.date));
    return {
      ...server,
      data,
      error: null,
      provider: "open-meteo",
      warning: covered ? null : "Some days use the fallback weather dataset.",
    };
  } catch {
    return server;
  }
}
