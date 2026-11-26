// Keeps TTF / CEGH day-ahead prices in Supabase so charts keep their history when a source
// only serves the last few days. Every failure is swallowed: without the table (migration
// not applied) the live points are returned unchanged.
import type { PricePoint } from "./parsers";

// The generated Database types do not include this table until Lovable regenerates them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const KEEP_DAYS = 120;

/** Stored + live points by delivery day; a provisional price never replaces a final one. */
export function mergeHistory(stored: PricePoint[], live: PricePoint[]): PricePoint[] {
  const byDate = new Map<string, PricePoint>();
  for (const p of stored) if (p.date) byDate.set(p.date, p);
  for (const p of live) {
    if (!p.date) continue;
    const prev = byDate.get(p.date);
    if (prev?.final && !p.final) continue;
    byDate.set(p.date, p);
  }
  return [...byDate.values()].sort((a, b) => (a.date! < b.date! ? -1 : 1));
}

export async function withStoredHistory(hub: "TTF" | "CEGH", live: PricePoint[]) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as Loose;
    const from = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await db
      .from("hub_price_history")
      .select("delivery_date,price_eur_mwh,final,label")
      .eq("hub", hub)
      .gte("delivery_date", from);
    if (error) throw new Error(error.message);
    const stored: PricePoint[] = (data ?? []).map((r: Record<string, unknown>) => ({
      date: String(r.delivery_date),
      label: String(r.label ?? r.delivery_date),
      price: Number(r.price_eur_mwh),
      final: r.final === true,
    }));
    const storedFinal = new Set(stored.filter((p) => p.final).map((p) => p.date));
    const rows = live
      .filter((p) => p.date && Number.isFinite(p.price) && !(storedFinal.has(p.date) && !p.final))
      .map((p) => ({
        hub,
        delivery_date: p.date,
        price_eur_mwh: p.price,
        final: p.final,
        label: p.label,
        fetched_at: new Date().toISOString(),
      }));
    if (rows.length) {
      const { error: upErr } = await db
        .from("hub_price_history")
        .upsert(rows, { onConflict: "hub,delivery_date" });
      if (upErr) console.warn(`[hub-history] ${hub}: save failed: ${upErr.message}`);
    }
    return mergeHistory(stored, live);
  } catch (err) {
    console.warn(
      `[hub-history] ${hub}: ${err instanceof Error ? err.message : "history unavailable"}`,
    );
    return live;
  }
}
