import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PALETTE } from "@/lib/gas/config";
import { fmtMwh, fmtPct } from "@/lib/gas/format";
import type { CapacityRow } from "@/lib/gas/types";
import { ChartCard } from "./ChartCard";

const TSO_COLORS = [PALETTE.huOthers, PALETTE.bgImport, PALETTE.kalotina, PALETTE.huMet, PALETTE.production];

function dailyRows(capacity: CapacityRow[]) {
  return capacity.filter((r) => r.product === "daily");
}

function shortKey(r: CapacityRow) {
  return `${r.tso}·${r.border_point.split("/")[0].trim()}·${r.direction}`;
}

export function CapacityCharts({ capacity }: { capacity: CapacityRow[] }) {
  const daily = dailyRows(capacity);
  const keys = Array.from(new Set(daily.map(shortKey)));
  const periods = Array.from(new Set(daily.map((r) => r.period))).sort();

  const bookedData = periods.map((period) => {
    const row: Record<string, number | string> = { period };
    for (const k of keys) {
      const r = daily.find((x) => x.period === period && shortKey(x) === k);
      row[k] = r ? r.booked_mwh : 0;
    }
    return row;
  });

  const utilData = periods.map((period) => {
    const row: Record<string, number | string> = { period };
    for (const k of keys) {
      const r = daily.find((x) => x.period === period && shortKey(x) === k);
      row[k] = r ? r.utilisation_pct : 0;
    }
    return row;
  });

  const hufRows = daily.filter((r) => r.currency === "HUF");
  const eurRows = daily.filter((r) => r.currency === "EUR");

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartCard title="Booked capacity (MWh/d)" subtitle="Daily product, by route">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bookedData} margin={{ top: 10, right: 16, left: 4, bottom: 30 }}>
            <CartesianGrid stroke={PALETTE.grid} vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke={PALETTE.axis} angle={-25} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11 }} stroke={PALETTE.axis} tickFormatter={(v) => fmtMwh(v)} />
            <Tooltip formatter={(v) => (typeof v === "number" ? fmtMwh(v) : "–")} contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {keys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={TSO_COLORS[i % TSO_COLORS.length]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Utilisation (%)" subtitle="100% reference line">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={utilData} margin={{ top: 10, right: 16, left: 4, bottom: 30 }}>
            <CartesianGrid stroke={PALETTE.grid} vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke={PALETTE.axis} angle={-25} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11 }} stroke={PALETTE.axis} tickFormatter={(v) => `${v}%`} />
            <ReferenceLine y={100} stroke={PALETTE.demand} strokeDasharray="4 4" />
            <Tooltip formatter={(v) => (typeof v === "number" ? fmtPct(v) : "–")} contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {keys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={TSO_COLORS[i % TSO_COLORS.length]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Price — HUF/kWh/h/d" subtitle="FGSZ routes">
        <PricePanel rows={hufRows} unit="HUF" />
      </ChartCard>

      <ChartCard title="Price — EUR/kWh/h/d" subtitle="Bulgartransgaz / Gastrans routes">
        <PricePanel rows={eurRows} unit="EUR" />
      </ChartCard>
    </div>
  );
}

function PricePanel({ rows, unit }: { rows: CapacityRow[]; unit: string }) {
  const keys = Array.from(new Set(rows.map(shortKey)));
  const periods = Array.from(new Set(rows.map((r) => r.period))).sort();
  const data = periods.map((period) => {
    const row: Record<string, number | string> = { period };
    for (const k of keys) {
      const r = rows.find((x) => x.period === period && shortKey(x) === k);
      row[k] = r ? r.price : 0;
    }
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 30 }}>
        <CartesianGrid stroke={PALETTE.grid} vertical={false} />
        <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke={PALETTE.axis} angle={-25} textAnchor="end" height={50} />
        <YAxis tick={{ fontSize: 10 }} stroke={PALETTE.axis} tickFormatter={(v) => Number(v).toExponential(1)} />
        <Tooltip formatter={(v) => (typeof v === "number" ? `${v.toExponential(3)} ${unit}` : "–")} contentStyle={{ fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} isAnimationActive={false}>
            {data.map((_, j) => (
              <Cell key={j} fill={TSO_COLORS[i % TSO_COLORS.length]} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
