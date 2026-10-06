import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Radio } from "lucide-react";
import { PALETTE, POINTS } from "@/lib/gas/config";
import { fmtMcm, fmtShortDateYear } from "@/lib/gas/format";
import type {
  BalanceRow,
  FlowPointName,
  FlowPointOperationalSource,
  FlowRow,
} from "@/lib/gas/types";
import type { AgsiRow } from "@/lib/data/agsi.functions";

const HUB = { x: 430, y: 315 };

interface PointGeometry {
  shortLabel: string;
  country: string;
  directionLabel: string;
  side: "entry" | "exit";
  x: number;
  y: number;
  controlX: number;
  controlY: number;
  labelX: number;
  labelY: number;
  labelWidth: number;
  color: string;
}

const POINT_GEOGRAPHY: Record<FlowPointName, PointGeometry> = {
  kiskundorozsma_hu: {
    shortLabel: "Kiskundorozsma",
    country: "Hungary",
    directionLabel: "HU → RS",
    side: "entry",
    x: 315,
    y: 96,
    controlX: 330,
    controlY: 205,
    labelX: 98,
    labelY: 92,
    labelWidth: 190,
    color: PALETTE.huOthers,
  },
  kireevo: {
    shortLabel: "Kireevo / Zaječar",
    country: "Bulgaria",
    directionLabel: "BG → RS",
    side: "entry",
    x: 650,
    y: 318,
    controlX: 555,
    controlY: 300,
    labelX: 674,
    labelY: 274,
    labelWidth: 178,
    color: PALETTE.bgImport,
  },
  kiskundorozsma_2: {
    shortLabel: "Kiskundorozsma 2 / Horgoš",
    country: "Hungary",
    directionLabel: "RS → HU",
    side: "exit",
    x: 438,
    y: 92,
    controlX: 455,
    controlY: 190,
    labelX: 470,
    labelY: 70,
    labelWidth: 220,
    color: PALETTE.huMet,
  },
  kalotina: {
    shortLabel: "Kalotina / Dimitrovgrad",
    country: "Bulgaria",
    directionLabel: "BG → RS",
    side: "entry",
    x: 584,
    y: 500,
    controlX: 525,
    controlY: 420,
    labelX: 606,
    labelY: 492,
    labelWidth: 210,
    color: PALETTE.kalotina,
  },
};

const POINT_KEYS = Object.keys(POINTS) as FlowPointName[];

function sourceFor(
  row: FlowRow | undefined,
  key: FlowPointName,
): FlowPointOperationalSource | undefined {
  if (!row) return undefined;
  const explicit = row.point_source?.[key];
  if (explicit) return explicit;

  // Dummy / legacy rows predate point-level provenance. In those rows, an
  // undefined published_points field means the value is intentionally present.
  if (!row.published_points || row.published_points.includes(key)) {
    return "physical_flow";
  }
  return undefined;
}

function sourceLabel(source: FlowPointOperationalSource | undefined) {
  if (source === "physical_flow") return "Physical flow";
  if (source === "renomination") return "Renomination";
  if (source === "nomination") return "Nomination";
  return "No publication";
}

function sourceBadgeClass(source: FlowPointOperationalSource | undefined) {
  if (source === "physical_flow") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (source === "renomination" || source === "nomination") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-border bg-muted text-muted-foreground";
}

function formatUpdate(iso: string | undefined) {
  if (!iso) return "No ENTSOG update timestamp";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Belgrade",
    timeZoneName: "short",
  });
}

function branchPath(meta: PointGeometry) {
  if (meta.side === "entry") {
    return `M ${meta.x} ${meta.y} Q ${meta.controlX} ${meta.controlY} ${HUB.x} ${HUB.y}`;
  }
  return `M ${HUB.x} ${HUB.y} Q ${meta.controlX} ${meta.controlY} ${meta.x} ${meta.y}`;
}

function strokeWidth(value: number | null) {
  if (value == null || value <= 0) return 3;
  return Math.min(13, 4 + Math.sqrt(value) * 2.2);
}

export function SerbiaPipelineFlowMap({
  flows,
  today,
  balance,
  storage,
}: {
  flows: FlowRow[];
  today: string;
  balance?: BalanceRow[];
  storage?: AgsiRow | null;
}) {
  const flowByDate = useMemo(
    () => new Map(flows.map((row) => [row.date, row])),
    [flows],
  );

  const availableDates = useMemo(
    () =>
      Array.from(new Set(flows.map((row) => row.date)))
        .filter((date) => date <= today)
        .sort(),
    [flows, today],
  );

  const latestDate =
    availableDates.length > 0 ? availableDates[availableDates.length - 1] : today;
  const [selectedDate, setSelectedDate] = useState(latestDate);

  useEffect(() => {
    if (!selectedDate || selectedDate > today) {
      setSelectedDate(latestDate);
      return;
    }
    if (availableDates.length > 0 && !flowByDate.has(selectedDate)) {
      setSelectedDate(latestDate);
    }
  }, [availableDates, flowByDate, latestDate, selectedDate, today]);

  const row = flowByDate.get(selectedDate);
  const selectedBalance = balance?.find((item) => item.date === selectedDate);
  const selectedIndex = availableDates.indexOf(selectedDate);

  const pointData = POINT_KEYS.map((key) => {
    const meta = POINT_GEOGRAPHY[key];
    const source = sourceFor(row, key);
    const value = source ? row?.[key] ?? null : null;
    const update = row?.point_last_update?.[key];
    return { key, meta, source, value, update };
  });

  const publishedCount = pointData.filter((point) => point.source).length;
  const provisionalCount = pointData.filter(
    (point) => point.source === "renomination" || point.source === "nomination",
  ).length;
  const totalFlowToSerbia = row
    ? row.kiskundorozsma_hu + row.kireevo + row.kalotina
    : null;
  const bosniaFlow = selectedBalance?.bosnia_consumption_mcm ?? null;

  const goPrevious = () => {
    if (selectedIndex > 0) setSelectedDate(availableDates[selectedIndex - 1]);
  };

  const goNext = () => {
    if (selectedIndex >= 0 && selectedIndex < availableDates.length - 1) {
      setSelectedDate(availableDates[selectedIndex + 1]);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">
              Serbia pipeline flow map
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Daily ENTSOG operational data. Border points are geographically placed;
            pipeline paths inside Serbia are schematic.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            onClick={goPrevious}
            disabled={selectedIndex <= 0}
            aria-label="Previous ENTSOG gas day"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <input
            type="date"
            value={selectedDate}
            min={availableDates[0]}
            max={latestDate}
            onChange={(event) => {
              const next = event.target.value;
              if (flowByDate.has(next)) setSelectedDate(next);
            }}
            className="h-9 rounded-md border bg-background px-3 text-sm font-medium text-foreground"
            aria-label="Select ENTSOG gas day"
          />

          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            onClick={goNext}
            disabled={
              selectedIndex < 0 || selectedIndex >= availableDates.length - 1
            }
            aria-label="Next ENTSOG gas day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <button
            type="button"
            className="h-9 rounded-md border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            onClick={() => setSelectedDate(latestDate)}
            disabled={selectedDate === latestDate}
          >
            Latest
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(270px,0.65fr)]">
        <div className="overflow-x-auto border-b bg-muted/15 lg:border-b-0 lg:border-r">
          <svg
            viewBox="0 0 880 600"
            role="img"
            aria-label={`Natural gas flows around Serbia for ${selectedDate}`}
            className="h-auto min-w-[720px] w-full"
          >
            <defs>
              {pointData.map(({ key, meta }) => (
                <marker
                  key={key}
                  id={`flow-arrow-${key}`}
                  markerWidth="10"
                  markerHeight="10"
                  refX="8"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L0,6 L9,3 z" fill={meta.color} />
                </marker>
              ))}
              <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow
                  dx="0"
                  dy="2"
                  stdDeviation="3"
                  floodColor="#0f172a"
                  floodOpacity="0.12"
                />
              </filter>
            </defs>

            <rect x="0" y="0" width="880" height="600" fill="var(--muted)" opacity="0.18" />

            <text x="380" y="38" textAnchor="middle" className="fill-muted-foreground text-[17px] font-medium">
              HUNGARY
            </text>
            <text x="742" y="170" textAnchor="middle" className="fill-muted-foreground text-[15px] font-medium">
              ROMANIA
            </text>
            <text x="755" y="554" textAnchor="middle" className="fill-muted-foreground text-[16px] font-medium">
              BULGARIA
            </text>
            <text x="120" y="348" textAnchor="middle" className="fill-muted-foreground text-[15px] font-medium">
              BOSNIA & HERZEGOVINA
            </text>
            <text x="154" y="150" textAnchor="middle" className="fill-muted-foreground text-[15px] font-medium">
              CROATIA
            </text>
            <text x="300" y="575" textAnchor="middle" className="fill-muted-foreground text-[14px] font-medium">
              MONTENEGRO
            </text>
            <text x="516" y="582" textAnchor="middle" className="fill-muted-foreground text-[13px] font-medium">
              NORTH MACEDONIA
            </text>

            <path
              d="M300 86 L452 90 L500 130 L540 177 L601 207 L637 259 L650 319 L627 365 L618 421 L587 484 L555 514 L511 522 L472 555 L421 568 L376 551 L340 522 L309 478 L270 451 L258 402 L276 356 L252 310 L269 263 L257 220 L275 174 L299 139 Z"
              fill="var(--card)"
              stroke="var(--border)"
              strokeWidth="2.5"
              filter="url(#soft-shadow)"
            />
            <text
              x="430"
              y="270"
              textAnchor="middle"
              className="fill-foreground text-[28px] font-semibold tracking-[0.18em]"
              opacity="0.18"
            >
              SERBIA
            </text>

            <g transform="translate(330 338)">
              <rect x="0" y="0" width="200" height="64" rx="10" fill="var(--card)" stroke="var(--border)" />
              <text x="12" y="19" className="fill-muted-foreground text-[10px] font-medium">TOTAL FLOW TO SERBIA</text>
              <text x="12" y="44" className="fill-foreground text-[19px] font-bold">
                {totalFlowToSerbia == null ? "—" : `${fmtMcm(totalFlowToSerbia)} mcm/d`}
              </text>
              <text x="188" y="44" textAnchor="end" className="fill-muted-foreground text-[9px]">HU + BG</text>
            </g>

            <path
              d="M 405 350 Q 300 365 220 350"
              fill="none"
              stroke={PALETTE.demand}
              strokeWidth={strokeWidth(bosniaFlow)}
              strokeLinecap="round"
              strokeDasharray="8 6"
              opacity={bosniaFlow != null ? 0.78 : 0.25}
              markerEnd="url(#flow-arrow-kiskundorozsma_hu)"
            />
            <g transform="translate(38 382)">
              <rect x="0" y="0" width="178" height="58" rx="9" fill="var(--card)" stroke="var(--border)" />
              <text x="10" y="19" className="fill-muted-foreground text-[10px] font-medium">BOSNIA FLOW</text>
              <text x="10" y="41" className="fill-foreground text-[17px] font-bold">
                {bosniaFlow == null ? "—" : `${fmtMcm(bosniaFlow)} mcm/d`}
              </text>
              <text x="168" y="41" textAnchor="end" className="fill-muted-foreground text-[9px]">MODEL</text>
            </g>

            <g transform="translate(550 238)">
              <rect x="0" y="0" width="180" height="68" rx="10" fill="var(--card)" stroke="var(--border)" />
              <text x="12" y="19" className="fill-muted-foreground text-[10px] font-medium">SERBIA STORAGE</text>
              <text x="12" y="44" className="fill-foreground text-[19px] font-bold">
                {storage?.full == null ? "—" : `${storage.full.toFixed(1)}%`}
              </text>
              <text x="168" y="43" textAnchor="end" className="fill-muted-foreground text-[10px]">
                {storage?.gasInStorage == null ? "AGSI+" : `${fmtMcm(storage.gasInStorage * 1000 / 10.55)} mcm`}
              </text>
              <text x="12" y="59" className="fill-muted-foreground text-[9px]">
                {storage?.gasDayStart ? `AGSI+ · ${storage.gasDayStart}` : "AGSI+ data unavailable"}
              </text>
            </g>

            <path
              d="M650 318 Q555 300 430 315 Q455 190 438 92"
              fill="none"
              stroke="var(--border)"
              strokeWidth="10"
              strokeLinecap="round"
              opacity="0.38"
            />
            <text
              x="518"
              y="202"
              transform="rotate(-54 518 202)"
              className="fill-muted-foreground text-[11px] font-medium"
            >
              Balkan Stream / Gastrans corridor
            </text>

            <path
              d="M315 96 Q330 205 430 315 Q525 420 584 500"
              fill="none"
              stroke="var(--border)"
              strokeWidth="8"
              strokeLinecap="round"
              opacity="0.32"
            />
            <text
              x="356"
              y="224"
              transform="rotate(57 356 224)"
              className="fill-muted-foreground text-[11px] font-medium"
            >
              Serbian transmission network
            </text>

            {pointData.map(({ key, meta, source, value }) => {
              const active = value != null && value > 0;
              return (
                <g key={key}>
                  <path
                    d={branchPath(meta)}
                    fill="none"
                    stroke={source ? meta.color : "var(--muted-foreground)"}
                    strokeWidth={strokeWidth(value)}
                    strokeLinecap="round"
                    strokeDasharray={
                      !source ? "5 7" : source === "physical_flow" ? undefined : "9 6"
                    }
                    opacity={source ? (active ? 0.92 : 0.48) : 0.28}
                    markerEnd={source ? `url(#flow-arrow-${key})` : undefined}
                  />
                  <circle
                    cx={meta.x}
                    cy={meta.y}
                    r="10"
                    fill="var(--card)"
                    stroke={meta.color}
                    strokeWidth="4"
                  />
                  <circle
                    cx={meta.x}
                    cy={meta.y}
                    r="3.5"
                    fill={source ? meta.color : "var(--muted-foreground)"}
                  />

                  <g transform={`translate(${meta.labelX} ${meta.labelY})`}>
                    <rect
                      x="0"
                      y="-30"
                      width={meta.labelWidth}
                      height="60"
                      rx="9"
                      fill="var(--card)"
                      stroke="var(--border)"
                    />
                    <text x="10" y="-8" className="fill-foreground text-[12px] font-semibold">
                      {meta.shortLabel}
                    </text>
                    <text x="10" y="12" className="fill-muted-foreground text-[11px]">
                      {meta.directionLabel}
                    </text>
                    <text
                      x={meta.labelWidth - 10}
                      y="11"
                      textAnchor="end"
                      className="fill-foreground text-[14px] font-bold"
                    >
                      {value == null ? "—" : `${fmtMcm(value)} mcm/d`}
                    </text>
                  </g>
                </g>
              );
            })}

            <g transform={`translate(${HUB.x} ${HUB.y})`}>
              <circle
                r="17"
                fill="var(--card)"
                stroke="var(--foreground)"
                strokeWidth="2"
              />
              <circle r="7" fill="var(--foreground)" opacity="0.75" />
              <text
                x="0"
                y="38"
                textAnchor="middle"
                className="fill-foreground text-[11px] font-semibold"
              >
                Serbian network
              </text>
            </g>
          </svg>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border bg-background px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Gas day
              </div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {selectedDate ? fmtShortDateYear(selectedDate) : "No data"}
              </div>
            </div>
            <div className="rounded-lg border bg-background px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Points available
              </div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {publishedCount}/{POINT_KEYS.length}
                {provisionalCount > 0 && (
                  <span className="ml-1 text-xs font-normal text-amber-700">
                    ({provisionalCount} provisional)
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {pointData.map(({ key, meta, source, value, update }) => (
              <div key={key} className="rounded-lg border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-foreground">
                      {POINTS[key]}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {meta.country} · {meta.directionLabel}
                    </div>
                  </div>
                  <div
                    className="shrink-0 rounded-md bg-muted/35 px-2 py-1 text-sm font-bold tabular-nums text-foreground"
                    style={{
                      borderLeft: `4px solid ${meta.color}`,
                    }}
                  >
                    {value == null ? "—" : fmtMcm(value)}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${sourceBadgeClass(
                      source,
                    )}`}
                  >
                    {sourceLabel(source)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {value == null ? "No daily value" : "mcm/day"} · {formatUpdate(update)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Bosnia flow is the dashboard balance-model allocation and is shown separately from ENTSOG border-point flows. Arrow direction is the gas-flow direction relative to Serbia. Line thickness
            scales with the selected day's published value. Dashed colored lines are
            current-day ENTSOG nomination/renomination values; grey dashed lines mean the
            point is missing for that gas day.
          </div>
        </div>
      </div>
    </section>
  );
}
