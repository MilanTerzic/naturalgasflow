import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PALETTE } from "@/lib/gas/config";
import { fmtMcm, fmtShortDate } from "@/lib/gas/format";
import type { BalanceRow } from "@/lib/gas/types";

interface TooltipPayload {
  value?: unknown;
  payload?: BalanceRow;
}

export function StorageChart({ data, today }: { data: BalanceRow[]; today: string }) {
  const todayTs = Date.parse(`${today}T00:00:00Z`);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 16, right: 18, left: 0, bottom: 8 }}>
        <CartesianGrid stroke={PALETTE.grid} vertical={false} />
        <XAxis
          dataKey="ts"
          type="number"
          domain={["dataMin", "dataMax"]}
          scale="time"
          tickFormatter={(v) => fmtShortDate(new Date(v).toISOString().slice(0, 10))}
          tick={{ fontSize: 11 }}
          stroke={PALETTE.axis}
          minTickGap={18}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          stroke={PALETTE.axis}
          width={42}
          label={{
            value: "mcm/day",
            angle: -90,
            position: "insideLeft",
            offset: 8,
            style: { fontSize: 11, fill: PALETTE.axis },
          }}
        />
        <ReferenceLine y={0} stroke="rgba(71,85,105,0.75)" strokeWidth={1.5} />
        <ReferenceLine
          x={todayTs}
          stroke={PALETTE.today}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          label={{ value: "Today", position: "top", fill: PALETTE.today, fontSize: 11 }}
        />
        <Tooltip content={<StorageTooltip />} />
        <Bar
          dataKey="storage_imbalance_mcm"
          name="Estimated gas balance"
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        >
          {data.map((r, i) => (
            <Cell
              key={`${r.date}-${i}`}
              fill={r.storage_imbalance_mcm >= 0 ? PALETTE.storagePos : PALETTE.storageNeg}
              fillOpacity={r.is_forecast ? 0.45 : 0.88}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function StorageTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: unknown;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length || typeof label !== "number") return null;

  const row = payload[0]?.payload;
  const value = typeof payload[0]?.value === "number" ? payload[0].value : undefined;
  const date = fmtShortDate(new Date(label).toISOString().slice(0, 10));
  const positive = (value ?? 0) >= 0;

  return (
    <div className="min-w-60 rounded-lg border bg-white p-3 text-xs shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b pb-2">
        <div className="font-semibold text-foreground">{date}</div>
        <div className="flex gap-1">
          {row?.is_forecast && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">Forecast</span>
          )}
          {row?.is_estimated && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">Estimated</span>
          )}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] gap-3">
        <span className="text-muted-foreground">
          {positive ? "Surplus / potential injection" : "Deficit / withdrawal requirement"}
        </span>
        <span
          className={
            positive
              ? "font-semibold tabular-nums text-emerald-700"
              : "font-semibold tabular-nums text-rose-700"
          }
        >
          {value == null ? "-" : `${fmtMcm(value)} mcm/day`}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Estimated balancing requirement, not measured storage activity.
      </p>
    </div>
  );
}
