import { createServerFn } from "@tanstack/react-start";

/**
 * Opens the newsletter page for the email job without a login session. Accepts only the
 * shared NEWSLETTER_TOKEN set on the server; with no token configured nothing is accepted.
 */
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
