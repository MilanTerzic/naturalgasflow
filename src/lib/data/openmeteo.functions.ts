// Belgrade temperatures with Open-Meteo primary and Visual Crossing fallback.
import { createServerFn } from "@tanstack/react-start";
import { BELGRADE_LAT, BELGRADE_LON } from "@/lib/gas/config";
import type { TempRow } from "@/lib/gas/types";
import staticTempFallback from "./temp-fallback.json";

const STATIC_FALLBACK: Record<string, number> = staticTempFallback as Record<string, number>;

interface FetchTempArgs {
  from: string; // ISO YYYY-MM-DD
  to: string;
}

export type WeatherProvider = "open-meteo" | "visual-crossing" | "static-fallback" | "none";

export interface TempFetchResult {
  data: TempRow[];
  error: string | null;
  warning: string | null;
  provider: WeatherProvider;
  fetchedAt: string; // ISO timestamp
}

// Per-day cache: once a date's temperature is fetched, keep it.
// - Historical days (date < today UTC) never expire — temperature is final.
// - Today & future days expire after 1 hour so forecasts can refresh.
const CACHE_TTL_MS = 60 * 60 * 1000;
type DayEntry = {
  temperature_c: number;
  provider: WeatherProvider;
  fetchedAt: string;
  expiresAt: number; // Infinity for finalized historical days
};
const dayCache = new Map<string, DayEntry>(); // key = ISO date
const errorCache = new Map<string, { error: string; expiresAt: number }>(); // dedupe failures
const ERROR_TTL_MS = 5 * 60 * 1000;

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDatesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const now = Date.now();
    const today = todayIsoUtc();
    const requestedDates = isoDatesBetween(data.from, data.to);

    // 1. Find which dates need fetching (missing or expired).
    const missing: string[] = [];
    for (const d of requestedDates) {
      const entry = dayCache.get(d);
      if (!entry || entry.expiresAt <= now) missing.push(d);
    }

    let warning: string | null = null;
    let fetchError: string | null = null;
    let providerUsed: WeatherProvider | null = null;

    if (missing.length > 0) {
      // Check error backoff: if we recently failed for this window, skip refetch.
      const errKey = `${missing[0]}_${missing[missing.length - 1]}`;
      const errHit = errorCache.get(errKey);
      const inBackoff = errHit && errHit.expiresAt > now;

      if (!inBackoff) {
        const fetchFrom = missing[0];
        const fetchTo = missing[missing.length - 1];
        let rows: TempRow[] = [];
        try {
          rows = await fetchOpenMeteoWithRetry(fetchFrom, fetchTo);
          if (rows.length === 0) throw new Error("Open-Meteo returned empty data");
          providerUsed = "open-meteo";
        } catch (primaryErr) {
          const primaryMsg = primaryErr instanceof Error ? primaryErr.message : "Unknown error";
          console.warn("Open-Meteo unavailable, falling back to Visual Crossing:", primaryMsg);
          try {
            rows = await fetchVisualCrossing(fetchFrom, fetchTo);
            providerUsed = "visual-crossing";
            warning = "Open-Meteo unavailable, using Visual Crossing fallback.";
          } catch (fallbackErr) {
            const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : "Unknown error";
            console.error("Visual Crossing fallback failed:", fbMsg);
            fetchError = `Temperature unavailable (Open-Meteo: ${primaryMsg}; Visual Crossing: ${fbMsg})`;
            errorCache.set(errKey, { error: fetchError, expiresAt: now + ERROR_TTL_MS });
          }
        }

        // Store each fetched day. Historical days are finalized (never expire).
        if (providerUsed) {
          const fetchedAt = new Date().toISOString();
          for (const row of rows) {
            const isHistorical = row.date < today;
            dayCache.set(row.date, {
              temperature_c: row.temperature_c as number,
              provider: providerUsed,
              fetchedAt,
              expiresAt: isHistorical ? Number.POSITIVE_INFINITY : now + CACHE_TTL_MS,
            });
          }
        }
      } else if (errHit) {
        fetchError = errHit.error;
      }
    }

    // 2. Assemble result from cache for every requested date; fill gaps from static fallback.
    const out: TempRow[] = [];
    const providers = new Set<WeatherProvider>();
    let latestFetchedAt = "";
    let usedStaticFallback = false;
    for (const d of requestedDates) {
      const entry = dayCache.get(d);
      if (entry) {
        out.push({ date: d, temperature_c: entry.temperature_c });
        providers.add(entry.provider);
        if (entry.fetchedAt > latestFetchedAt) latestFetchedAt = entry.fetchedAt;
      } else if (STATIC_FALLBACK[d] != null) {
        out.push({ date: d, temperature_c: STATIC_FALLBACK[d] });
        providers.add("static-fallback");
        usedStaticFallback = true;
      }
    }

    if (usedStaticFallback && !warning) {
      warning = "Live weather unavailable for some days; using local fallback dataset.";
    }

    // Pick a representative provider for the response.
    const provider: WeatherProvider =
      providers.size === 0
        ? "none"
        : providers.has("open-meteo")
          ? "open-meteo"
          : providers.has("visual-crossing")
            ? "visual-crossing"
            : "static-fallback";

    // Only surface the error if we genuinely have no data at all.
    const error = out.length === 0 ? fetchError : null;

    return {
      data: out,
      error,
      warning,
      provider,
      fetchedAt: latestFetchedAt || new Date().toISOString(),
    };
  });

