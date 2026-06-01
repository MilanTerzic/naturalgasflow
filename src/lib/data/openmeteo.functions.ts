// Belgrade temperatures with Open-Meteo primary and Visual Crossing fallback.
import { createServerFn } from "@tanstack/react-start";
import { BELGRADE_LAT, BELGRADE_LON } from "@/lib/gas/config";
import type { TempRow } from "@/lib/gas/types";

interface FetchTempArgs {
  from: string; // ISO YYYY-MM-DD
  to: string;
}

export type WeatherProvider = "open-meteo" | "visual-crossing" | "none";

export interface TempFetchResult {
  data: TempRow[];
  error: string | null;
  warning: string | null;
  provider: WeatherProvider;
  fetchedAt: string; // ISO timestamp
}

// In-memory cache (per server instance). Refresh at most once per hour.
const CACHE_TTL_MS = 60 * 60 * 1000;
type CacheEntry = { value: TempFetchResult; expiresAt: number };
const cache = new Map<string, CacheEntry>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${res.statusText}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchOpenMeteo(from: string, to: string): Promise<TempRow[]> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const archiveEnd = to < todayStr ? to : todayStr;
  const lat = BELGRADE_LAT;
  const lon = BELGRADE_LON;
  const out = new Map<string, number>();

  if (from <= archiveEnd) {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${from}&end_date=${archiveEnd}&daily=temperature_2m_mean&timezone=Europe%2FBelgrade`;
    const json = (await fetchJson(url)) as {
      daily?: { time?: string[]; temperature_2m_mean?: (number | null)[] };
    };
    const t = json.daily?.time ?? [];
    const v = json.daily?.temperature_2m_mean ?? [];
    for (let i = 0; i < t.length; i++) {
      if (v[i] != null) out.set(t[i], v[i] as number);
    }
  }
  if (to >= todayStr) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_mean&past_days=7&forecast_days=16&timezone=Europe%2FBelgrade`;
    const json = (await fetchJson(url)) as {
      daily?: { time?: string[]; temperature_2m_mean?: (number | null)[] };
    };
    const t = json.daily?.time ?? [];
    const v = json.daily?.temperature_2m_mean ?? [];
    for (let i = 0; i < t.length; i++) {
      const d = t[i];
      if (v[i] != null && d >= from && d <= to) {
        if (d >= todayStr || !out.has(d)) out.set(d, v[i] as number);
      }
    }
  }
  return Array.from(out.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, temperature_c]) => ({ date, temperature_c }));
}

async function fetchOpenMeteoWithRetry(from: string, to: string): Promise<TempRow[]> {
  try {
    return await fetchOpenMeteo(from, to);
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    console.warn(`Open-Meteo failed (${status ?? "no-status"}), retrying once…`, err);
    await sleep(800);
    return await fetchOpenMeteo(from, to);
  }
}

async function fetchVisualCrossing(from: string, to: string): Promise<TempRow[]> {
  const key = process.env.VISUAL_CROSSING_API_KEY;
  if (!key) throw new Error("VISUAL_CROSSING_API_KEY is not configured");
  const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/Belgrade,Serbia/${from}/${to}?unitGroup=metric&include=days&elements=datetime,temp,tempmin,tempmax&key=${encodeURIComponent(key)}&contentType=json`;
  const json = (await fetchJson(url)) as {
    days?: Array<{ datetime: string; temp: number | null }>;
  };
  const days = json.days ?? [];
  return days
    .filter((d) => d.temp != null)
    .map((d) => ({ date: d.datetime, temperature_c: d.temp as number }));
}

export const fetchBelgradeTemperatures = createServerFn({ method: "POST" })
  .inputValidator((d: FetchTempArgs) => d)
  .handler(async ({ data }): Promise<TempFetchResult> => {
    const cacheKey = `${data.from}_${data.to}`;
    const now = Date.now();
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }

    let result: TempFetchResult;
    try {
      const rows = await fetchOpenMeteoWithRetry(data.from, data.to);
      if (rows.length === 0) throw new Error("Open-Meteo returned empty data");
      result = {
        data: rows,
        error: null,
        warning: null,
        provider: "open-meteo",
        fetchedAt: new Date().toISOString(),
      };
    } catch (primaryErr) {
      const primaryMsg = primaryErr instanceof Error ? primaryErr.message : "Unknown error";
      console.warn("Open-Meteo unavailable, falling back to Visual Crossing:", primaryMsg);
      try {
        const rows = await fetchVisualCrossing(data.from, data.to);
        result = {
          data: rows,
          error: null,
          warning: "Open-Meteo unavailable, using Visual Crossing fallback.",
          provider: "visual-crossing",
          fetchedAt: new Date().toISOString(),
        };
      } catch (fallbackErr) {
        const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : "Unknown error";
        console.error("Visual Crossing fallback failed:", fbMsg);
        result = {
          data: [],
          error: `Temperature unavailable (Open-Meteo: ${primaryMsg}; Visual Crossing: ${fbMsg})`,
          warning: null,
          provider: "none",
          fetchedAt: new Date().toISOString(),
        };
      }
    }

    // Cache successful responses for 1 hour; cache failures briefly (5 min) to avoid hammering.
    const ttl = result.data.length > 0 ? CACHE_TTL_MS : 5 * 60 * 1000;
    cache.set(cacheKey, { value: result, expiresAt: now + ttl });
    return result;
  });
