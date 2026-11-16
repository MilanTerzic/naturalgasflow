import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minus, Plus, Scan } from "lucide-react";
import geo from "@/lib/region/balkan-map.generated.json";
import {
  CITIES,
  CORRIDORS,
  COUNTRY_LABEL,
  FOCUS_COUNTRIES,
  STORAGE_SITES,
  type Corridor,
} from "@/lib/region/registry";
import { linkWidth, type LinkValue } from "@/lib/region/map-model";
import { cn } from "@/lib/utils";

type Pt = [number, number];
const LINES = geo.lines as unknown as Record<string, Pt[]>;
const NODES = geo.nodes as unknown as Record<string, Pt>;
const LABELS = geo.labels as unknown as Record<string, Pt>;
const W = geo.W;
const H = geo.H;

export interface MapLayers {
  serbia: boolean;
  regional: boolean;
  lng: boolean;
  planned: boolean;
  labels: boolean;
  cities: boolean;
  animate: boolean;
  /** Firm technical / booked capacity drawn as casings around the flow line. */
  capacity: boolean;
  /** Hub spot price tags under country names. */
  prices: boolean;
  /** Country net position (imports + storage + production + LNG − exports) tags. */
  netPosition: boolean;
}

export interface CountryBadge {
  text: string;
  /** "price" = own hub price, "ref" = reference hub, "none" = no price. */
  tone: "price" | "ref" | "none";
  title?: string;
}

/** Catmull-Rom → cubic Bézier through the corridor vertices. */
function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const PATHS: Record<string, string> = Object.fromEntries(
  CORRIDORS.filter((c) => LINES[c.id]).map((c) => [c.id, smoothPath(LINES[c.id])]),
);

interface View {
  k: number;
  x: number;
  y: number;
}
const HOME: View = { k: 1, x: 0, y: 0 };
const clampView = (v: View): View => {
  const k = Math.min(5, Math.max(1, v.k));
  return {
    k,
    x: Math.min(W - W / k, Math.max(0, v.x)),
    y: Math.min(H - H / k, Math.max(0, v.y)),
  };
};
/** 2× view centred on Serbia. */
const SERBIA_VIEW: View = clampView({
  k: 2,
  x: NODES.BEG[0] - W / 4,
  y: NODES.BEG[1] - H / 4 + 30,
});

export function BalkanFlowMap({
  values,
  selected,
  onSelect,
  layers,
  colorFor,
  formatValue,
  describe,
  className,
  overlay,
  countryBadges,
  netBadges,
}: {
  values: Record<string, LinkValue>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  layers: MapLayers;
  colorFor: (corridor: Corridor) => string;
  /** Compact label drawn next to the interconnection point. */
  formatValue: (value: number) => string;
  describe: (id: string) => ReactNode;
  className?: string;
  overlay?: ReactNode;
  countryBadges?: Record<string, CountryBadge>;
  /** Second row of tags (net position), keyed by map country name. */
  netBadges?: Record<string, CountryBadge>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(HOME);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const drag = useRef<{ px: number; py: number; view: View; moved: boolean } | null>(null);

  // One scale for flows and capacity so a line's fill against its casing reads as utilisation.
  const maxAbs = useMemo(
    () =>
      Math.max(
        1,
        ...Object.values(values)
          .flatMap((v) => [
            v.value === null ? 0 : Math.abs(v.value),
            layers.capacity ? (v.technical ?? 0) : 0,
          ])
          .filter(Number.isFinite),
      ),
    [values, layers.capacity],
  );

  const toMap = useCallback(
    (clientX: number, clientY: number): Pt => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return [0, 0];
      return [
        view.x + ((clientX - rect.left) / rect.width) * (W / view.k),
        view.y + ((clientY - rect.top) / rect.height) * (H / view.k),
      ];
    },
    [view],
  );

  const zoomAt = useCallback((factor: number, center?: Pt) => {
    setView((v) => {
      const cx = center?.[0] ?? v.x + W / v.k / 2;
      const cy = center?.[1] ?? v.y + H / v.k / 2;
      const k = Math.min(5, Math.max(1, v.k * factor));
      return clampView({ k, x: cx - (cx - v.x) * (v.k / k), y: cy - (cy - v.y) * (v.k / k) });
    });
  }, []);

  // Wheel zoom needs a non-passive listener to stop page scroll.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      // Plain wheel keeps scrolling the page; Ctrl/⌘ + wheel (or pinch) zooms the map.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAt(event.deltaY < 0 ? 1.2 : 1 / 1.2, toMap(event.clientX, event.clientY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [toMap, zoomAt]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const scale = 1 / view.k;
  const visible = (c: Corridor) =>
    (c.group === "serbia" || c.group === "model"
      ? layers.serbia
      : c.group === "regional"
        ? layers.regional && (!c.lng || layers.lng)
        : c.group === "planned"
          ? layers.planned
          : true) && Boolean(PATHS[c.id]);

  const hoverAt = (id: string, event: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ id, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const linkProps = (id: string, name: string) => ({
    role: "button" as const,
    tabIndex: 0,
    "aria-label": name,
    "aria-pressed": selected === id,
    onClick: (event: React.MouseEvent) => {
      if (drag.current?.moved) return;
      event.stopPropagation();
      onSelect(selected === id ? null : id);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(selected === id ? null : id);
      }
    },
    onMouseMove: (event: React.MouseEvent) => hoverAt(id, event),
    onMouseLeave: () => setHover(null),
    onFocus: () => {
      const pts = LINES[id];
      const rect = svgRef.current?.getBoundingClientRect();
      const wrap = wrapRef.current?.getBoundingClientRect();
      if (!pts || !rect || !wrap) return;
      const [mx, my] = pts[Math.min(1, pts.length - 1)];
      setHover({
        id,
        x: rect.left - wrap.left + ((mx - view.x) / (W / view.k)) * rect.width,
        y: rect.top - wrap.top + ((my - view.y) / (H / view.k)) * rect.height,
      });
    },
    onBlur: () => setHover(null),
  });

  const layerOrder = ["backbone", "planned", "regional", "model", "serbia"] as const;
  const corridors = CORRIDORS.filter(visible).sort(
    (a, b) => layerOrder.indexOf(a.group) - layerOrder.indexOf(b.group),
  );

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative overflow-hidden bg-[var(--map-sea)]",
        fullscreen && "fixed inset-0 z-50",
        className,
      )}
    >
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${W / view.k} ${H / view.k}`}
        className={cn("block h-auto w-full touch-none select-none", fullscreen && "h-full")}
        role="img"
        aria-label="Map of natural gas flows across the Balkans"
        onPointerDown={(e) => {
          drag.current = { px: e.clientX, py: e.clientY, view, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || e.buttons !== 1) return;
          const rect = svgRef.current!.getBoundingClientRect();
          const dx = ((e.clientX - d.px) / rect.width) * (W / d.view.k);
          const dy = ((e.clientY - d.py) / rect.height) * (H / d.view.k);
          if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 4) d.moved = true;
          if (d.moved) setView(clampView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy }));
        }}
        onPointerUp={() => {
          setTimeout(() => (drag.current = null), 0);
        }}
        onClick={() => !drag.current?.moved && onSelect(null)}
        onDoubleClick={(e) => zoomAt(1.6, toMap(e.clientX, e.clientY))}
      >
        <defs>
          <pattern id="balkan-grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M50 0 L0 0 0 50" fill="none" stroke="var(--map-grid)" strokeWidth={0.6} />
          </pattern>
          <filter id="balkan-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <rect width={W} height={H} fill="url(#balkan-grid)" />

        {geo.countries.map((c) => (
          <path
            key={c.name}
            d={c.d}
            fill={
              c.name === "Serbia"
                ? "var(--map-land-home)"
                : FOCUS_COUNTRIES.has(c.name)
                  ? "var(--map-land-core)"
                  : "var(--map-land)"
            }
            stroke={c.name === "Serbia" ? "var(--primary)" : "var(--map-stroke)"}
            strokeWidth={(c.name === "Serbia" ? 1.3 : 0.7) * scale}
          >
            <title>{c.name}</title>
          </path>
        ))}

        {Object.entries(LABELS).map(([name, [x, y]]) => (
          <text
            key={name}
            x={x}
            y={y}
            textAnchor="middle"
            className="pointer-events-none font-[family-name:var(--font-condensed)] uppercase"
            fontSize={(name === "Serbia" ? 13 : 10.5) * Math.max(scale, 0.55)}
            fontWeight={600}
            letterSpacing="0.14em"
            fill={name === "Serbia" ? "var(--primary)" : "var(--muted-foreground)"}
            opacity={name === "Serbia" ? 0.95 : 0.7}
          >
            {COUNTRY_LABEL[name] ?? name}
          </text>
        ))}

        {(
          [
            [layers.prices ? countryBadges : undefined, 0],
            [layers.netPosition ? netBadges : undefined, 1],
          ] as const
        ).flatMap(([set, rowIdx]) =>
          Object.entries(set ?? {}).map(([name, badge]) => {
            const row = rowIdx === 1 && layers.prices && countryBadges?.[name] ? 1 : 0;
            const at = LABELS[name];
            if (!at) return null;
            const k = Math.max(scale, 0.6);
            const w = (badge.text.length * 5.6 + 12) * k;
            const h = 15 * k;
            const [x, y] = [at[0], at[1] + 8 * k + row * 17 * k];
            const fill =
              badge.tone === "price"
                ? "var(--primary)"
                : badge.tone === "ref"
                  ? "var(--card)"
                  : "var(--surface-2)";
            const ink =
              badge.tone === "price" ? "var(--primary-foreground)" : "var(--muted-foreground)";
            return (
              <g key={`badge-${rowIdx}-${name}`} className="pointer-events-auto">
                <title>{badge.title ?? badge.text}</title>
                <rect
                  x={x - w / 2}
                  y={y}
                  width={w}
                  height={h}
                  rx={h / 2}
                  fill={fill}
                  stroke={badge.tone === "price" ? "none" : "var(--border-strong)"}
                  strokeWidth={0.8 * k}
                  strokeDasharray={badge.tone === "none" ? `${2 * k} ${2 * k}` : undefined}
                  opacity={0.95}
                />
                <text
                  x={x}
                  y={y + h * 0.7}
                  textAnchor="middle"
                  fontSize={9.5 * k}
                  fontWeight={600}
                  fill={ink}
                  className="num"
                >
                  {badge.text}
                </text>
              </g>
            );
          }),
        )}

        {corridors.map((c) => {
          const d = PATHS[c.id];
          if (c.group === "backbone") {
            return (
              <path
                key={c.id}
                d={d}
                fill="none"
                stroke="var(--muted-foreground)"
                strokeWidth={1.2 * scale}
                opacity={0.35}
              />
            );
          }
          if (c.group === "planned") {
            return (
              <g
                key={c.id}
                {...linkProps(c.id, `${c.name} (planned)`)}
                className="cursor-pointer outline-none"
              >
                <path
                  d={d}
                  fill="none"
                  stroke="var(--planned)"
                  strokeWidth={1.8 * scale}
                  strokeDasharray={`${1 * scale} ${5 * scale}`}
                  strokeLinecap="round"
                  opacity={selected && selected !== c.id ? 0.35 : 0.85}
                />
                <path d={d} fill="none" stroke="transparent" strokeWidth={16 * scale} />
              </g>
            );
          }
          const v = values[c.id];
          const color = colorFor(c);
          const has = v && v.value !== null && v.value !== 0;
          const dim = selected !== null && selected !== c.id;
          const w = linkWidth(v?.value ?? null, maxAbs) * scale;
          const reverse = (v?.value ?? 0) < 0;
          const dashed = v?.status === "provisional" || v?.status === "model";
          return (
            <g
              key={c.id}
              {...linkProps(c.id, c.name)}
              className="cursor-pointer outline-none [&:focus-visible>path:nth-child(2)]:stroke-[var(--ring)]"
            >
              {layers.capacity && v?.technical != null && v.technical > 0 && (
                <>
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={linkWidth(v.technical, maxAbs) * scale + 4 * scale}
                    strokeLinecap="round"
                    opacity={dim ? 0.04 : 0.16}
                  />
                  {v.booked != null && v.booked > 0 && (
                    <path
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={linkWidth(v.booked, maxAbs) * scale + 2 * scale}
                      strokeLinecap="round"
                      opacity={dim ? 0.06 : 0.34}
                    />
                  )}
                </>
              )}
              {has ? (
                <>
                  {!layers.capacity && (
                    <path
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={w * 2.4}
                      opacity={dim ? 0.05 : 0.18}
                      filter="url(#balkan-glow)"
                    />
                  )}
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={w}
                    strokeLinecap="round"
                    strokeDasharray={dashed ? `${8 * scale} ${5 * scale}` : undefined}
                    opacity={dim ? 0.3 : 0.95}
                  />
                  {layers.animate && (
                    <path
                      d={d}
                      fill="none"
                      stroke="#fff"
                      strokeWidth={Math.max(1.2 * scale, w * 0.32)}
                      strokeLinecap="round"
                      className={cn("flow-animated", reverse && "reverse")}
                      style={{
                        strokeDasharray: `${2 * scale} ${12 * scale}`,
                        animationDuration: `${Math.max(0.9, 3.6 - 2.6 * Math.sqrt(Math.abs(v!.value!) / maxAbs))}s`,
                      }}
                      opacity={dim ? 0.2 : 0.8}
                    />
                  )}
                </>
              ) : (
                <path
                  d={d}
                  fill="none"
                  stroke={v?.value === 0 ? color : "var(--muted-foreground)"}
                  strokeWidth={1.6 * scale}
                  strokeDasharray={`${4 * scale} ${4 * scale}`}
                  opacity={dim ? 0.2 : 0.55}
                />
              )}
              <path d={d} fill="none" stroke="transparent" strokeWidth={18 * scale} />
            </g>
          );
        })}

        {/* Interconnection markers and value labels on top of all lines. */}
        {corridors
          .filter((c) => c.group !== "backbone" && c.group !== "planned")
          .map((c) => {
            const pts = LINES[c.id];
            const v = values[c.id];
            const color = colorFor(c);
            const has = v && v.value !== null && v.value !== 0;
            const [x, y] = c.lng ? pts[1] : pts[Math.min(c.ip ?? 1, pts.length - 1)];
            const dim = selected !== null && selected !== c.id;
            return (
              <g key={`ip-${c.id}`} className="pointer-events-none" opacity={dim ? 0.45 : 1}>
                {has && !c.lng && (
                  <circle
                    cx={x}
                    cy={y}
                    r={6 * scale}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5 * scale}
                    className="ip-pulse"
                  />
                )}
                {c.lng ? (
                  <>
                    <circle
                      cx={x}
                      cy={y}
                      r={6.5 * scale}
                      fill="var(--status-warning)"
                      stroke="var(--map-sea)"
                      strokeWidth={1.5 * scale}
                    />
                    <text
                      x={x}
                      y={y + 3 * scale}
                      textAnchor="middle"
                      fontSize={7 * scale}
                      fontWeight={700}
                      fill="#111"
                    >
                      L
                    </text>
                  </>
                ) : (
                  <circle
                    cx={x}
                    cy={y}
                    r={(c.group === "serbia" ? 5.5 : 4.2) * scale}
                    fill={has ? color : "var(--card)"}
                    stroke={has ? "var(--map-sea)" : color}
                    strokeWidth={1.6 * scale}
                  />
                )}
                {layers.labels && has && (
                  <text
                    x={x + 9 * scale}
                    y={y - 8 * scale}
                    fontSize={10.5 * Math.max(scale, 0.6)}
                    fontWeight={600}
                    fill={color}
                    stroke="var(--map-sea)"
                    strokeWidth={3 * scale}
                    paintOrder="stroke"
                    className="num"
                  >
                    {(v!.value! < 0 ? "⇄ " : "") +
                      formatValue(Math.abs(v!.value!)) +
                      (v!.status === "model" ? " (model)" : "") +
                      (layers.capacity && v!.technical
                        ? ` · ${Math.round((Math.abs(v!.value!) / v!.technical) * 100)}%`
                        : "")}
                  </text>
                )}
                {layers.labels &&
                  layers.capacity &&
                  has &&
                  (v!.status !== "model" || v!.technical) && (
                    <text
                      x={x + 9 * scale}
                      y={y + 4 * scale}
                      fontSize={8.5 * Math.max(scale, 0.6)}
                      fontWeight={500}
                      fill="var(--muted-foreground)"
                      stroke="var(--map-sea)"
                      strokeWidth={3 * scale}
                      paintOrder="stroke"
                      className="num"
                    >
                      {v!.technical
                        ? `B ${v!.booked != null ? formatValue(v!.booked) : "–"} / T ${formatValue(v!.technical)}` +
                          (v!.capacityRef
                            ? " (GY ref)"
                            : v!.capacityDate
                              ? ` (${v!.capacityDate.slice(5)})`
                              : "")
                        : "cap n/a"}
                    </text>
                  )}
              </g>
            );
          })}

        {layers.cities && (
          <g className="pointer-events-none">
            {CITIES.map(([node, name]) => {
              const [x, y] = NODES[node];
              return (
                <g key={node}>
                  <circle cx={x} cy={y} r={2.2 * scale} fill="var(--foreground)" opacity={0.7} />
                  <text
                    x={x + 5 * scale}
                    y={y - 4 * scale}
                    fontSize={9 * Math.max(scale, 0.6)}
                    fill="var(--muted-foreground)"
                  >
                    {name}
                  </text>
                </g>
              );
            })}
            {STORAGE_SITES.map(([node, name]) => {
              const [x, y] = NODES[node];
              return (
                <g key={node}>
                  <rect
                    x={x - 3 * scale}
                    y={y - 3 * scale}
                    width={6 * scale}
                    height={6 * scale}
                    transform={`rotate(45 ${x} ${y})`}
                    fill="none"
                    stroke="var(--flow)"
                    strokeWidth={1.3 * scale}
                  />
                  <text
                    x={x + 6 * scale}
                    y={y + 3 * scale}
                    fontSize={9 * Math.max(scale, 0.6)}
                    fill="var(--muted-foreground)"
                  >
                    {name}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {overlay}

      <div className="absolute right-3 bottom-3 flex flex-col gap-1">
        {[
          { icon: <Plus className="h-3.5 w-3.5" />, label: "Zoom in", on: () => zoomAt(1.4) },
          { icon: <Minus className="h-3.5 w-3.5" />, label: "Zoom out", on: () => zoomAt(1 / 1.4) },
          {
            icon: <Scan className="h-3.5 w-3.5" />,
            label: view.k === 1 ? "Zoom to Serbia" : "Reset view",
            on: () => setView(view.k === 1 ? SERBIA_VIEW : HOME),
          },
          {
            icon: <Maximize2 className="h-3.5 w-3.5" />,
            label: fullscreen ? "Exit full screen (Esc)" : "Full screen",
            on: () => setFullscreen((f) => !f),
          },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            title={b.label}
            aria-label={b.label}
            onClick={b.on}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-card/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
          >
            {b.icon}
          </button>
        ))}
      </div>

      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 w-64 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-[var(--shadow-pop)]"
          style={{
            left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 600) - 270),
            top: Math.min(hover.y + 14, (wrapRef.current?.clientHeight ?? 400) - 170),
          }}
        >
          {describe(hover.id)}
        </div>
      )}
    </div>
  );
}
