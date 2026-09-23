import { createServerFn } from "@tanstack/react-start";

async function currentApprovedAccess(userId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_user_access")
      .select("status,role,email")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data || data.status !== "approved") return null;
    return {
      role: data.role === "admin" ? ("admin" as const) : ("user" as const),
      email: data.email ?? null,
    };
  } catch {
    return null;
  }
}

export const hasAppSession = createServerFn({ method: "GET" }).handler(async () => {
  const { useAppSession } = await import("./auth-session.server");
  const session = await useAppSession();

  if (session.data.authenticated !== true || !session.data.userId) return false;

  const access = await currentApprovedAccess(session.data.userId);
  if (!access) {
    await session.clear();
    return false;
  }

  await session.update({
    ...session.data,
    validatedAt: new Date().toISOString(),
    role: access.role,
    email: access.email ?? session.data.email,
  });
  return true;
});

export const getCurrentAccount = createServerFn({ method: "GET" }).handler(async () => {
  const { useAppSession } = await import("./auth-session.server");
  const session = await useAppSession();
  if (session.data.authenticated !== true || !session.data.userId) {
    return { authenticated: false as const };
  }

  const access = await currentApprovedAccess(session.data.userId);
  if (!access) {
    await session.clear();
    return { authenticated: false as const };
  }

  return {
    authenticated: true as const,
    email: access.email ?? session.data.email ?? "",
    role: access.role,
  };
});

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { useAppSession } = await import("./auth-session.server");
  const session = await useAppSession();
  await session.clear();
  return { ok: true as const };
});
