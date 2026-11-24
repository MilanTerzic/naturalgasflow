import { createFileRoute, redirect } from "@tanstack/react-router";
import { pageMetadata } from "@/lib/page-metadata";

// The Flow Details page was merged into the Balkan Map; keep old links working.
export const Route = createFileRoute("/_dash/flows")({
  head: () => ({ meta: pageMetadata("Flow Details — Serbia Gas Dashboard", "Daily Serbian border flows and entry-minus-exit analysis on the Balkan map.") }),
  beforeLoad: () => {
    throw redirect({ to: "/region", replace: true });
  },
});
