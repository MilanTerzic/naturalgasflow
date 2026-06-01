import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Lock } from "lucide-react";
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
  { to: "/model", label: "Model & Assumptions" },
] as const;

function DashLayout() {
  return (
    <DashboardProvider>
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card">
          <div className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                Serbia Gas Balance & Capacity Dashboard
              </h1>
              <p className="text-xs text-muted-foreground">
                Natural gas flows, demand forecast and cross-border capacity bookings.
              </p>
            </div>
            <nav className="flex flex-wrap gap-1">
              {TABS.map((t) => (
                <Link
                  key={t.to}
                  to={t.to}
                  className={cn(
                    "rounded px-3 py-1.5 text-sm transition-colors",
                    "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  activeProps={{
                    className:
                      "rounded px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary",
                  }}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <div className="flex flex-col lg:flex-row">
          <Sidebar />
          <main className="min-w-0 flex-1 space-y-4 p-4">
            <Outlet />
          </main>
        </div>
      </div>
    </DashboardProvider>
  );
}
