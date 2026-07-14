import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PALETTE } from "@/lib/gas/config";
import { fmtShortDate, fmtTemp } from "@/lib/gas/format";
import type { BalanceRow } from "@/lib/gas/types";

interface TooltipPayload {
  name?: string;
  value?: unknown;
  color?: string;
  dataKey?: string;
  payload?: BalanceRow;
}

export function TemperatureChart({ data, today }: { data: BalanceRow[]; today: string }) {
  const todayTs = Date.parse(`${today}T00:00:00Z`);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 16, right: 18, left: 0, bottom: 8 }}>
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
          width={38}
          label={{
            value: "°C",
            angle: -90,
            position: "insideLeft",
            offset: 10,
            style: { fontSize: 11, fill: PALETTE.axis },
          }}
        />
        <ReferenceLine
          x={todayTs}
          stroke={PALETTE.today}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          label={{ value: "Today", position: "top", fill: PALETTE.today, fontSize: 11 }}
        />
        <Tooltip content={<TemperatureTooltip />} />
        <Legend
          verticalAlign="bottom"
          align="left"
          wrapperStyle={{ paddingTop: 10, fontSize: 11 }}
          iconType="line"
        />
        <Line
          type="monotone"
          dataKey="temperature_actual_c"
          name="Actual temperature"
          stroke={PALETTE.temp}
          strokeWidth={2.2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="temperature_forecast_c"
          name="Forecast temperature"
          stroke={PALETTE.temp}
          strokeWidth={2.2}
          strokeDasharray="6 5"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function TemperatureTooltip({
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
  const date = fmtShortDate(new Date(label).toISOString().slice(0, 10));
  const visibleRows = payload.filter((item) => typeof item.value === "number");

  return (
    <div className="min-w-52 rounded-lg border bg-white p-3 text-xs shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b pb-2">
        <div className="font-semibold text-foreground">{date}</div>
        {row?.is_forecast && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">Forecast</span>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {visibleRows.map((item) => (
          <div key={item.dataKey} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: item.color ?? PALETTE.axis }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="font-medium tabular-nums text-foreground">
              {typeof item.value === "number" ? fmtTemp(item.value) : "-"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
