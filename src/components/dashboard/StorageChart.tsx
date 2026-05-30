import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PALETTE } from "@/lib/gas/config";
import { fmtMcm, fmtShortDate } from "@/lib/gas/format";
import type { BalanceRow } from "@/lib/gas/types";

export function StorageChart({
  data,
  today,
}: {
  data: BalanceRow[];
  today: string;
}) {
  const todayTs = Date.parse(`${today}T00:00:00Z`);
  const halfDay = 12 * 3_600_000;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={PALETTE.grid} vertical={false} />
        <XAxis
          dataKey="ts"
          type="number"
          domain={["dataMin", "dataMax"]}
          scale="time"
          tickFormatter={(v) => fmtShortDate(new Date(v).toISOString().slice(0, 10))}
          tick={{ fontSize: 11 }}
          stroke={PALETTE.axis}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          stroke={PALETTE.axis}
          label={{ value: "mcm/d", angle: -90, position: "insideLeft", offset: 12, style: { fontSize: 11 } }}
        />
        <ReferenceArea
          x1={todayTs - halfDay}
          x2={todayTs + halfDay}
          fill={PALETTE.today}
          fillOpacity={0.12}
          stroke={PALETTE.today}
          strokeOpacity={0.4}
        />
        <ReferenceLine y={0} stroke={PALETTE.demand} strokeWidth={2} />
        <Tooltip
          labelFormatter={(v) => fmtShortDate(new Date(Number(v)).toISOString().slice(0, 10))}
          formatter={(v) => [typeof v === "number" ? `${fmtMcm(v)} mcm/d` : "–", "Storage ±"]}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="storage_imbalance_mcm" name="Storage ±" isAnimationActive={false}>
          {data.map((r, i) => (
            <Cell
              key={i}
              fill={r.storage_imbalance_mcm >= 0 ? PALETTE.storagePos : PALETTE.storageNeg}
              fillOpacity={r.is_forecast ? 0.5 : 0.95}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
