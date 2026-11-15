import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { PALETTE, POINTS } from "@/lib/gas/config";
import { fmtMcm, fmtShortDate } from "@/lib/gas/format";
import { netRemainingInSerbiaMcm } from "@/lib/gas/flow-metrics";
import type { FlowPointName } from "@/lib/gas/types";
import { pointSource } from "@/lib/region/map-model";
import { useDashboard } from "@/state/dashboard-context";
import { useDashboardData } from "@/state/use-dashboard-data";
import { cn } from "@/lib/utils";

const ORDER: Array<{ key: FlowPointName; short: string; dir: string; color: string }> = [
  { key: "kireevo", short: "Kireevo", dir: "BG→RS", color: PALETTE.bgImport },
  { key: "kalotina", short: "Kalotina", dir: "BG→RS", color: PALETTE.kalotina },
  { key: "kiskundorozsma_hu", short: "Kiskundorozsma", dir: "HU→RS", color: PALETTE.huOthers },
  { key: "kiskundorozsma_2", short: "Horgoš", dir: "RS→HU", color: PALETTE.huMet },
];

/**
 * Always-visible ribbon with the latest ENTSOG Allocation per Serbian border point and
 * the net gas staying in Serbia, plus the change on the previous gas day.
 * Reuses the dashboard's cached queries — no extra requests.
 */
export function FlowTape() {
  const { mode } = useDashboard();
  const { allocations, balance, today, isLoading } = useDashboardData();

  const { row, prev } = useMemo(() => {
    const past = allocations
      .filter((r) => r.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    return { row: past.at(-1), prev: past.at(-2) };
  }, [allocations, today]);

  const bosnia = (date?: string) =>
    balance.find((b) => b.date === date)?.bosnia_consumption_mcm ?? null;
  const net = netRemainingInSerbiaMcm(row, bosnia(row?.date));
  const netPrev = netRemainingInSerbiaMcm(prev, bosnia(prev?.date));

  return (
    <div className="flex h-9 items-stretch overflow-hidden border-t bg-[var(--surface-2)]/60 text-xs print:hidden">
      <Link
        to="/region"
        className="flex shrink-0 flex-col justify-center border-r px-3 leading-none transition-colors hover:bg-accent"
        title="Latest ENTSOG Allocation, mcm/day. Open the Balkan flow map."
      >
        <span className="eyebrow !text-[9.5px]">Allocation · mcm/d</span>
        <span
          className={cn(
            "num mt-0.5 text-[11px]",
            mode === "dummy" ? "text-[var(--status-serious)]" : "text-ink-2",
          )}
        >
          {mode === "dummy"
            ? "DEMO DATA"
            : row
              ? fmtShortDate(row.date)
              : isLoading
                ? "loading…"
                : "—"}
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
        {ORDER.map(({ key, short, dir, color }) => {
          const source = pointSource(row, key, "allocation");
          const value = source ? row![key] : null;
          const prevValue = pointSource(prev, key, "allocation") ? prev![key] : null;
          const delta = value !== null && prevValue !== null ? value - prevValue : null;
          return (
            <Link
              key={key}
              to="/region"
              title={`${POINTS[key]}${source && source !== "allocation" ? ` · ${source} (provisional)` : ""}`}
              className="flex shrink-0 items-center gap-2 border-r px-3 transition-colors hover:bg-accent"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: color }} />
              <span className="font-[family-name:var(--font-condensed)] font-semibold tracking-wide text-ink-2">
                {short}
              </span>
              <span className="text-[10px] text-muted-foreground">{dir}</span>
              <span
                className={cn(
                  "num text-[13px] text-foreground",
                  source && source !== "allocation" && "italic",
                )}
              >
                {value === null ? "—" : fmtMcm(value)}
              </span>
              {delta !== null && Math.abs(delta) >= 0.01 && (
                <span
                  className={cn(
                    "num text-[10px]",
                    delta > 0 ? "text-[var(--status-good)]" : "text-[var(--status-critical)]",
                  )}
                >
                  {delta > 0 ? "▲" : "▼"}
                  {Math.abs(delta).toFixed(2)}
                </span>
              )}
            </Link>
          );
        })}
        <Link
          to="/region"
          title="Kalotina + Kireevo + Kiskundorozsma − Kiskundorozsma 2 − Bosnia (model). Shown only when all points reported."
          className="flex shrink-0 items-center gap-2 border-r px-3 transition-colors hover:bg-accent"
        >
          <span className="font-[family-name:var(--font-condensed)] font-semibold tracking-wide text-[var(--flow)]">
            Net in Serbia
          </span>
          <span className="num text-[13px] font-semibold text-foreground">
            {net === null ? "—" : fmtMcm(net)}
          </span>
          {net !== null && netPrev !== null && Math.abs(net - netPrev) >= 0.01 && (
            <span
              className={cn(
                "num text-[10px]",
                net - netPrev > 0 ? "text-[var(--status-good)]" : "text-[var(--status-critical)]",
              )}
            >
              {net - netPrev > 0 ? "▲" : "▼"}
              {Math.abs(net - netPrev).toFixed(2)}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}
