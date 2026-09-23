import { createHash } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";

export type AppSessionData = {
  authenticated?: boolean;
  signedInAt?: string;
  validatedAt?: string;
  userId?: string;
  email?: string;
  role?: "user" | "admin";
};

function sessionSecret() {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;

  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRole) {
    return createHash("sha256")
      .update(`serbia-gas-dashboard-session:${serviceRole}`)
      .digest("hex");
  }

  throw new Error(
    "SESSION_SECRET (32+ chars) or SUPABASE_SERVICE_ROLE_KEY must be configured.",
  );
}

export function useAppSession() {
  return useSession<AppSessionData>({
    name: "serbia-gas-dashboard-session",
    password: sessionSecret(),
    cookie: {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      partitioned: true,
      maxAge: 60 * 60 * 8,
      path: "/",
    },
  });
}
