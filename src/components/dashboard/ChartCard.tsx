import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ChartCard({
  title,
  subtitle,
  children,
  className,
  height = 320,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  height?: number;
}) {
  return (
    <div className={cn("rounded-md border bg-card p-3 shadow-sm", className)}>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      <div style={{ height }}>{children}</div>
    </div>
  );
}
