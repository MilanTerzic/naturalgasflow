import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { entsogRecords, readThroughEntsog, type EntsogRecord, type EntsogStore } from "./entsog-cache";

// In-flight coordination only; observations live in the database, never in worker memory.
let active = 0;
const waiting: Array<() => void> = [];
async function limited<T>(work: () => PromiseLike<T>): Promise<T> {
  if (active >= 5) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try { return await work(); }
  finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

function publicClient() {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'] ?? import.meta.env.VITE_SUPABASE_URL;
  const key = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['VITE_SUPABASE_PUBLISHABLE_KEY'] ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("ENTSOG saved-data connection unavailable");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => limited(() => {
      const headers = new Headers(init?.headers);
      if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
      headers.set("apikey", key);
      return fetch(input, { ...init, headers });
    }) },
  });
}

async function upstream(url: string, init?: RequestInit): Promise<unknown> {
  return limited(async () => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
    if (response.status === 404) return {};
    if (!response.ok) throw new Error(`ENTSOG HTTP ${response.status}`);
    return response.json();
  });
}

export async function cachedEntsogFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input);
  if (url.origin !== "https://transparency.entsog.eu" || !url.pathname.startsWith("/api/v1/"))
    throw new Error("Invalid ENTSOG endpoint");
  const client = publicClient();
  if (!url.searchParams.has("from")) {
    const cacheKey = url.toString();
    const { data, error } = await client.from("entsog_reference_cache").select("payload").eq("cache_key", cacheKey).maybeSingle();
    if (error) throw error;
    if (data) return Response.json(data.payload);
    const payload = await upstream(input, init);
    if (entsogRecords(payload).length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: saveError } = await limited(() => supabaseAdmin.from("entsog_reference_cache").upsert(
        { cache_key: cacheKey, payload: payload as Json }, { onConflict: "cache_key", ignoreDuplicates: true },
      ));
      if (saveError) throw saveError;
    }
    return Response.json(payload);
  }
  const store: EntsogStore = {
    read: async (keys, from, to) => {
      const result: Awaited<ReturnType<EntsogStore['read']>> = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.from("entsog_daily_cache")
          .select("series_key,gas_day,records").in("series_key", keys).gte("gas_day", from).lte("gas_day", to)
          .order("series_key").order("gas_day").range(offset, offset + 999);
        if (error) throw error;
        result.push(...data.map((day) => ({ ...day, records: day.records as EntsogRecord[] })));
        if (data.length < 1000) return result;
      }
    },
    save: async (days) => {
      // Only validated records from the fixed public ENTSOG host enter this privileged write.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      for (let offset = 0; offset < days.length; offset += 250) {
        const { error } = await limited(() => supabaseAdmin.from("entsog_daily_cache").upsert(
          days.slice(offset, offset + 250).map((day) => ({ ...day, records: day.records as Json })),
          { onConflict: "series_key,gas_day", ignoreDuplicates: true },
        ));
        if (error) throw error;
      }
    },
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const rows = await readThroughEntsog(input, store, (query) => upstream(query, init), today);
  const field = url.pathname.toLowerCase().includes("aggregated") ? "aggregatedData" : "operationaldata";
  return Response.json({ [field]: rows });
}