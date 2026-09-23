import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_OWNER_EMAIL = "milan.terzic@met.com";
const AUTO_APPROVE_DOMAIN = "@met.com";

function normalizeEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function ownerEmail() {
  return normalizeEmail(process.env.NATURAL_GAS_OWNER_EMAIL ?? DEFAULT_OWNER_EMAIL);
}

function publicAuthClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase authentication is not configured on the server.");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function ensureAccess(userId: string, email: string) {
  const admin = await adminClient();
  const normalizedEmail = normalizeEmail(email);
  const isOwner = normalizedEmail === ownerEmail();
  const isMet = normalizedEmail.endsWith(AUTO_APPROVE_DOMAIN);
  const desiredStatus = isMet ? "approved" : "pending";
  const desiredRole = isOwner ? "admin" : "user";

  const { data: existing, error: lookupError } = await admin
    .from("app_user_access")
    .select("status,role,email")
    .eq("user_id", userId)
    .maybeSingle();
  if (lookupError) throw new Error(`user_access_lookup_failed: ${lookupError.message}`);

  if (!existing) {
    const { error } = await admin.from("app_user_access").insert({
      user_id: userId,
      email: normalizedEmail,
      status: desiredStatus,
      role: desiredRole,
      reviewed_at: desiredStatus === "approved" ? new Date().toISOString() : null,
    });
    if (error) throw new Error(`access_create_failed: ${error.message}`);
    return { status: desiredStatus as "approved" | "pending", role: desiredRole as "admin" | "user" };
  }

  // MET accounts remain automatically approved. The owner remains admin.
  if (isMet && (existing.status !== "approved" || existing.role !== desiredRole || existing.email !== normalizedEmail)) {
    const { error } = await admin
      .from("app_user_access")
      .update({
        email: normalizedEmail,
        status: "approved",
        role: desiredRole,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (error) throw new Error(`access_auto_approve_failed: ${error.message}`);
    return { status: "approved" as const, role: desiredRole as "admin" | "user" };
  }

  return {
    status: String(existing.status ?? "pending") as "pending" | "approved" | "rejected" | "disabled",
    role: existing.role === "admin" ? ("admin" as const) : ("user" as const),
  };
}

async function establishSession(userId: string, email: string) {
  const access = await ensureAccess(userId, email);
  if (access.status !== "approved") {
    return { ok: false as const, reason: access.status, email };
  }

  const now = new Date().toISOString();
  const { useAppSession } = await import("./auth-session.server");
  const session = await useAppSession();
  await session.update({
    authenticated: true,
    signedInAt: now,
    validatedAt: now,
    userId,
    email,
    role: access.role,
  });

  const admin = await adminClient();
  await admin
    .from("app_user_access")
    .update({ last_login_at: now, updated_at: now })
    .eq("user_id", userId);

  return { ok: true as const, email, role: access.role };
}

export const signUpAccount = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string; redirectTo?: string }) => ({
    email: normalizeEmail(data?.email),
    password: String(data?.password ?? ""),
    redirectTo: String(data?.redirectTo ?? ""),
  }))
  .handler(async ({ data }) => {
    if (!data.email || !data.password) {
      return { ok: false as const, reason: "invalid_input" as const };
    }
    if (data.password.length < 8) {
      return { ok: false as const, reason: "weak_password" as const };
    }

    const auth = publicAuthClient();
    const { data: result, error } = await auth.auth.signUp({
      email: data.email,
      password: data.password,
      options: data.redirectTo ? { emailRedirectTo: data.redirectTo } : undefined,
    });
    if (error) {
      return { ok: false as const, reason: "provider_error" as const, message: error.message };
    }
    if (!result.user?.id || !result.user.email) {
      return {
        ok: false as const,
        reason: "provider_error" as const,
        message: "Supabase did not create the account.",
      };
    }

    const access = await ensureAccess(result.user.id, result.user.email);
    return {
      ok: true as const,
      status: access.status,
      email: normalizeEmail(result.user.email),
      autoApproved: access.status === "approved",
      emailConfirmed: Boolean(result.user.email_confirmed_at ?? result.user.confirmed_at),
    };
  });

export const signInAccount = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string }) => ({
    email: normalizeEmail(data?.email),
    password: String(data?.password ?? ""),
  }))
  .handler(async ({ data }) => {
    if (!data.email || !data.password) {
      return { ok: false as const, reason: "invalid_credentials" as const };
    }

    const auth = publicAuthClient();
    const { data: result, error } = await auth.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });
    if (error || !result.user?.id || !result.user.email) {
      return {
        ok: false as const,
        reason: "invalid_credentials" as const,
        message: error?.message ?? "Invalid email or password.",
      };
    }

    return establishSession(result.user.id, normalizeEmail(result.user.email));
  });
