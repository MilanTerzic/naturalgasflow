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
}

const POINT_KEYS = Object.keys(ENTSOG_POINT_DIRECTIONS) as FlowPoint[];

async function fetchPoint(
  pd: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const url =
    `https://transparency.entsog.eu/api/v1/operationaldata.json` +
    `?pointDirection=${encodeURIComponent(pd)}` +
    `&from=${from}&to=${to}` +
    `&indicator=Physical%20Flow&periodType=day&limit=-1`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ENTSOG ${pd}: HTTP ${res.status}`);
  const json = (await res.json()) as { operationalData?: EntsogOperationalRow[] };
  const out = new Map<string, number>();
  for (const r of json.operationalData ?? []) {
    if (r.value == null || !r.periodFrom) continue;
    const date = r.periodFrom.slice(0, 10);
    const unit = (r.unit ?? "kWh/d").toLowerCase();
    let mcm: number;
    if (unit.startsWith("kwh")) mcm = kwhPerDayToMcmPerDay(r.value);
    else if (unit.startsWith("mwh")) mcm = r.value / 10_550;
    else mcm = kwhPerDayToMcmPerDay(r.value);
    // Sum if multiple sub-entries per day.
    out.set(date, (out.get(date) ?? 0) + mcm);
  }
  return out;
}

export const fetchEntsogFlows = createServerFn({ method: "POST" })
  .inputValidator((d: FetchFlowArgs) => d)
  .handler(async ({ data }): Promise<{ data: FlowRow[]; error: string | null }> => {
    try {
      const perPoint = await Promise.all(
        POINT_KEYS.map(async (key) => {
          try {
            const m = await fetchPoint(ENTSOG_POINT_DIRECTIONS[key], data.from, data.to);
            return [key, m] as const;
          } catch (err) {
            console.warn(`ENTSOG point ${key} failed:`, err);
            return [key, new Map<string, number>()] as const;
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
        for (const [key, m] of perPoint) row[key] = +(m.get(date) ?? 0).toFixed(4);
        return row;
      });
      return { data: rows, error: null };
    } catch (err) {
      console.error("ENTSOG fetch failed", err);
      return { data: [], error: err instanceof Error ? err.message : "Unknown error" };
    }
  });
