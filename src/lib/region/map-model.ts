// Turns dashboard rows and the regional feed into per-corridor map values.
// Pure functions, relative imports only (unit-tested in tests/region-map-model.test.mjs).

import type { BalanceRow, FlowPointOperationalSource, FlowRow } from "../gas/types";
import { CORRIDORS, type Corridor } from "./registry";
import type { CorridorCapacity, RegionalCorridorSeries } from "./regional-feed";

export type LinkStatus =
  /** Primary ENTSOG series (Allocation or Physical Flow) for the gas day. */
  | "actual"
  /** Current-day ENTSOG nomination / renomination substitute. */
  | "provisional"
  /** Modelled value (Bosnia share). */
  | "model"
  /** Nothing published for this corridor / day. */
  | "missing";

export interface LinkValue {
  /** mcm/day, signed: negative means flow against the corridor's nominal direction. */
  value: number | null;
  status: LinkStatus;
  /** Gas day (or "from → to" for period averages) the value refers to. */
  label?: string;
  source?: FlowPointOperationalSource;
  /** Firm technical capacity in the direction of the flow, mcm/day. */
  technical?: number | null;
  /** Firm booked capacity in the direction of the flow, mcm/day. */
  booked?: number | null;
  /** Gas day the capacity figures belong to, when it differs from the flow day. */
  capacityDate?: string | null;
}

export type MapMode = "day" | "average";

export function pointSource(
  row: FlowRow | undefined,
  key: keyof Pick<FlowRow, "kiskundorozsma_hu" | "kireevo" | "kiskundorozsma_2" | "kalotina">,
  primary: "allocation" | "physical_flow",
): FlowPointOperationalSource | undefined {
  if (!row) return undefined;
  const explicit = row.point_source?.[key];
  if (explicit) return explicit;
  // Demo / legacy rows have no provenance: an absent publication list means present.
  if (!row.published_points || row.published_points.includes(key)) return primary;
  return undefined;
}

function serbianDay(
  corridor: Corridor,
  row: FlowRow | undefined,
  primary: "allocation" | "physical_flow",
): LinkValue {
  const key = corridor.point!;
  const source = pointSource(row, key, primary);
  if (!row || !source) return { value: null, status: "missing", label: row?.date };
  return {
    value: row[key],
    status: source === primary ? "actual" : "provisional",
    label: row.date,
    source,
  };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

/** Values for every corridor that can carry data, for one gas day or a period average. */
export function buildLinkValues({
  mode,
  date,
  rows,
  balance,
  primary,
  regional,
  capacity = null,
}: {
  mode: MapMode;
  /** Selected gas day (day mode). */
  date: string | null;
  /** Rows of the selected Serbian series, ascending, already limited to the period. */
  rows: FlowRow[];
  balance: BalanceRow[];
  primary: "allocation" | "physical_flow";
  regional: Record<string, RegionalCorridorSeries> | null;
  capacity?: Record<string, CorridorCapacity> | null;
}): Record<string, LinkValue> {
  const out: Record<string, LinkValue> = {};
  const periodLabel = rows.length ? `${rows[0].date} → ${rows[rows.length - 1].date}` : undefined;
  const row = date ? rows.find((r) => r.date === date) : undefined;
  const balanceByDate = new Map(balance.map((b) => [b.date, b]));
  const inPeriod = (d: string) =>
    !rows.length || (d >= rows[0].date && d <= rows[rows.length - 1].date);

  for (const corridor of CORRIDORS) {
    if (corridor.group === "serbia") {
      if (mode === "day") {
        out[corridor.id] = serbianDay(corridor, row, primary);
      } else {
        const values = rows
          .filter((r) => pointSource(r, corridor.point!, primary) === primary)
          .map((r) => r[corridor.point!]);
        const avg = mean(values);
        out[corridor.id] = {
          value: avg,
          status: avg === null ? "missing" : "actual",
          label: periodLabel,
        };
      }
    } else if (corridor.group === "model") {
      if (mode === "day") {
        const b = date ? balanceByDate.get(date) : undefined;
        out[corridor.id] = b
          ? { value: b.bosnia_consumption_mcm, status: "model", label: b.date }
          : { value: null, status: "missing", label: date ?? undefined };
      } else {
        const avg = mean(
          balance
            .filter((b) => !b.is_forecast && inPeriod(b.date))
            .map((b) => b.bosnia_consumption_mcm),
        );
        out[corridor.id] = {
          value: avg,
          status: avg === null ? "missing" : "model",
          label: periodLabel,
        };
      }
    } else if (corridor.group === "regional") {
      const series = regional?.[corridor.id];
      if (!series) {
        out[corridor.id] = { value: null, status: "missing" };
      } else if (mode === "day") {
        const day = date ? series.days.find((d) => d.date === date) : undefined;
        out[corridor.id] =
          day && day.net !== null
            ? { value: day.net, status: "actual", label: day.date, source: primary }
            : { value: null, status: "missing", label: date ?? undefined };
      } else {
        const values = series.days
          .filter((d) => d.net !== null && inPeriod(d.date))
          .map((d) => d.net as number);
        const avg = mean(values);
        out[corridor.id] = {
          value: avg,
          status: avg === null ? "missing" : "actual",
          label: periodLabel,
          source: primary,
        };
      }
    }
  }
  if (capacity) {
    for (const [id, v] of Object.entries(out)) {
      const cap = capacity[id];
      if (!cap) continue;
      const reverse = (v.value ?? 0) < 0;
      const pick = (d: CorridorCapacity["days"][number]) => ({
        technical: reverse ? d.reverseTechnical : d.forwardTechnical,
        booked: reverse ? d.reverseBooked : d.forwardBooked,
      });
      if (mode === "day") {
        // Exact gas day first; otherwise the latest published day before it (labelled as such).
        const day = date
          ? (cap.days.find((d) => d.date === date) ??
            [...cap.days].reverse().find((d) => d.date < date && pick(d).technical !== null))
          : undefined;
        if (day) {
          Object.assign(v, pick(day));
          if (day.date !== date) v.capacityDate = day.date;
        }
      } else {
        const picks = cap.days.filter((d) => inPeriod(d.date)).map(pick);
        const avgOf = (k: "technical" | "booked") =>
          mean(picks.map((p) => p[k]).filter((x): x is number => x !== null));
        v.technical = avgOf("technical");
        v.booked = avgOf("booked");
      }
    }
  }
  return out;
}

/** Stroke width in map units for a flow in mcm/day relative to the largest visible flow. */
export function linkWidth(value: number | null, max: number): number {
  if (value === null || !(max > 0)) return 1.6;
  return 2 + 11 * Math.sqrt(Math.min(1, Math.abs(value) / max));
}

/** Share in percent, or null when the base is missing or zero. */
export function sharePct(
  part: number | null | undefined,
  whole: number | null | undefined,
): number | null {
  if (part == null || whole == null || !(whole > 0)) return null;
  return (part / whole) * 100;
}
