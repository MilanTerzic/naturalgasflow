import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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
  name?: string;
  value?: unknown;
  color?: string;
  dataKey?: string;
  payload?: BalanceRow;
}

interface LegendPayload {
  value?: string;
  color?: string;
}

const tooltipNum = (v: unknown) => (typeof v === "number" ? `${fmtMcm(v)} mcm/day` : "-");

export function CompositionChart({ data, today }: { data: BalanceRow[]; today: string }) {
  const todayTs = Date.parse(`${today}T00:00:00Z`);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 18, right: 18, left: 0, bottom: 8 }}>
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
        <ReferenceLine
          x={todayTs}
          stroke={PALETTE.today}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          label={{ value: "Today", position: "top", fill: PALETTE.today, fontSize: 11 }}
        />
        <Tooltip content={<CompositionTooltip />} />
        <Legend
          verticalAlign="bottom"
          align="left"
          wrapperStyle={{ paddingTop: 12 }}
          content={(props) => (
            <ChartLegend payload={props.payload as LegendPayload[] | undefined} />
          )}
        />
        <Area
          type="monotone"
          dataKey="imports_from_bulgaria_available_mcm"
          stackId="supply"
          name="Bulgaria available"
          stroke={PALETTE.bgImport}
          fill={PALETTE.bgImport}
          fillOpacity={0.72}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="kalotina_entry_mcm"
          stackId="supply"
          name="Kalotina entry"
          stroke={PALETTE.kalotina}
          fill={PALETTE.kalotina}
          fillOpacity={0.72}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="kiskundorozsma_entry_mcm"
          stackId="supply"
          name="Hungary entry"
          stroke={PALETTE.huOthers}
          fill={PALETTE.huOthers}
          fillOpacity={0.72}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="domestic_production_mcm"
          stackId="supply"
          name="Domestic production"
          stroke={PALETTE.production}
          fill={PALETTE.production}
          fillOpacity={0.72}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="required_actual_mcm"
          name="Required demand - actual"
          stroke={PALETTE.demand}
          strokeWidth={2.6}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="required_forecast_mcm"
          name="Required demand - forecast"
          stroke={PALETTE.demand}
          strokeWidth={2.4}
          strokeDasharray="6 5"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ChartLegend({ payload }: { payload?: LegendPayload[] }) {
  if (!payload?.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
      {payload.map((item) => (
        <div key={item.value} className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: item.color ?? PALETTE.axis }}
            aria-hidden="true"
          />
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function CompositionTooltip({
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
    <div className="min-w-56 rounded-lg border bg-white p-3 text-xs shadow-lg">
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
      <div className="mt-2 space-y-1.5">
        {visibleRows.map((item) => (
          <div key={item.dataKey} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: item.color ?? PALETTE.axis }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="font-medium tabular-nums text-foreground">
              {tooltipNum(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
