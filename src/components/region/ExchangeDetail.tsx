// One exchange feed's detail line in the Hub spot prices panel.
import type { ExchangeSummary } from "@/lib/prices/exchanges/run";
import { cn } from "@/lib/utils";

const EXCHANGE_STATUS_TEXT: Record<string, string> = {
  OK: "OK",
  STALE: "stale",
  NO_TRADES: "no trades",
  NOT_PUBLISHED: "not published",
  SOURCE_UNAVAILABLE: "source down",
  PARSE_ERROR: "format changed",
  LICENCE_REQUIRED: "access needed",
};

function fmtTime(isoTs: string | null) {
  if (!isoTs) return "never";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoTs));
}

/** Detail line for an exchange feed: metric, delivery day, change, volume, freshness. */
export function ExchangeDetail({ ex }: { ex: ExchangeSummary }) {
  const p = ex.latest;
  const tone =
    ex.status === "OK"
      ? "text-[var(--status-good)]"
      : ex.status === "STALE"
        ? "text-[var(--status-warning)]"
        : "text-muted-foreground";
  return (
    <span className="col-span-2 space-y-0.5 text-[10px] leading-snug text-muted-foreground">
      {p && (
        <span className="block">
          {p.metric}
          {p.multiDay ? ` (${p.product})` : ""} · delivery {p.deliveryDate} · traded {p.tradingDate}
          {ex.change !== null && (
            <span className="num">
              {" "}
              · {ex.change >= 0 ? "▲" : "▼"}
              {Math.abs(ex.change).toFixed(2)}
            </span>
          )}
          {p.volumeMwh !== null && (
            <span className="num"> · {Math.round(p.volumeMwh).toLocaleString("en-GB")} MWh</span>
          )}
          {p.originalCurrency && p.originalCurrency !== "EUR" && p.originalPrice != null && (
            <span className="num">
              {" "}
              · {p.originalPrice.toFixed(2)} {p.originalCurrency}/MWh @ {p.fxRate?.toFixed(4)}
            </span>
          )}
        </span>
      )}
      <span className="block">
        <span className={cn("font-semibold uppercase", tone)}>
          {EXCHANGE_STATUS_TEXT[ex.status] ?? ex.status}
        </span>{" "}
        · last success {fmtTime(ex.lastSuccessAt)}
        {!p && ex.message && <span className="block">{ex.message}</span>}
      </span>
    </span>
  );
}
