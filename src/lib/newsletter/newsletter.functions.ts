import { createServerFn } from "@tanstack/react-start";

/**
 * Opens the newsletter page for the email job without a login session. Accepts only the
 * shared NEWSLETTER_TOKEN set on the server; with no token configured nothing is accepted.
 */
async function tokenMatches(token: string) {
  const expected = process.env.NEWSLETTER_TOKEN?.trim();
  if (!expected) return false;
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(token.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * MET Hungary nominations for the newsletter's Srbijagas HU storage chart. Same rows as the
 * dashboard's session-protected read, but authorised by the newsletter token.
 */
export const listNewsletterMetNominations = createServerFn({ method: "POST" })
  .inputValidator((data: { token?: string; from: string; to: string }) => ({
    token: String(data?.token ?? ""),
    from: String(data?.from ?? ""),
    to: String(data?.to ?? ""),
  }))
  .handler(async ({ data }) => {
    if (!(await tokenMatches(data.token))) throw new Error("Invalid newsletter link");
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(data.from) || !day.test(data.to) || data.from > data.to)
      throw new Error("Invalid gas day range");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("met_hu_nominations")
      .select("gas_day,nominated_mwh")
      .gte("gas_day", data.from)
      .lte("gas_day", data.to)
      .order("gas_day", { ascending: true });
    if (error) throw new Error(`Could not load MET nominations: ${error.message}`);
    return (rows ?? []).map((r) => ({
      gas_day: r.gas_day,
      nominated_mwh: Number(r.nominated_mwh),
    }));
  });

export const checkNewsletterToken = createServerFn({ method: "POST" })
  .inputValidator((data: { token?: string } | undefined) => ({ token: data?.token ?? "" }))
  .handler(async ({ data }) => {
    const expected = process.env.NEWSLETTER_TOKEN?.trim();
    if (!expected)
      return { ok: false as const, reason: "NEWSLETTER_TOKEN is not set on the server" };
    const { timingSafeEqual } = await import("node:crypto");
    const a = Buffer.from(data.token.trim());
    const b = Buffer.from(expected);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    return ok ? { ok: true as const } : { ok: false as const, reason: "Invalid newsletter link" };
  });

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const belgradeToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(new Date());
const numOrNull = (v: unknown) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);

export interface StoredD1Forecast {
  made_on: string;
  forecast_for: string;
  net_mcm: number;
  demand_mcm: number | null;
  temperature_c: number | null;
  kkd_booked_mcm: number | null;
}

/**
 * Saves today's D+1 expectation so tomorrow's newsletter can check it against the actual
 * flow. Only the real current day is saved (test renders with ?today= are ignored); a later
 * render of the same day overwrites the earlier one, so the stored value is the one sent.
 */
export const saveNewsletterD1Forecast = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      token?: string;
      made_on: string;
      forecast_for: string;
      net_mcm: number;
      demand_mcm: number | null;
      temperature_c: number | null;
      kkd_booked_mcm: number | null;
    }) => ({
      token: String(data?.token ?? ""),
      made_on: String(data?.made_on ?? ""),
      forecast_for: String(data?.forecast_for ?? ""),
      net_mcm: numOrNull(data?.net_mcm),
      demand_mcm: numOrNull(data?.demand_mcm),
      temperature_c: numOrNull(data?.temperature_c),
      kkd_booked_mcm: numOrNull(data?.kkd_booked_mcm),
    }),
  )
  .handler(async ({ data }) => {
    if (!(await tokenMatches(data.token))) throw new Error("Invalid newsletter link");
    if (!ISO_DAY.test(data.made_on) || !ISO_DAY.test(data.forecast_for))
      throw new Error("Invalid gas day");
    if (data.net_mcm === null) return { saved: false, reason: "no expectation" };
    if (data.made_on !== belgradeToday()) return { saved: false, reason: "not today" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { error } = await db.from("newsletter_d1_forecasts").upsert(
      {
        made_on: data.made_on,
        forecast_for: data.forecast_for,
        net_mcm: data.net_mcm,
        demand_mcm: data.demand_mcm,
        temperature_c: data.temperature_c,
        kkd_booked_mcm: data.kkd_booked_mcm,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "made_on,forecast_for" },
    );
    if (error) return { saved: false, reason: error.message };
    return { saved: true };
  });

/**
 * Stored D+1 expectations for gas days from..to: per gas day, the latest one made before
 * that day. A missing table (migration not applied) is "nothing stored", not a failure.
 */
export const listNewsletterD1Forecasts = createServerFn({ method: "POST" })
  .inputValidator((data: { token?: string; from: string; to: string }) => ({
    token: String(data?.token ?? ""),
    from: String(data?.from ?? ""),
    to: String(data?.to ?? ""),
  }))
  .handler(async ({ data }): Promise<{ rows: StoredD1Forecast[]; error?: string }> => {
    if (!(await tokenMatches(data.token))) throw new Error("Invalid newsletter link");
    if (!ISO_DAY.test(data.from) || !ISO_DAY.test(data.to) || data.from > data.to)
      throw new Error("Invalid gas day range");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data: rows, error } = await db
      .from("newsletter_d1_forecasts")
      .select("made_on,forecast_for,net_mcm,demand_mcm,temperature_c,kkd_booked_mcm")
      .gte("forecast_for", data.from)
      .lte("forecast_for", data.to)
      .order("made_on", { ascending: false });
    if (error) return { rows: [], error: error.message };
    const best = new Map<string, StoredD1Forecast>();
    for (const r of rows ?? []) {
      const forDay = String(r.forecast_for);
      const madeOn = String(r.made_on);
      if (madeOn >= forDay || best.has(forDay)) continue;
      best.set(forDay, {
        made_on: madeOn,
        forecast_for: forDay,
        net_mcm: Number(r.net_mcm),
        demand_mcm: numOrNull(r.demand_mcm),
        temperature_c: numOrNull(r.temperature_c),
        kkd_booked_mcm: numOrNull(r.kkd_booked_mcm),
      });
    }
    return { rows: [...best.values()] };
  });
