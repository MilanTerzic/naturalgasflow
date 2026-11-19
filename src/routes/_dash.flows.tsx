import { createFileRoute, redirect } from "@tanstack/react-router";

// The Flow Details page was merged into the Balkan Map; keep old links working.
export const Route = createFileRoute("/_dash/flows")({
  beforeLoad: () => {
    throw redirect({ to: "/region", replace: true });
  },
});
