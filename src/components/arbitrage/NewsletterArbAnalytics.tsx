// Newsletter section: HU ↔ BG arbitrage analytics (spread vs break-even, window statistics,
// seasonal context, 7-day outlook and technical read). Same data and models as the
// Arbitrage tab; nothing here is computed differently.
import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type { SpreadRow } from "@/lib/gas/arb/history";
import { taLabel, type ArbDigest } from "@/lib/gas/arb/digest";
import type { DriverReport } from "@/lib/gas/arb/drivers";
import { cn } from "@/lib/utils";
import { n2, pct, sgn, toneOf } from "./format";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border px-2.5 py-2">
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn("num mt-0.5 text-[17px] font-semibold", tone)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</div>}
    </div>
  );
}

function SpreadChart({ rows, digest }: { rows: SpreadRow[]; digest: ArbDigest }) {
  const data = useMemo(() => {
    const hist: Record<string, unknown>[] = rows.slice(-90).map((r) => ({
      date: r.date,
      spread: r.spread,
      beBgHu: r.costBgHu,
      beHuBg: r.costHuBg === null ? null : -r.costHuBg,
    }));
    const last = hist[hist.length - 1];
    if (last && digest.outlook.length)
      Object.assign(last, { p50: last.spread, band: [last.spread, last.spread] });
    const fut = digest.outlook.map((o) => ({
      date: o.date,
      p50: o.spread.p50,
      band: [o.spread.lo, o.spread.hi],
      beBgHu: o.costBgHu,
      beHuBg: o.costHuBg === null ? null : -o.costHuBg,
    }));
    return [...hist, ...fut];
  }, [rows, digest]);
  return (
    <div className="h-[230px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, left: -6, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} tickFormatter={short} minTickGap={36} />
          <YAxis tick={AXIS} width={40} domain={["auto", "auto"]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
          <ReferenceLine x={digest.day} stroke="var(--muted-foreground)" strokeDasharray="2 3" />
          <Area
            dataKey="band"
            name="80% band"
            stroke="none"
            fill="var(--chart-1)"
            fillOpacity={0.18}
            isAnimationActive={false}
          />
          <Line
            dataKey="beBgHu"
            name="BG→HU break-even"
            stroke="var(--chart-2)"
            strokeDasharray="5 3"
            dot={false}
            strokeWidth={1.2}
            isAnimationActive={false}
          />
          <Line
            dataKey="beHuBg"
            name="HU→BG break-even"
            stroke="var(--chart-4)"
            strokeDasharray="5 3"
            dot={false}
            strokeWidth={1.2}
            isAnimationActive={false}
          />
          <Line
            dataKey="spread"
            name="CEEGEX − BGH"
            stroke="var(--foreground)"
            dot={false}
            strokeWidth={1.6}
            isAnimationActive={false}
          />
          <Line
            dataKey="p50"
            name="Forecast p50"
            stroke="var(--chart-1)"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const pTone = (p: number | null) =>
  p === null
    ? ""
    : p >= 0.7
      ? "bg-emerald-500/15 font-semibold"
      : p >= 0.4
        ? "bg-amber-500/10"
        : "";

export function NewsletterArbAnalytics({
  digest,
  rows,
  drivers,
}: {
  digest: ArbDigest;
  rows: SpreadRow[];
  drivers: DriverReport[];
}) {
  const d = digest;
  const s30 = d.last30;
  const mtd = d.monthToDate;
  const used = drivers.filter((x) => x.used).map((x) => x.name);
  const dropped = drivers.filter((x) => !x.used).map((x) => x.name);
  const ta = taLabel(d.taScore);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label={`Spread ${short(d.day)}${d.provisional ? " (prov.)" : ""}`}
          value={sgn(d.spread)}
          tone={toneOf(d.spread)}
          sub={[
            d.spreadAvg7 !== null ? `7-obs avg ${sgn(d.spreadAvg7)}` : null,
            d.percentile365 !== null ? `${pct(d.percentile365)} pctile 12M` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <Tile
          label="Net vs break-even"
          value={`${sgn(d.netBgHu)} / ${sgn(d.netHuBg)}`}
          tone={toneOf(Math.max(d.netBgHu ?? -Infinity, d.netHuBg ?? -Infinity))}
          sub={`BG→HU / HU→BG · cost ${n2(d.costBgHu)} / ${n2(d.costHuBg)}`}
        />
        <Tile
          label="Open days, last 30"
          value={`${s30.openBgHu} / ${s30.openHuBg}`}
          sub={`of ${s30.days} obs · BG→HU / HU→BG · month to date ${mtd.openBgHu} / ${mtd.openHuBg} of ${mtd.days}`}
        />
        <Tile
          label={d.seasonal ? `${MONTHS[d.seasonal.month - 1]} in past years` : "Seasonal"}
          value={d.seasonal ? `${pct(d.seasonal.shareBgHu)} / ${pct(d.seasonal.shareHuBg)}` : "—"}
          sub={
            d.seasonal
              ? `days open BG→HU / HU→BG · mean spread ${sgn(d.seasonal.meanSpread)} · ${d.seasonal.years} yr, ${d.seasonal.days} obs`
              : "Not enough history for this month"
          }
        />
      </div>

      <SpreadChart rows={rows} digest={d} />

      {d.outlook.length > 0 ? (
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead className="text-[10px] tracking-wide text-muted-foreground uppercase">
            <tr className="whitespace-nowrap">
              <th className="py-1.5 pr-1.5 text-left font-medium">Delivery</th>
              <th className="px-1.5 py-1.5 text-right font-medium">Spread p50</th>
              <th className="px-1.5 py-1.5 text-right font-medium">80% band</th>
              <th className="px-1.5 py-1.5 text-right font-medium">P(BG→HU open)</th>
              <th className="py-1.5 pl-1.5 text-right font-medium">P(HU→BG open)</th>
            </tr>
          </thead>
          <tbody>
            {d.outlook.map((o) => (
              <tr key={o.date}>
                <td className="border-t py-1 pr-1.5">{short(o.date)}</td>
                <td className={cn("num border-t px-1.5 py-1 text-right", toneOf(o.spread.p50))}>
                  {sgn(o.spread.p50)}
                </td>
                <td className="num border-t px-1.5 py-1 text-right text-muted-foreground">
                  {n2(o.spread.lo)} … {n2(o.spread.hi)}
                </td>
                <td className={cn("num border-t px-1.5 py-1 text-right", pTone(o.pBgHu))}>
                  {pct(o.pBgHu)}
                </td>
                <td className={cn("num border-t py-1 pl-1.5 text-right", pTone(o.pHuBg))}>
                  {pct(o.pHuBg)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          No spread forecast: the models need at least 10 days of BGH and CEEGEX history.
        </p>
      )}

      {d.signals.length > 0 && (
        <p className="text-[12px] leading-snug">
          <span className="font-semibold">Technical read on the spread: {ta}</span>{" "}
          <span className="text-muted-foreground">
            ({d.signals.map((s) => `${s.name} ${s.value}`).join(" · ")})
          </span>
        </p>
      )}

      <p className="text-[11px] leading-snug text-muted-foreground">
        Spread = CEEGEX − BGH day-ahead, same delivery day; positive favours BG→HU. Break-even =
        transport cost at reserve prices (2026/27 tariffs; earlier days costed at the same month of
        this gas year). Outlook: ensemble of random walk, mean reversion, damped trend
        {used.length ? ` and a fundamentals model (${used.join(", ")})` : ""}, weighted by backtest
        error; skill vs random walk {pct(d.skill1)} at 1 day, {pct(d.skill7)} at 7 days
        {d.skill7 !== null && d.skill7 <= 0 ? " — no better than today's spread held flat" : ""}.
        {dropped.length ? ` Not used (insufficient data): ${dropped.join(", ")}.` : ""} 2021–23
        crisis excluded from training and seasonal figures. Probabilities assume normal errors and
        ignore auction premiums and capacity availability — indicative only.
      </p>
    </div>
  );
}
