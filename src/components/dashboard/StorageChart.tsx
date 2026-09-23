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

type ChartRow = BalanceRow & { system_balance_display: number | null };

interface TooltipPayload {
  value?: unknown;
  payload?: ChartRow;
}

export function StorageChart({ data, today }: { data: BalanceRow[]; today: string }) {
  const todayTs = Date.parse(`${today}T00:00:00Z`);
  const chartData: ChartRow[] = data.map((row) => ({
    ...row,
    system_balance_display: row.supply_available ? row.storage_imbalance_raw_mcm : null,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 16, right: 18, left: 0, bottom: 8 }}>
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
          dataKey="system_balance_display"
          name="System balance"
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        >
          {chartData.map((r, i) => (
            <Cell
              key={`${r.date}-${i}`}
              fill={r.storage_imbalance_raw_mcm >= 0 ? PALETTE.storagePos : PALETTE.storageNeg}
              fillOpacity={0.88}
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
  if (!row?.supply_available || value == null) {
    return (
      <div className="min-w-60 rounded-lg border bg-white p-3 text-xs shadow-lg">
        <div className="font-semibold text-foreground">{date}</div>
        <p className="mt-2 text-muted-foreground">
          Supply inputs are unavailable, so no system balance is calculated.
        </p>
      </div>
    );
  }

  const positive = value >= 0;
  const action =
    row.storage_imbalance_mcm >= 0
      ? `Inject up to ${fmtMcm(row.storage_imbalance_mcm)} mcm/day`
      : `Withdraw up to ${fmtMcm(-row.storage_imbalance_mcm)} mcm/day`;
  const residual =
    Math.abs(row.residual_gap_mcm) < 0.005
      ? "No residual gap"
      : row.residual_gap_mcm > 0
        ? `Residual surplus ${fmtMcm(row.residual_gap_mcm)} mcm/day`
        : `Residual deficit ${fmtMcm(-row.residual_gap_mcm)} mcm/day`;

  return (
    <div className="min-w-64 rounded-lg border bg-white p-3 text-xs shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b pb-2">
        <div className="font-semibold text-foreground">{date}</div>
        {row.is_estimated && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">Estimated inputs</span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] gap-3">
        <span className="text-muted-foreground">
          {positive ? "System surplus" : "System deficit"}
        </span>
        <span
          className={
            positive
              ? "font-semibold tabular-nums text-emerald-700"
              : "font-semibold tabular-nums text-rose-700"
          }
        >
          {fmtMcm(Math.abs(value))} mcm/day
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {action} · {residual}
      </p>
    </div>
  );
}
