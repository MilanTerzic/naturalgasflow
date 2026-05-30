import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PALETTE } from "@/lib/gas/config";
import { fmtMcm, fmtShortDate } from "@/lib/gas/format";
import type { BalanceRow } from "@/lib/gas/types";

const tooltipNum = (v: unknown) => (typeof v === "number" ? `${fmtMcm(v)} mcm/d` : "–");

export function CompositionChart({
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
      <ComposedChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
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
        <Tooltip
          labelFormatter={(v) => fmtShortDate(new Date(Number(v)).toISOString().slice(0, 10))}
          formatter={(v, n) => [tooltipNum(v), n]}
          contentStyle={{ fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="square" />
        <Area
          type="monotone"
          dataKey="imports_from_bulgaria_available_mcm"
          stackId="supply"
          name="Imports from Bulgaria"
          stroke={PALETTE.bgImport}
          fill={PALETTE.bgImport}
          fillOpacity={0.9}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="kalotina_entry_mcm"
          stackId="supply"
          name="Kalotina entry"
          stroke={PALETTE.kalotina}
          fill={PALETTE.kalotina}
          fillOpacity={0.9}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="kiskundorozsma_entry_mcm"
          stackId="supply"
          name="Kiskundorozsma entry"
          stroke={PALETTE.huOthers}
          fill={PALETTE.huOthers}
          fillOpacity={0.9}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="domestic_production_mcm"
          stackId="supply"
          name="Domestic production"
          stroke={PALETTE.production}
          fill={PALETTE.production}
          fillOpacity={0.9}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="required_actual_mcm"
          name="Required demand"
          stroke={PALETTE.demand}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="required_forecast_mcm"
          name="Required (fcst)"
          stroke={PALETTE.demand}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
