import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  tone?: "default" | "positive" | "negative" | "warning";
  unit?: string;
  variant?: "primary" | "secondary" | "balance";
  icon?: ReactNode;
  status?: string;
  emphasis?: "normal" | "strong";
  estimated?: boolean;
}

export function KpiCard({
  label,
  value,
  hint,
  delta,
  tone = "default",
  unit,
  variant = "secondary",
  icon,
  status,
  emphasis = "normal",
  estimated = false,
}: KpiCardProps) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-emerald-700",
    negative: "text-rose-700",
    warning: "text-amber-700",
  }[tone];

  const surfaceClass = {
    primary: "min-h-[132px] p-4",
    secondary: "min-h-[112px] p-3",
    balance: cn(
      "min-h-[150px] p-4 ring-1",
      tone === "positive" && "border-emerald-200 bg-emerald-50/50 ring-emerald-100",
      tone === "negative" && "border-rose-200 bg-rose-50/50 ring-rose-100",
      tone === "warning" && "border-amber-200 bg-amber-50/50 ring-amber-100",
      tone === "default" && "ring-primary/10",
    ),
  }[variant];

  const valueClass =
    variant === "secondary"
      ? "text-lg leading-tight"
      : emphasis === "strong"
        ? "text-3xl leading-none"
        : "text-2xl leading-none";

  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        surfaceClass,
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 text-xs font-medium text-muted-foreground">{label}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {estimated && (
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-800"
            >
              Estimated
            </Badge>
          )}
          {icon && <div className="text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</div>}
        </div>
      </div>
      {status && (
        <div
          className={cn(
            "mt-3 inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide",
            tone === "positive" && "border-emerald-200 bg-emerald-100 text-emerald-800",
            tone === "negative" && "border-rose-200 bg-rose-100 text-rose-800",
            tone === "warning" && "border-amber-200 bg-amber-100 text-amber-800",
            tone === "default" && "border-primary/15 bg-primary/10 text-primary",
          )}
        >
          {status}
        </div>
      )}
      <div
        className={cn(
          "mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-semibold tabular-nums",
          toneClass,
          valueClass,
        )}
      >
        <span>{value}</span>
        {unit && <span className="text-xs font-medium text-muted-foreground">{unit}</span>}
      </div>
      <div className="mt-2 flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-snug text-muted-foreground">
        {hint && <span className="min-w-0">{hint}</span>}
        {delta != null && !Number.isNaN(delta) && (
          <span
            aria-label={`Day over day ${delta >= 0 ? "increase" : "decrease"} ${Math.abs(delta).toFixed(2)}`}
            className={cn(
              "font-medium tabular-nums",
              delta >= 0 ? "text-emerald-700" : "text-rose-700",
            )}
          >
            {delta >= 0 ? "+" : "-"}
            {Math.abs(delta).toFixed(2)} d/d
          </span>
        )}
      </div>
    </div>
  );
}
