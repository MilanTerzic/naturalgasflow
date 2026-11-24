import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PALETTE } from "@/lib/gas/config";
import {
  buildHuStorage,
  HU_STORAGE_ANCHORS,
  type HuStorageRow,
} from "@/lib/gas/srbijagas-hu-storage";
import type { FlowRow } from "@/lib/gas/types";
import { pointSource } from "@/lib/region/map-model";

const shortDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const f2 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));

export function HuStorageChart({
  rows,
  compact = false,
}: {
  rows: HuStorageRow[];
  compact?: boolean;
}) {
  const data = rows.map((r) => ({ date: r.date, MET: r.met, Others: r.others }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={shortDay} minTickGap={24} />
        <YAxis tick={{ fontSize: 12 }} width={40} unit={compact ? "" : ""} />
        {!compact && (
          <Tooltip
            labelFormatter={(l) => shortDay(String(l))}
            formatter={(v: number | string) => [typeof v === "number" ? `${v.toFixed(2)} mcm` : v]}
          />
        )}
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area
          type="stepAfter"
          dataKey="Others"
          stackId="s"
          stroke={PALETTE.huOthers}
          fill={PALETTE.huOthers}
          fillOpacity={0.35}
          isAnimationActive={false}
        />
        <Area
          type="stepAfter"
          dataKey="MET"
          stackId="s"
          stroke={PALETTE.huMet}
          fill={PALETTE.huMet}
          fillOpacity={0.55}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Latest-day figures under the chart. */
export function HuStorageSummary({ rows }: { rows: HuStorageRow[] }) {
  const lastOthers = [...rows].reverse().find((r) => r.others !== null);
  const lastMet = rows.at(-1);
  const week = (pick: (r: HuStorageRow) => number | null, date?: string) => {
    if (!date) return null;
    const ref = rows.find((r) => r.date === addDaysIso(date, -7));
    const now = rows.find((r) => r.date === date);
    const a = ref ? pick(ref) : null;
    const b = now ? pick(now) : null;
    return a !== null && b !== null ? b - a : null;
  };
  const items = [
    {
      label: `MET · end of ${lastMet ? shortDay(lastMet.date) : "—"}`,
      value: lastMet?.met ?? null,
      delta: week((r) => r.met, lastMet?.date),
    },
    {
      label: `Others · end of ${lastOthers ? shortDay(lastOthers.date) : "—"}`,
      value: lastOthers?.others ?? null,
      delta: week((r) => r.others, lastOthers?.date),
    },
    {
      label: `Total · end of ${lastOthers ? shortDay(lastOthers.date) : "—"}`,
      value: lastOthers?.total ?? null,
      delta: week((r) => r.total, lastOthers?.date),
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((i) => (
        <div key={i.label} className="rounded-md border bg-background px-3 py-2">
          <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {i.label}
          </div>
          <div className="num text-[18px] font-semibold">
            {f2(i.value)} <span className="text-[12px] font-normal text-muted-foreground">mcm</span>
          </div>
          <div className="num text-[12px] text-muted-foreground">
            {i.delta === null
              ? ""
              : `${i.delta >= 0 ? "+" : "−"}${Math.abs(i.delta).toFixed(2)} w/w`}
          </div>
        </div>
      ))}
    </div>
  );
}

function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
