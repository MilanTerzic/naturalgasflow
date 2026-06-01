// ENTSOG Transparency Platform — operational data (Physical Flow), no token.
import { createServerFn } from "@tanstack/react-start";
import {
  ENTSOG_POINT_DIRECTIONS,
  kwhPerDayToMcmPerDay,
  type FlowPoint,
} from "@/lib/gas/config";
import type { FlowRow } from "@/lib/gas/types";

interface FetchFlowArgs {
  from: string;
  to: string;
}

interface EntsogOperationalRow {
  pointKey?: string;
  pointDirection?: string;
  periodFrom?: string;
  periodTo?: string;
  periodType?: string;
  value?: number | null;
  unit?: string;
  indicator?: string;
  lastUpdateDateTime?: string;
}

const POINT_KEYS = Object.keys(ENTSOG_POINT_DIRECTIONS) as FlowPoint[];

interface DailyPick {
  value_mcm: number;
  unit: string;
  raw_value: number;
  last_update: string;
  period_type: string;
}

async function fetchPoint(
  pd: string,
  from: string,
  to: string,
): Promise<Map<string, DailyPick>> {
  const url =
    `https://transparency.entsog.eu/api/v1/operationaldata.json` +
    `?pointDirection=${encodeURIComponent(pd)}` +
    `&from=${from}&to=${to}` +
    `&indicator=Physical%20Flow&periodType=day&limit=-1`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ENTSOG ${pd}: HTTP ${res.status}`);
  const json = (await res.json()) as {
    operationaldata?: EntsogOperationalRow[];
    operationalData?: EntsogOperationalRow[];
  };
  const rows = json.operationaldata ?? json.operationalData ?? [];

  // De-duplication: group by gas day. For each day, keep ONE value.
  // ENTSOG sometimes returns multiple records per day (revisions, sub-periods).
  // We pick the record with the latest lastUpdateDateTime. This avoids the
  // duplicated/inflated-today bug caused by summing sub-entries.
  const byDate = new Map<string, DailyPick>();
  for (const r of rows) {
    if (r.value == null || !r.periodFrom) continue;
    const date = r.periodFrom.slice(0, 10);
    const unit = (r.unit ?? "kWh/d").toLowerCase();
    let mcm: number;
    if (unit.startsWith("kwh")) mcm = kwhPerDayToMcmPerDay(r.value);
    else if (unit.startsWith("mwh")) mcm = r.value / 10_550;
    else if (unit.startsWith("gwh")) mcm = r.value / 10.55;
    else mcm = kwhPerDayToMcmPerDay(r.value);

    const lastUpdate = r.lastUpdateDateTime ?? "";
    const prev = byDate.get(date);
    if (!prev || lastUpdate >= prev.last_update) {
      byDate.set(date, {
        value_mcm: mcm,
        unit: r.unit ?? "kWh/d",
        raw_value: r.value,
        last_update: lastUpdate,
        period_type: r.periodType ?? "day",
      });
    }
  }
  return byDate;
}

export const fetchEntsogFlows = createServerFn({ method: "POST" })
  .inputValidator((d: FetchFlowArgs) => d)
  .handler(async ({ data }): Promise<{ data: FlowRow[]; error: string | null }> => {
    try {
      const perPoint = await Promise.all(
        POINT_KEYS.map(async (key) => {
          try {
            const m = await fetchPoint(ENTSOG_POINT_DIRECTIONS[key], data.from, data.to);
            console.log(
              `[ENTSOG] ${key}: ${m.size} unique gas-days returned ` +
                `(window ${data.from} → ${data.to})`,
            );
            return [key, m] as const;
          } catch (err) {
            console.warn(`ENTSOG point ${key} failed:`, err);
            return [key, new Map<string, DailyPick>()] as const;
          }
        }),
      );
      const allDates = new Set<string>();
      for (const [, m] of perPoint) for (const d of m.keys()) allDates.add(d);
      const dates = Array.from(allDates).sort();
      const rows: FlowRow[] = dates.map((date) => {
        const row: FlowRow = {
          date,
          kiskundorozsma_hu: 0,
          kireevo: 0,
          kiskundorozsma_2: 0,
          kalotina: 0,
        };
        for (const [key, m] of perPoint) {
          const pick = m.get(date);
          row[key] = pick ? +pick.value_mcm.toFixed(4) : 0;
        }
        return row;
      });
      return { data: rows, error: null };
    } catch (err) {
      console.error("ENTSOG fetch failed", err);
      return { data: [], error: err instanceof Error ? err.message : "Unknown error" };
    }
  });
