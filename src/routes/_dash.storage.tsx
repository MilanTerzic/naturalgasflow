import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { fetchAgsiStorage, type AgsiRow } from "@/lib/data/agsi.functions";

export const Route = createFileRoute("/_dash/storage")({
  head: () => ({
    meta: [
      { title: "Gas Storage — Serbia Gas Dashboard" },
      { name: "description", content: "European gas storage levels (AGSI+/GIE)." },
    ],
  }),
  component: StoragePage,
});

const COUNTRIES: Array<{ code: string; label: string }> = [
  { code: "eu", label: "EU (aggregate)" },
  { code: "at", label: "Austria" },
  { code: "hu", label: "Hungary" },
  { code: "de", label: "Germany" },
  { code: "it", label: "Italy" },
  { code: "fr", label: "France" },
  { code: "nl", label: "Netherlands" },
  { code: "hr", label: "Croatia" },
  { code: "rs", label: "Serbia" },
  { code: "bg", label: "Bulgaria" },
  { code: "ro", label: "Romania" },
  { code: "sk", label: "Slovakia" },
  { code: "cz", label: "Czech Republic" },
];

type Comparison = "prev" | "avg5" | "minmax";

function dayOfYear(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86_400_000) + 1;
}

function isoAddYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

const fmt = (v: number | null | undefined, digits = 2, unit = "") => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return `${v.toFixed(digits)}${unit ? " " + unit : ""}`;
};

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

function StoragePage() {
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = isoAddYears(today.slice(0, 4) + "-01-01", 0); // Jan 1 of current year
  const [country, setCountry] = useState("eu");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [comparison, setComparison] = useState<Comparison>("avg5");
  const [unit, setUnit] = useState<"TWh" | "GWh">("TWh");

  // For comparisons we fetch a 6-year window ending at `to`.
  const histFrom = useMemo(() => isoAddYears(from, -5), [from]);

  const query = useQuery({
    queryKey: ["agsi", country, histFrom, to],
    queryFn: () => fetchAgsiStorage({ data: { country, from: histFrom, to } }),
    staleTime: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const rows: AgsiRow[] = query.data?.data ?? [];
  const currentYear = Number(to.slice(0, 4));

  // Split by year for day-of-year comparisons.
  const byYear = useMemo(() => {
    const map = new Map<number, Map<number, AgsiRow>>();
    for (const r of rows) {
      const y = Number(r.gasDayStart.slice(0, 4));
      const doy = dayOfYear(r.gasDayStart);
      if (!map.has(y)) map.set(y, new Map());
      map.get(y)!.set(doy, r);
    }
    return map;
  }, [rows]);

  // Build chart series limited to selected [from,to]. Current-year rows in range.
  const inRange = useMemo(
    () => rows.filter((r) => r.gasDayStart >= from && r.gasDayStart <= to),
    [rows, from, to],
  );

  const chartData = useMemo(() => {
    return inRange.map((r) => {
      const doy = dayOfYear(r.gasDayStart);
      const prevYearRow = byYear.get(currentYear - 1)?.get(doy);
      // 5-year average excludes current year.
      const compYears = [1, 2, 3, 4, 5]
        .map((n) => byYear.get(currentYear - n)?.get(doy))
        .filter((x): x is AgsiRow => !!x);
      const fullVals = compYears.map((x) => x.full).filter((v): v is number => v !== null);
      const gisVals = compYears.map((x) => x.gasInStorage).filter((v): v is number => v !== null);
      const avg5Full =
        fullVals.length ? fullVals.reduce((a, b) => a + b, 0) / fullVals.length : null;
      const avg5Gis =
        gisVals.length ? gisVals.reduce((a, b) => a + b, 0) / gisVals.length : null;
      const minFull = fullVals.length ? Math.min(...fullVals) : null;
      const maxFull = fullVals.length ? Math.max(...fullVals) : null;
      return {
        date: r.gasDayStart,
        full: r.full,
        gasInStorage: r.gasInStorage,
        injection: r.injection,
        withdrawal: r.withdrawal !== null ? -r.withdrawal : null,
        injUtil:
          r.injection !== null && r.injectionCapacity
            ? (r.injection / r.injectionCapacity) * 100
            : null,
        wdrUtil:
          r.withdrawal !== null && r.withdrawalCapacity
            ? (r.withdrawal / r.withdrawalCapacity) * 100
            : null,
        prevFull: prevYearRow?.full ?? null,
        prevGis: prevYearRow?.gasInStorage ?? null,
        avg5Full,
        avg5Gis,
        minFull,
        maxFull,
        bandDelta: minFull !== null && maxFull !== null ? maxFull - minFull : null,
      };
    });
  }, [inRange, byYear, currentYear]);

  // Latest row for KPIs.
  const latest = inRange[inRange.length - 1];
  const latestDoy = latest ? dayOfYear(latest.gasDayStart) : null;
  const prevYearRow = latest && latestDoy ? byYear.get(currentYear - 1)?.get(latestDoy) : null;
  const kpiAvg5 = useMemo(() => {
    if (!latest || !latestDoy) return { full: null as number | null, gis: null as number | null };
    const rows = [1, 2, 3, 4, 5]
      .map((n) => byYear.get(currentYear - n)?.get(latestDoy))
      .filter((x): x is AgsiRow => !!x);
    const full = rows.map((r) => r.full).filter((v): v is number => v !== null);
    const gis = rows.map((r) => r.gasInStorage).filter((v): v is number => v !== null);
    return {
      full: full.length ? full.reduce((a, b) => a + b, 0) / full.length : null,
      gis: gis.length ? gis.reduce((a, b) => a + b, 0) / gis.length : null,
    };
  }, [latest, latestDoy, byYear, currentYear]);

  const diffPrevGis =
    latest && prevYearRow && latest.gasInStorage !== null && prevYearRow.gasInStorage !== null
      ? latest.gasInStorage - prevYearRow.gasInStorage
      : null;
  const diffPrevFull =
    latest && prevYearRow && latest.full !== null && prevYearRow.full !== null
      ? latest.full - prevYearRow.full
      : null;
  const diffAvg5Gis =
    latest && kpiAvg5.gis !== null && latest.gasInStorage !== null
      ? latest.gasInStorage - kpiAvg5.gis
      : null;
  const diffAvg5Full =
    latest && kpiAvg5.full !== null && latest.full !== null ? latest.full - kpiAvg5.full : null;

  const net =
    latest && latest.injection !== null && latest.withdrawal !== null
      ? latest.injection - latest.withdrawal
      : null;

  const displayGis = (twh: number | null | undefined) => {
    if (twh === null || twh === undefined) return "–";
    return unit === "TWh" ? `${twh.toFixed(2)} TWh` : `${(twh * 1000).toFixed(0)} GWh`;
  };

  const missingKey = query.data?.missingKey;
  const apiError = query.data?.error;

  return (
    <div className="space-y-4">
      {missingKey && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⚠ AGSI API key not configured. Add <code>AGSI_API_KEY</code> to project secrets to enable
          this tab. Register at <a className="underline" href="https://agsi.gie.eu/account">agsi.gie.eu/account</a>.
        </div>
      )}
      {apiError && !missingKey && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⚠ AGSI: {apiError}
        </div>
      )}

      {/* Filters */}
      <div className="rounded-md border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Region / Country</span>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="rounded border bg-background px-2 py-1"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded border bg-background px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded border bg-background px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Comparison</span>
            <select
              value={comparison}
              onChange={(e) => setComparison(e.target.value as Comparison)}
              className="rounded border bg-background px-2 py-1"
            >
              <option value="prev">Previous year</option>
              <option value="avg5">5-year average</option>
              <option value="minmax">Min / Max band</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Unit</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as "TWh" | "GWh")}
              className="rounded border bg-background px-2 py-1"
            >
              <option value="TWh">TWh</option>
              <option value="GWh">GWh</option>
            </select>
          </label>
          <div className="ml-auto text-[11px] text-muted-foreground">
            {query.isFetching && <span>Fetching…</span>}
            {query.data?.fetchedAt && (
              <span>Last updated: {new Date(query.data.fetchedAt).toLocaleString()}</span>
            )}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Gas in storage" value={displayGis(latest?.gasInStorage ?? null)} hint={latest?.gasDayStart} />
        <KpiCard
          label="Fullness"
          value={fmt(latest?.full ?? null, 1, "%")}
          hint={latest?.status ? `Status: ${latest.status}` : undefined}
        />
        <KpiCard
          label="Working gas volume"
          value={displayGis(latest?.workingGasVolume ?? null)}
        />
        <KpiCard
          label="Injection"
          value={fmt(latest?.injection ?? null, 0, "GWh/d")}
          hint={`Cap: ${fmt(latest?.injectionCapacity ?? null, 0, "GWh/d")}`}
        />
        <KpiCard
          label="Withdrawal"
          value={fmt(latest?.withdrawal ?? null, 0, "GWh/d")}
          hint={`Cap: ${fmt(latest?.withdrawalCapacity ?? null, 0, "GWh/d")}`}
        />
        <KpiCard
          label="Net (inj − wdr)"
          value={fmt(net, 0, "GWh/d")}
          tone={net === null ? "default" : net >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Δ vs last year"
          value={displayGis(diffPrevGis)}
          hint={diffPrevFull !== null ? `${diffPrevFull >= 0 ? "+" : ""}${diffPrevFull.toFixed(1)} pp` : undefined}
          tone={diffPrevGis === null ? "default" : diffPrevGis >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Δ vs 5-yr avg"
          value={displayGis(diffAvg5Gis)}
          hint={diffAvg5Full !== null ? `${diffAvg5Full >= 0 ? "+" : ""}${diffAvg5Full.toFixed(1)} pp` : undefined}
          tone={diffAvg5Gis === null ? "default" : diffAvg5Gis >= 0 ? "positive" : "negative"}
        />
      </div>

      {/* Fullness chart */}
      <ChartCard
        title={`Storage fullness — ${COUNTRIES.find((c) => c.code === country)?.label ?? country.toUpperCase()}`}
        subtitle="% of working gas volume"
        height={320}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={shortDate} minTickGap={40} />
            <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
            <Tooltip
              labelFormatter={(v) => shortDate(String(v))}
              formatter={(v, n) => [typeof v === "number" ? `${v.toFixed(1)}%` : "–", n]}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {comparison === "minmax" && (
              <>
                <Area
                  type="monotone"
                  dataKey="minFull"
                  stackId="band"
                  stroke="none"
                  fill="transparent"
                  name="5y min"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="bandDelta"
                  stackId="band"
                  stroke="none"
                  fill="#94a3b8"
                  fillOpacity={0.25}
                  name="5y min–max band"
                  isAnimationActive={false}
                />
              </>
            )}
            {comparison === "avg5" && (
              <Line
                type="monotone"
                dataKey="avg5Full"
                name="5-year average"
                stroke="#94a3b8"
                strokeDasharray="5 4"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
            {comparison === "prev" && (
              <Line
                type="monotone"
                dataKey="prevFull"
                name={`${currentYear - 1}`}
                stroke="#94a3b8"
                strokeDasharray="5 4"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="full"
              name={`${currentYear}`}
              stroke="#2563eb"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Gas in storage TWh */}
      <ChartCard title="Gas in storage" subtitle={unit} height={280}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={shortDate} minTickGap={40} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => (unit === "TWh" ? String(v) : String(Math.round(v * 1000)))}
            />
            <Tooltip
              labelFormatter={(v) => shortDate(String(v))}
              formatter={(v, n) => [
                typeof v === "number"
                  ? unit === "TWh"
                    ? `${v.toFixed(2)} TWh`
                    : `${(v * 1000).toFixed(0)} GWh`
                  : "–",
                n,
              ]}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="prevGis"
              name={`${currentYear - 1}`}
              stroke="#94a3b8"
              strokeDasharray="5 4"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="avg5Gis"
              name="5-yr avg"
              stroke="#cbd5e1"
              strokeDasharray="2 3"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="gasInStorage"
              name={`${currentYear}`}
              stroke="#0f766e"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Injection / withdrawal */}
      <ChartCard title="Injection & withdrawal" subtitle="GWh/d — withdrawal shown negative" height={260}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={shortDate} minTickGap={40} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              labelFormatter={(v) => shortDate(String(v))}
              formatter={(v, n) => [typeof v === "number" ? `${v.toFixed(0)} GWh/d` : "–", n]}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="injection" name="Injection" fill="#16a34a" isAnimationActive={false} />
            <Bar dataKey="withdrawal" name="Withdrawal" fill="#dc2626" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Capacity utilization */}
      <ChartCard title="Capacity utilization" subtitle="% of technical injection / withdrawal capacity" height={240}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={shortDate} minTickGap={40} />
            <YAxis tick={{ fontSize: 11 }} unit="%" />
            <Tooltip
              labelFormatter={(v) => shortDate(String(v))}
              formatter={(v, n) => [typeof v === "number" ? `${v.toFixed(1)}%` : "–", n]}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="injUtil" name="Injection util." stroke="#16a34a" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="wdrUtil" name="Withdrawal util." stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Table */}
      <div className="rounded-md border bg-card p-3 shadow-sm">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold tracking-tight">Daily data</h3>
          <span className="text-xs text-muted-foreground">{inRange.length} rows</span>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-left">
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5">Region</th>
                <th className="px-2 py-1.5 text-right">Gas in storage (TWh)</th>
                <th className="px-2 py-1.5 text-right">Full %</th>
                <th className="px-2 py-1.5 text-right">WGV (TWh)</th>
                <th className="px-2 py-1.5 text-right">Injection (GWh/d)</th>
                <th className="px-2 py-1.5 text-right">Withdrawal (GWh/d)</th>
                <th className="px-2 py-1.5 text-right">Net (GWh/d)</th>
                <th className="px-2 py-1.5 text-right">Inj cap</th>
                <th className="px-2 py-1.5 text-right">Wdr cap</th>
                <th className="px-2 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {inRange.length === 0 && !query.isFetching && (
                <tr>
                  <td colSpan={11} className="px-2 py-6 text-center text-muted-foreground">
                    No data available for this selection.
                  </td>
                </tr>
              )}
              {[...inRange].reverse().map((r) => {
                const net =
                  r.injection !== null && r.withdrawal !== null ? r.injection - r.withdrawal : null;
                return (
                  <tr key={r.gasDayStart} className="border-b last:border-b-0">
                    <td className="px-2 py-1 tabular-nums">{r.gasDayStart}</td>
                    <td className="px-2 py-1 uppercase">{country}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmt(r.gasInStorage, 2)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmt(r.full, 1)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmt(r.workingGasVolume, 2)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmt(r.injection, 0)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmt(r.withdrawal, 0)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmt(net, 0)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmt(r.injectionCapacity, 0)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmt(r.withdrawalCapacity, 0)}</td>
                    <td className="px-2 py-1">{r.status ?? "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
