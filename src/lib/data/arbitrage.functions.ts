// Server functions for the Arbitrage tab: stored/imported price history, Budapest & Sofia
// weather, forecast persistence for shadow scoring, history import and the AI trader brief.
// Reads return honest empties with an error string rather than throwing, so the tab can
// still show live prices when Supabase or a source is unavailable.
import { createServerFn } from "@tanstack/react-start";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

export const HISTORY_HUBS = [
  "BGH",
  "CEEGEX",
  "TTF",
  "CEGH",
  "BGH_MA",
  "CEEGEX_MA",
  "TTF_MA",
  "CEGH_MA",
] as const;
export type HistoryHub = (typeof HISTORY_HUBS)[number];

export interface HistoryPoint {
  date: string;
  price: number;
  final: boolean;
  source: "fetched" | "import";
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function admin(): Promise<Loose> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Loose;
}

async function approvedSession() {
  const { useAppSession: getAppSession } = await import("@/lib/auth-session.server");
  const db = await admin();
  const session = await getAppSession();
  if (session.data.authenticated !== true || !session.data.userId)
    throw new Error("You must sign in first.");
  const { data: account, error } = await db
    .from("app_user_access")
    .select("status")
    .eq("user_id", session.data.userId)
    .maybeSingle();
  if (error || !account || account.status !== "approved")
    throw new Error("Your account is not approved for this action.");
  return db;
}

/** All stored history from `from` onwards, paged past Supabase's 1000-row cap. */
export const fetchPriceHistory = createServerFn({ method: "POST" })
  .inputValidator((d: { from: string }) => {
    if (!ISO.test(d?.from ?? "")) throw new Error("Invalid from date.");
    return { from: d.from };
  })
  .handler(async ({ data }) => {
    const out: Record<HistoryHub, HistoryPoint[]> = Object.fromEntries(
      HISTORY_HUBS.map((h) => [h, []]),
    ) as unknown as Record<HistoryHub, HistoryPoint[]>;
    try {
      const db = await admin();
      const page = 1000;
      for (let offset = 0; offset < 100_000; offset += page) {
        const { data: rows, error } = await db
          .from("hub_price_history")
          .select("hub,delivery_date,price_eur_mwh,final,source")
          .gte("delivery_date", data.from)
          .order("delivery_date", { ascending: true })
          .order("hub", { ascending: true })
          .range(offset, offset + page - 1);
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
          const hub = r.hub as HistoryHub;
          if (!out[hub]) continue;
          out[hub].push({
            date: String(r.delivery_date),
            price: Number(r.price_eur_mwh),
            final: r.final === true,
            source: r.source === "import" ? "import" : "fetched",
          });
        }
        if (!rows || rows.length < page) break;
      }
      return { series: out, error: null as string | null };
    } catch (err) {
      return {
        series: out,
        error: err instanceof Error ? err.message : "price history unavailable",
      };
    }
  });

const IMPORT_LIMIT = 40_000;

/** Upserts a parsed sheet. Imported prices are stored as final, source = 'import'. */
export const importPriceHistory = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { series: Partial<Record<HistoryHub, { date: string; price: number }[]>> }) => {
      const rows: { hub: HistoryHub; date: string; price: number }[] = [];
      for (const [hub, xs] of Object.entries(d?.series ?? {})) {
        if (!(HISTORY_HUBS as readonly string[]).includes(hub))
          throw new Error(`Unknown hub ${hub}.`);
        for (const x of xs ?? []) {
          if (!ISO.test(x.date) || !(x.price > 0 && x.price < 1000))
            throw new Error(`Invalid ${hub} row ${x.date}.`);
          rows.push({ hub: hub as HistoryHub, date: x.date, price: Number(x.price) });
        }
      }
      if (!rows.length) throw new Error("Nothing to import.");
      if (rows.length > IMPORT_LIMIT) throw new Error(`Import is limited to ${IMPORT_LIMIT} rows.`);
      return { rows };
    },
  )
  .handler(async ({ data }) => {
    const db = await approvedSession();
    const now = new Date().toISOString();
    let written = 0;
    for (let i = 0; i < data.rows.length; i += 500) {
      const chunk = data.rows.slice(i, i + 500).map((r) => ({
        hub: r.hub,
        delivery_date: r.date,
        price_eur_mwh: r.price,
        final: true,
        label: "import",
        source: "import",
        fetched_at: now,
      }));
      const { error } = await db
        .from("hub_price_history")
        .upsert(chunk, { onConflict: "hub,delivery_date" });
      if (error) throw new Error(`Saved ${written} rows, then failed: ${error.message}`);
      written += chunk.length;
    }
    return { written };
  });

// --- Weather: Budapest and Sofia (HU / BG demand) -----------------------------------------

export const CITIES = {
  budapest: { lat: 47.4979, lon: 19.0402 },
  sofia: { lat: 42.6977, lon: 23.3219 },
} as const;
type City = keyof typeof CITIES;

const tempCache = new Map<string, { at: number; data: Record<string, number> }>();

async function getJson(url: string): Promise<Loose> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function cityTemps(city: City, from: string, to: string): Promise<Record<string, number>> {
  const key = `${city}|${from}|${to}`;
  const hit = tempCache.get(key);
  if (hit && Date.now() - hit.at < 3 * 3600_000) return hit.data;
  const { lat, lon } = CITIES[city];
  const out: Record<string, number> = {};
  const today = new Date().toISOString().slice(0, 10);
  // Archive (ERA5) lags ~5 days; fetch it one calendar year at a time.
  const archiveEnd = to < today ? to : today;
  for (let y = Number(from.slice(0, 4)); y <= Number(archiveEnd.slice(0, 4)); y++) {
    const a = `${y}-01-01` > from ? `${y}-01-01` : from;
    const b = `${y}-12-31` < archiveEnd ? `${y}-12-31` : archiveEnd;
    const j = await getJson(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${a}&end_date=${b}&daily=temperature_2m_mean&timezone=Europe%2FBelgrade`,
    );
    (j?.daily?.time ?? []).forEach((d: string, i: number) => {
      const v = j.daily.temperature_2m_mean[i];
      if (typeof v === "number") out[d] = v;
    });
  }
  // Recent days and the 16-day forecast.
  const f = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_mean&past_days=10&forecast_days=16&timezone=Europe%2FBelgrade`,
  );
  (f?.daily?.time ?? []).forEach((d: string, i: number) => {
    const v = f.daily.temperature_2m_mean[i];
    if (typeof v === "number" && out[d] === undefined) out[d] = v;
    else if (typeof v === "number" && d >= today) out[d] = v;
  });
  tempCache.set(key, { at: Date.now(), data: out });
  return out;
}

export const fetchArbitrageWeather = createServerFn({ method: "POST" })
  .inputValidator((d: { from: string; to: string }) => {
    if (!ISO.test(d?.from ?? "") || !ISO.test(d?.to ?? "")) throw new Error("Invalid dates.");
    return d;
  })
  .handler(async ({ data }) => {
    const res: Record<City, Record<string, number>> = { budapest: {}, sofia: {} };
    const errors: string[] = [];
    await Promise.all(
      (Object.keys(CITIES) as City[]).map(async (c) => {
        try {
          res[c] = await cityTemps(c, data.from, data.to);
        } catch (err) {
          errors.push(`${c}: ${err instanceof Error ? err.message : "failed"}`);
        }
      }),
    );
    return { temps: res, error: errors.length ? errors.join("; ") : null };
  });

// --- Forecast persistence for shadow scoring ---------------------------------------------

export interface StoredForecast {
  made_on: string;
  target_date: string;
  series: "spread" | "BGH" | "CEEGEX";
  model: string;
  p50: number;
  lo: number;
  hi: number;
}

export const saveArbitrageForecast = createServerFn({ method: "POST" })
  .inputValidator((d: { rows: StoredForecast[] }) => {
    const rows = (d?.rows ?? []).slice(0, 500);
    for (const r of rows)
      if (
        !ISO.test(r.made_on) ||
        !ISO.test(r.target_date) ||
        !["spread", "BGH", "CEEGEX"].includes(r.series) ||
        ![r.p50, r.lo, r.hi].every(Number.isFinite)
      )
        throw new Error("Invalid forecast row.");
    return { rows };
  })
  .handler(async ({ data }) => {
    if (!data.rows.length) return { saved: 0 };
    const db = await approvedSession();
    const { error } = await db.from("arbitrage_forecasts").upsert(
      data.rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: "made_on,target_date,series,model" },
    );
    if (error) return { saved: 0, error: error.message };
    return { saved: data.rows.length };
  });

export const listArbitrageForecasts = createServerFn({ method: "POST" })
  .inputValidator((d: { from: string }) => {
    if (!ISO.test(d?.from ?? "")) throw new Error("Invalid from date.");
    return d;
  })
  .handler(async ({ data }) => {
    try {
      const db = await admin();
      const { data: rows, error } = await db
        .from("arbitrage_forecasts")
        .select("made_on,target_date,series,model,p50,lo,hi")
        .gte("made_on", data.from)
        .order("made_on", { ascending: true })
        .limit(5000);
      if (error) throw new Error(error.message);
      return {
        rows: (rows ?? []).map((r: Record<string, unknown>) => ({
          made_on: String(r.made_on),
          target_date: String(r.target_date),
          series: r.series as StoredForecast["series"],
          model: String(r.model),
          p50: Number(r.p50),
          lo: Number(r.lo),
          hi: Number(r.hi),
        })) as StoredForecast[],
        error: null as string | null,
      };
    } catch (err) {
      return {
        rows: [] as StoredForecast[],
        error: err instanceof Error ? err.message : "unavailable",
      };
    }
  });

// --- AI trader brief -----------------------------------------------------------------------

export const arbitrageBrief = createServerFn({ method: "POST" })
  .inputValidator((d: { facts: string }) => {
    const facts = String(d?.facts ?? "").slice(0, 12_000);
    if (!facts.trim()) throw new Error("No facts to brief on.");
    return { facts };
  })
  .handler(async ({ data }) => {
    await approvedSession();
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { generateText, Output } = await import("ai");
    const { z } = await import("zod");
    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const { output } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      output: Output.object({
        schema: z.object({
          headline: z.string(),
          view: z.enum(["BG→HU", "HU→BG", "No trade"]),
          confidence: z.enum(["low", "medium", "high"]),
          bullets: z.array(z.string()).max(6),
          risks: z.array(z.string()).max(4),
        }),
      }),
      system:
        "You are a gas trading analyst for a Serbian shipper on the Bulgaria–Serbia–Hungary corridor (Gastrans). " +
        "Use ONLY the numbers in the facts; never invent prices, flows or news. Be concise and specific. " +
        "If the facts are thin or models disagree, say so and lower confidence. Prices are EUR/MWh.",
      prompt: data.facts,
    });
    return output;
  });
