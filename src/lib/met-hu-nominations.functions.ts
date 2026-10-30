import { createServerFn } from "@tanstack/react-start";
import type { MetHuNomination } from "./gas/met-nominations";

// All access goes through the app's approved server session. The database
// table is NOT exposed to anon/authenticated browser roles.
function validateGasDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid gas day.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid gas day.");
  }
  return value;
}

async function approvedSession() {
  const { useAppSession } = await import("./auth-session.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const session = await useAppSession();
  if (session.data.authenticated !== true || !session.data.userId) {
    throw new Error("You must sign in before managing MET nominations.");
  }

  const { data: account, error } = await supabaseAdmin
    .from("app_user_access")
    .select("email,status")
    .eq("user_id", session.data.userId)
    .maybeSingle();

  if (error || !account || account.status !== "approved") {
    throw new Error("Your account is not approved to access MET nominations.");
  }
  return { admin: supabaseAdmin, userId: session.data.userId, email: account.email };
}

export const listMetHuNominations = createServerFn({ method: "GET" })
  .inputValidator((data: { from: string; to: string }) => ({
    from: String(data.from ?? ""),
    to: String(data.to ?? ""),
  }))
  .handler(async ({ data }): Promise<MetHuNomination[]> => {
    const { admin } = await approvedSession();
    const from = validateGasDay(data.from);
    const to = validateGasDay(data.to);
    if (from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 730 * 86400000) {
      throw new Error("Nomination date range must be 731 days or fewer.");
    }
    const { data: rows, error } = await admin
      .from("met_hu_nominations")
      .select("gas_day,nominated_mwh,updated_at,updated_by_email")
      .gte("gas_day", from)
      .lte("gas_day", to)
      .order("gas_day", { ascending: true });

    if (error) throw new Error(`Could not load shared MET nominations: ${error.message}`);
    return (rows ?? []).map((row) => ({
      gas_day: row.gas_day,
      nominated_mwh: Number(row.nominated_mwh),
      updated_at: row.updated_at,
      updated_by_email: row.updated_by_email,
    }));
  });

export const saveMetHuNomination = createServerFn({ method: "POST" })
  .inputValidator((data: { gasDay: string; nominatedMwh: number }) => ({
    gasDay: String(data.gasDay ?? ""),
    nominatedMwh: Number(data.nominatedMwh),
  }))
  .handler(async ({ data }) => {
    const { admin, userId, email } = await approvedSession();
    const gasDay = validateGasDay(data.gasDay);
    if (!Number.isFinite(data.nominatedMwh) || data.nominatedMwh < 0 || data.nominatedMwh > 1_000_000) {
      throw new Error("MET nomination must be a valid number from 0 to 1,000,000 MWh/day.");
    }
    const { error } = await admin.from("met_hu_nominations").upsert(
      {
        gas_day: gasDay,
        nominated_mwh: Number(data.nominatedMwh.toFixed(3)),
        updated_at: new Date().toISOString(),
        updated_by: userId,
        updated_by_email: email,
      },
      { onConflict: "gas_day" },
    );
    if (error) throw new Error(`Could not save MET nomination: ${error.message}`);
    return { ok: true as const };
  });

export const removeMetHuNomination = createServerFn({ method: "POST" })
  .inputValidator((data: { gasDay: string }) => ({ gasDay: String(data.gasDay ?? "") }))
  .handler(async ({ data }) => {
    const { admin } = await approvedSession();
    const gasDay = validateGasDay(data.gasDay);
    const { error } = await admin.from("met_hu_nominations").delete().eq("gas_day", gasDay);
    if (error) throw new Error(`Could not remove MET nomination: ${error.message}`);
    return { ok: true as const };
  });
