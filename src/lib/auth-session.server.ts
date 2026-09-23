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
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
  }
  return secret;
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
