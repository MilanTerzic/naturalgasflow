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
import { PALETTE, POINTS } from "@/lib/gas/config";
import { fmtMcm, fmtShortDate } from "@/lib/gas/format";
import type { FlowPointName, FlowRow } from "@/lib/gas/types";

const POINT_COLORS = {
  kiskundorozsma_hu: PALETTE.huOthers,
  kireevo: PALETTE.bgImport,
  kiskundorozsma_2: PALETTE.huMet,
  kalotina: PALETTE.kalotina,
} as const;

function isPublished(row: FlowRow | undefined, key: FlowPointName) {
  return !!row && (!row.published_points || row.published_points.includes(key));
}

export function FlowsChart({
  flows,
  dates,
  today,
}: {
  flows: FlowRow[];
  dates: string[];
  today: string;
}) {
  const flowByDate = new Map(flows.map((f) => [f.date, f]));
  const data = dates.map((date) => {
    const ts = Date.parse(`${date}T00:00:00Z`);
    const row = flowByDate.get(date);
    const out: Record<string, number | null> = { ts };

    for (const key of Object.keys(POINTS) as FlowPointName[]) {
      out[key] = date <= today && isPublished(row, key) ? (row?.[key] ?? 0) : null;
    }

    out.diff =
      date <= today && isPublished(row, "kireevo") && isPublished(row, "kiskundorozsma_2")
        ? (row?.kireevo ?? 0) - (row?.kiskundorozsma_2 ?? 0)
        : null;
    return out;
  });

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
          label={{
            value: "mcm/d",
            angle: -90,
            position: "insideLeft",
            offset: 12,
            style: { fontSize: 11 },
          }}
        />
        <ReferenceArea
          x1={todayTs - halfDay}
          x2={todayTs + halfDay}
          fill={PALETTE.today}
          fillOpacity={0.12}
          stroke={PALETTE.today}
          strokeOpacity={0.4}
        />
        <Area
          type="monotone"
          dataKey="diff"
          name="Kireevo Entry minus Kiskundorozsma 2 Exit"
          stroke="#6B21A8"
          strokeWidth={2}
          fill="#6B21A8"
          fillOpacity={0.05}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Tooltip
          labelFormatter={(v) => fmtShortDate(new Date(Number(v)).toISOString().slice(0, 10))}
          formatter={(v, n) => [typeof v === "number" ? `${fmtMcm(v)} mcm/d` : "–", n]}
          contentStyle={{ fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="line" />
        {(Object.keys(POINTS) as FlowPointName[]).map((key) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={POINTS[key]}
            stroke={POINT_COLORS[key]}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
