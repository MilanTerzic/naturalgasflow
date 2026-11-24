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
