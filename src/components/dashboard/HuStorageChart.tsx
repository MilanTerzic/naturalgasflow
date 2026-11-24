import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
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
  // Stacked areas only where both stocks are known; a MET-only tail would read as a cliff.
  const data = rows
    .filter((r) => r.met !== null && r.others !== null)
    .map((r) => ({ date: r.date, MET: r.met, Others: r.others }));
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

/** MET vs Others share of the latest day on which both stocks are known. */
export function HuStoragePie({ rows }: { rows: HuStorageRow[] }) {
  const last = [...rows].reverse().find((r) => r.met !== null && r.others !== null && r.total);
  if (!last) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        No day with both stocks yet
      </div>
    );
  }
  const total = last.total!;
  const data = [
    { name: "MET", value: Math.max(0, last.met!), color: PALETTE.huMet },
    { name: "Others", value: Math.max(0, last.others!), color: PALETTE.huOthers },
  ];
  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—");
  return (
    <div className="flex h-full flex-col">
      <div className="text-center text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Share · end of {shortDay(last.date)}
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="45%"
              outerRadius="80%"
              startAngle={90}
              endAngle={-270}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
              labelLine={false}
              label={({ name, value }: { name: string; value: number }) => `${name} ${pct(value)}`}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Stock over time on one half, MET/Others share on the other; quantities underneath. */
export function HuStoragePanel({
  rows,
  compact = false,
  height = 260,
}: {
  rows: HuStorageRow[];
  compact?: boolean;
  height?: number;
}) {
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2" style={{ minHeight: height }}>
        <div style={{ height }}>
          <HuStorageChart rows={rows} compact={compact} />
        </div>
        <div style={{ height }}>
          <HuStoragePie rows={rows} />
        </div>
      </div>
      <div className="mt-3">
        <HuStorageSummary rows={rows} />
      </div>
    </div>
  );
}
