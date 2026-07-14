import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  tone?: "default" | "positive" | "negative" | "warning";
}

export function KpiCard({ label, value, hint, delta, tone = "default" }: KpiCardProps) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-emerald-700",
    negative: "text-red-700",
    warning: "text-amber-700",
  }[tone];
  return (
    <div className="rounded-md border bg-card px-3 py-2 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", toneClass)}>{value}</div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        {hint && <span>{hint}</span>}
        {delta != null && !Number.isNaN(delta) && (
          <span className={delta >= 0 ? "text-emerald-600" : "text-red-600"}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
