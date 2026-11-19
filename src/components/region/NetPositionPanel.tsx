// Country net position table: imports + storage + production + LNG − exports,
// with reported consumption and the gap between them.
import { balanceGap, type NetRow } from "@/lib/region/net-position-view";
import { cn } from "@/lib/utils";

export function NetPositionPanel({
  rows,
  fmt,
  unitLabel,
  heading,
  loading,
  demo,
  failed,
  indicator,
}: {
  rows: NetRow[];
  fmt: (mcm: number | null | undefined, digits?: number) => string;
  unitLabel: string;
  heading: string;
  loading: boolean;
  demo: boolean;
  failed: string[];
  /** ENTSOG indicator behind the flows, e.g. "physical flow" or "allocation". */
  indicator: string;
}) {
  const signed = (v: number | null | undefined) =>
    v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v), 1)}`;
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="eyebrow">Country net position</h3>
        <span className="text-[10px] text-muted-foreground">
          {heading} · {unitLabel} · {indicator}
        </span>
      </div>
      {demo ? (
        <p className="text-xs text-muted-foreground">Switch to live data to see net positions.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="num w-full min-w-[480px] text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-1 py-1 font-medium">Country</th>
                <th
                  className="px-1 py-1 text-right font-semibold text-foreground"
                  title="Imports + storage + production + LNG − exports"
                >
                  Net
                </th>
                <th className="px-1 py-1 text-right font-medium">Imp</th>
                <th className="px-1 py-1 text-right font-medium">Exp</th>
                <th className="px-1 py-1 text-right font-medium" title="Withdrawal − injection">
                  Stor
                </th>
                <th className="px-1 py-1 text-right font-medium">Prod</th>
                <th className="px-1 py-1 text-right font-medium">LNG</th>
                <th
                  className="px-1 py-1 text-right font-medium"
                  title="Exits to distribution and final consumers"
                >
                  Cons
                </th>
                <th
                  className="px-1 py-1 text-right font-medium"
                  title="Net − consumption (linepack, unmetered points, data gaps)"
                >
                  Gap
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = r.c;
                const gap = balanceGap(c);
                const big =
                  gap !== null && c?.consumption ? Math.abs(gap) > 0.1 * c.consumption : false;
                const neighbours = c
                  ? Object.entries(c.byNeighbour)
                      .filter(([, v]) => Math.abs(v) >= 0.005)
                      .map(([k, v]) => `${k} ${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`)
                      .join(", ")
                  : "";
                const outside = new Set(c?.outsideNet ?? []);
                const ref = (k: "storage" | "production", text: string) =>
                  outside.has(k) && text !== "—" ? (
                    <span
                      className="text-muted-foreground"
                      title="Shown for reference; not included in this country's net"
                    >
                      ({text})
                    </span>
                  ) : (
                    text
                  );
                const title = [
                  `${r.label} — source: ${r.source}${c?.provisional ? " (provisional)" : ""}`,
                  neighbours && `By neighbour (mcm/d, + import): ${neighbours}`,
                  r.note,
                ]
                  .filter(Boolean)
                  .join("\n");
                return (
                  <tr key={r.code} className="border-t" title={title}>
                    <td className="px-1 py-1 font-sans text-foreground">
                      {r.label}
                      {r.source === "model" && (
                        <span className="ml-1 text-[9px] text-muted-foreground">model</span>
                      )}
                      {r.note && <span className="ml-0.5 text-[9px] text-muted-foreground">*</span>}
                    </td>
                    {c ? (
                      <>
                        <td className="px-1 py-1 text-right font-semibold text-foreground">
                          {fmt(c.net, 1)}
                        </td>
                        <td className="px-1 py-1 text-right">{fmt(c.imports, 1)}</td>
                        <td className="px-1 py-1 text-right">{fmt(c.exports, 1)}</td>
                        <td className="px-1 py-1 text-right">
                          {ref("storage", signed(c.storage))}
                        </td>
                        <td className="px-1 py-1 text-right">
                          {ref("production", c.production ? fmt(c.production, 1) : "—")}
                        </td>
                        <td className="px-1 py-1 text-right">{c.lng ? fmt(c.lng, 1) : "—"}</td>
                        <td className="px-1 py-1 text-right">
                          {c.consumption === null ? "n/a" : fmt(c.consumption, 1)}
                        </td>
                        <td
                          className={cn(
                            "px-1 py-1 text-right",
                            big && "text-[var(--status-warning)]",
                          )}
                        >
                          {signed(gap)}
                        </td>
                      </>
                    ) : (
                      <td colSpan={8} className="px-1 py-1 text-right text-muted-foreground">
                        {loading
                          ? "loading…"
                          : failed.includes(r.code)
                            ? "ENTSOG request failed"
                            : "no data for this day"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Net = imports + storage withdrawal + production + LNG − exports. Cons = reported exits to
        distribution and final customers; Gap shows what the balance does not explain (linepack,
        unmetered points). Tap a row for neighbours and source. * coverage note. Serbia&apos;s net
        is cross-border only (entry − Hungary − Bosnia), the same figure as the Serbia balance card;
        its storage and production, in brackets, are not added. Turkey and Albania are not published
        by ENTSOG.
      </p>
    </section>
  );
}
