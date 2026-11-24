import { createFileRoute, redirect } from "@tanstack/react-router";
import { hasAppSession } from "@/lib/auth";
import { pageMetadata } from "@/lib/page-metadata";

export const Route = createFileRoute("/")({
  head: () => ({ meta: pageMetadata("Natural Gas Flow — Serbia Dashboard", "Serbian gas balance, cross-border capacity and regional gas flow analysis.") }),
  beforeLoad: async () => {
    if (await hasAppSession()) {
      throw redirect({ to: "/balance" });
    }
    throw redirect({ to: "/login" });
  },
});
