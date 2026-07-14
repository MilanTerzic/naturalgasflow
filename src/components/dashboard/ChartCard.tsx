import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ChartCard({
  title,
  subtitle,
  description,
  children,
  className,
  height = 320,
  status,
  action,
  legend,
}: {
  title: string;
  subtitle?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  height?: number;
  status?: ReactNode;
  action?: ReactNode;
  legend?: ReactNode;
}) {
  const descriptionText = description ?? subtitle;

  return (
    <section
      className={cn(
        "rounded-lg border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      <div className="mb-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
            {status}
          </div>
          {descriptionText && (
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {descriptionText}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div aria-label={descriptionText ?? title} style={{ height }}>
        {children}
      </div>
      {legend && <div className="mt-3">{legend}</div>}
    </section>
  );
}
