import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Fuel, Lock } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { lockApp } from "@/components/PasswordGate";
import { DashboardProvider } from "@/state/dashboard-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_dash")({
  component: DashLayout,
});

const TABS = [
  { to: "/balance", label: "Gas Balance" },
  { to: "/flows", label: "Flow Details" },
  { to: "/capacity", label: "Capacity Bookings" },
  { to: "/srbijagas", label: "Srbijagas Full Supply" },
  { to: "/model", label: "Model & Assumptions" },
] as const;

function DashLayout() {
  return (
    <DashboardProvider>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90">
          <div className="flex flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-primary">
                <Fuel className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
                  Serbia Gas Balance & Capacity Dashboard
                </h1>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Natural gas flows, demand forecast and cross-border capacity bookings.
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <nav
                aria-label="Dashboard sections"
                className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 pb-1"
              >
                {TABS.map((t) => (
                  <Link
                    key={t.to}
                    to={t.to}
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center rounded-md border-b-2 border-transparent px-3 text-sm font-medium transition-colors",
                      "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    )}
                    activeProps={{
                      className:
                        "bg-primary/10 text-primary border-primary hover:bg-primary/10 hover:text-primary",
                    }}
                  >
                    {t.label}
                  </Link>
                ))}
              </nav>
              <button
                type="button"
                onClick={lockApp}
                aria-label="Lock the app"
                title="Lock the app"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Lock className="h-3.5 w-3.5" />
                Lock
              </button>
            </div>
          </div>
        </header>
        <div className="flex flex-col lg:flex-row">
          <Sidebar />
          <main className="min-w-0 flex-1 space-y-4 p-3 sm:p-4 lg:p-5">
            <Outlet />
          </main>
        </div>
      </div>
    </DashboardProvider>
  );
}
