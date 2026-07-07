import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PALETTE, POINTS } from "@/lib/gas/config";
import { fmtMcm, fmtShortDate } from "@/lib/gas/format";
import type { FlowRow } from "@/lib/gas/types";

const POINT_COLORS = {
  kiskundorozsma_hu: PALETTE.huOthers,
  kireevo: PALETTE.bgImport,
  kiskundorozsma_2: PALETTE.huMet,
  kalotina: PALETTE.kalotina,
} as const;

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
    const isFcst = date > today;
    const row = flowByDate.get(date);
    const out: Record<string, number | null> = { ts };
    for (const key of Object.keys(POINTS) as (keyof typeof POINTS)[]) {
      const v = row ? (row[key] as number | undefined) ?? null : null;
      out[`${key}_actual`] = isFcst ? null : v;
      out[`${key}_fcst`] = isFcst ? v : null;
    }
    const kire = row?.kireevo;
    const kkd2 = row?.kiskundorozsma_2;
    const diff =
      kire == null || kkd2 == null || (kire === 0 && kkd2 === 0) ? null : kire - kkd2;
    out.diff_actual = isFcst ? null : diff;
    out.diff_fcst = isFcst ? diff : null;
    return out;
  });

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
          formatter={(v, n) => [typeof v === "number" ? `${fmtMcm(v)} mcm/d` : "–", n]}
          contentStyle={{ fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="line" />
        {(Object.keys(POINTS) as (keyof typeof POINTS)[]).map((key) => (
          <Line
            key={`${key}-a`}
            type="monotone"
            dataKey={`${key}_actual`}
            name={POINTS[key]}
            stroke={POINT_COLORS[key]}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
        {(Object.keys(POINTS) as (keyof typeof POINTS)[]).map((key) => (
          <Line
            key={`${key}-f`}
            type="monotone"
            dataKey={`${key}_fcst`}
            name={`${POINTS[key]} (fcst)`}
            stroke={POINT_COLORS[key]}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
            legendType="none"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
