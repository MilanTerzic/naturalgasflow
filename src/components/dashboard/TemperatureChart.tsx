import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PALETTE } from "@/lib/gas/config";
import { fmtShortDate, fmtTemp } from "@/lib/gas/format";
import type { BalanceRow } from "@/lib/gas/types";

export function TemperatureChart({
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
      <LineChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
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
          label={{ value: "°C", angle: -90, position: "insideLeft", offset: 12, style: { fontSize: 11 } }}
        />
        <ReferenceArea
          x1={todayTs - halfDay}
          x2={todayTs + halfDay}
          fill={PALETTE.today}
          fillOpacity={0.12}
          stroke={PALETTE.today}
          strokeOpacity={0.4}
        />
        <Tooltip
          labelFormatter={(v) => fmtShortDate(new Date(Number(v)).toISOString().slice(0, 10))}
          formatter={(v, n) => [typeof v === "number" ? fmtTemp(v) : "–", n]}
          contentStyle={{ fontSize: 12 }}
        />
        <Line
          type="monotone"
          dataKey="temperature_actual_c"
          name="Temp (actual)"
          stroke={PALETTE.temp}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="temperature_forecast_c"
          name="Temp (fcst)"
          stroke={PALETTE.temp}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
