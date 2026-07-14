import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CalendarDays, ChevronDown, Clock3, Database } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { CompositionChart } from "@/components/dashboard/CompositionChart";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { MobileControlsSheet } from "@/components/dashboard/Sidebar";
import { StorageChart } from "@/components/dashboard/StorageChart";
import { TemperatureChart } from "@/components/dashboard/TemperatureChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtShortDateYear } from "@/lib/gas/format";
import type { BalanceRow } from "@/lib/gas/types";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/state/dashboard-context";
import { useDashboardData } from "@/state/use-dashboard-data";

export const Route = createFileRoute("/_dash/balance")({
  head: () => ({
    meta: [
      { title: "Serbian Gas Balance - Serbia Gas Dashboard" },
      {
        name: "description",
        content:
          "Daily Serbian gas balance: supply composition, temperature and storage requirement.",
      },
    ],
  }),
  component: BalancePage,
});

function BalancePage() {
  const { balance, today, warnings, isLoading, todayFallback, refreshedAt } = useDashboardData();
  const { mode } = useDashboard();
  const selected = getSelectedRow(balance, today);
  const freshness = getFreshnessLabel({
    mode,
    todayFallback,
    refreshedAt,
    selectedDate: selected?.date,
  });

  return (
    <div className="space-y-4">
      <BalancePageHeader
        selectedDate={selected?.date ?? today}
        mode={mode}
        freshness={freshness}
        isLoading={isLoading}
      />

      {warnings.length > 0 && <WarningNotice warnings={warnings} />}

      {isLoading ? (
        <BalanceLoadingSkeleton />
      ) : (
        <>
          <KpiRow balance={balance} today={today} />
          <section className="grid gap-4">
            <ChartCard
              title="Serbian gas supply and demand"
              description="Daily available supply by source compared with required demand - mcm/day"
              height={380}
            >
              <CompositionChart data={balance} today={today} />
            </ChartCard>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <ChartCard
                title="Belgrade temperature and demand driver"
                description="Observed and forecast daily temperature - °C"
                height={260}
              >
                <TemperatureChart data={balance} today={today} />
              </ChartCard>
              <ChartCard
                title="Daily gas balance"
                description="Estimated balancing requirement: positive values indicate surplus; negative values indicate storage withdrawal requirement - mcm/day"
                height={260}
              >
                <StorageChart data={balance} today={today} />
              </ChartCard>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function BalancePageHeader({
  selectedDate,
  mode,
  freshness,
  isLoading,
}: {
  selectedDate: string;
  mode: "dummy" | "live";
  freshness: string;
  isLoading: boolean;
}) {
  return (
    <section className="rounded-lg border bg-card px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Serbian Gas Balance
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Daily supply, demand, cross-border flows and estimated storage balancing requirement.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <InfoPill
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            label={fmtShortDateYear(selectedDate)}
          />
          <Badge
            variant="outline"
            className={cn(
              "gap-1 border px-2 py-1 text-xs font-medium",
              mode === "live"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-slate-50 text-slate-700",
            )}
          >
            <Database className="h-3.5 w-3.5" />
            {mode === "live" ? "Live Data" : "Demo Data"}
          </Badge>
          <InfoPill
            icon={<Clock3 className="h-3.5 w-3.5" />}
            label={isLoading ? "Refreshing live data" : freshness}
          />
          <MobileControlsSheet className="lg:hidden" />
        </div>
      </div>
    </section>
  );
}

function InfoPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium text-muted-foreground">
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </div>
  );
}

function WarningNotice({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false);
  const hasMultiple = warnings.length > 1;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-amber-950"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {hasMultiple ? `${warnings.length} data notices` : "Data notice"}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-900">{warnings[0]}</p>
        </div>
        {hasMultiple && (
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2 text-amber-900 hover:bg-amber-100"
              aria-label={open ? "Hide warning details" : "Show warning details"}
            >
              Details
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
              />
            </Button>
          </CollapsibleTrigger>
        )}
      </div>
      {hasMultiple && (
        <CollapsibleContent>
          <ul className="mt-2 space-y-1 border-t border-amber-200 pt-2 text-xs leading-relaxed text-amber-900">
            {warnings.slice(1).map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function BalanceLoadingSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading balance dashboard">
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.25fr]">
        <Skeleton className="h-[132px] rounded-lg" />
        <Skeleton className="h-[132px] rounded-lg" />
        <Skeleton className="h-[150px] rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[112px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[430px] rounded-lg" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Skeleton className="h-[310px] rounded-lg" />
        <Skeleton className="h-[310px] rounded-lg" />
      </div>
    </div>
  );
}

function getSelectedRow(balance: BalanceRow[], today: string) {
  const todayRow = balance.find((r) => r.date === today);
  return todayRow ?? balance[balance.length - 1];
}

function getFreshnessLabel({
  mode,
  todayFallback,
  refreshedAt,
  selectedDate,
}: {
  mode: "dummy" | "live";
  todayFallback: boolean;
  refreshedAt: string;
  selectedDate?: string;
}) {
  if (mode === "dummy") return "Demo dataset";
  if (todayFallback) return "Latest flows carried forward";
  if (refreshedAt) return `Data through ${fmtShortDateYear(refreshedAt)}`;
  if (selectedDate) return `Selected ${fmtShortDateYear(selectedDate)}`;
  return "Awaiting live data";
}
