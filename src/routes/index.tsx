import { createFileRoute, redirect } from "@tanstack/react-router";
import { hasAppSession } from "@/lib/auth";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (await hasAppSession()) {
      throw redirect({ to: "/balance" });
    }
    throw redirect({ to: "/login" });
  },
});
