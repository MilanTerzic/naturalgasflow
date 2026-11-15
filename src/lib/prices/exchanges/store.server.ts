// Supabase persistence for exchange prices (service_role, server only).
// Idempotent upserts on the natural key; every failure is reported, never thrown, so a
// missing table (migration not applied yet) degrades to in-memory operation.

import type {
  ExchangeMarket,
  GasPriceObservation,
  ObservationStatus,
  ProviderResult,
} from "./types";

// The generated Database types do not include these tables until Lovable regenerates them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

async function admin(): Promise<Loose> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Loose;
}

export interface FeedStatusRow {
  market: ExchangeMarket;
  last_attempt_at: string;
  last_success_at: string | null;
  status: ObservationStatus;
  message: string | null;
  diagnostics: Record<string, unknown> | null;
}

export function toRow(o: GasPriceObservation) {
  return {
    market: o.market,
    country: o.country,
    trading_date: o.tradingDate,
    delivery_date: o.deliveryDate,
    delivery_end_date: o.deliveryEndDate ?? null,
    product: o.product,
    metric: o.metric,
    price_eur_mwh: o.priceEurMwh,
    original_price: o.originalPrice ?? null,
    original_currency: o.originalCurrency ?? null,
    fx_rate: o.fxRate ?? null,
    fx_date: o.fxDate ?? null,
    volume_mwh: o.volumeMwh,
    trades: o.trades,
    source_url: o.sourceUrl,
    source_version: o.sourceVersion ?? null,
    status: o.status,
    fetched_at: o.fetchedAt,
    updated_at: new Date().toISOString(),
  };
}

export function fromRow(r: Record<string, unknown>): GasPriceObservation {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    market: r.market as ExchangeMarket,
    country: r.country as GasPriceObservation["country"],
    tradingDate: String(r.trading_date),
    deliveryDate: String(r.delivery_date),
    ...(r.delivery_end_date ? { deliveryEndDate: String(r.delivery_end_date) } : {}),
    product: String(r.product),
    metric: String(r.metric),
    priceEurMwh: num(r.price_eur_mwh),
    originalPrice: num(r.original_price),
    originalCurrency: (r.original_currency as string) ?? undefined,
    fxRate: num(r.fx_rate),
    fxDate: (r.fx_date as string) ?? null,
    volumeMwh: num(r.volume_mwh),
    trades: num(r.trades),
    sourceUrl: String(r.source_url),
    sourceVersion: (r.source_version as string) ?? null,
    status: r.status as ObservationStatus,
    fetchedAt: String(r.fetched_at),
  };
}

export async function loadObservations(
  since: string,
): Promise<{ ok: true; rows: GasPriceObservation[] } | { ok: false; reason: string }> {
  try {
    const db = await admin();
    const { data, error } = await db
      .from("gas_price_observations")
      .select("*")
      .gte("delivery_date", since)
      .order("delivery_date", { ascending: true })
      .limit(5000);
    if (error) return { ok: false, reason: error.message };
    return { ok: true, rows: (data ?? []).map(fromRow) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "database unavailable" };
  }
}

export async function loadFeedStatus(): Promise<Map<ExchangeMarket, FeedStatusRow>> {
  const out = new Map<ExchangeMarket, FeedStatusRow>();
  try {
    const db = await admin();
    const { data } = await db.from("gas_price_feed_status").select("*");
    for (const r of data ?? []) out.set(r.market, r as FeedStatusRow);
  } catch {
    /* table missing → empty */
  }
  return out;
}

/** Upserts observations and the feed status. Returns an error message or null. */
export async function saveResult(
  result: ProviderResult,
  prevSuccess: string | null,
): Promise<string | null> {
  try {
    const db = await admin();
    const rows = result.observations.map(toRow);
    if (rows.length) {
      const { error } = await db
        .from("gas_price_observations")
        .upsert(rows, { onConflict: "market,product,metric,trading_date,delivery_date" });
      if (error) return error.message;
    }
    const success = result.observations.length ? result.fetchedAt : prevSuccess;
    const { error } = await db.from("gas_price_feed_status").upsert(
      {
        market: result.market,
        last_attempt_at: result.fetchedAt,
        last_success_at: success,
        status: result.status,
        message: result.message ?? null,
        diagnostics: JSON.parse(JSON.stringify(result.diagnostics ?? {})),
      },
      { onConflict: "market" },
    );
    return error ? error.message : null;
  } catch (err) {
    return err instanceof Error ? err.message : "database unavailable";
  }
}
