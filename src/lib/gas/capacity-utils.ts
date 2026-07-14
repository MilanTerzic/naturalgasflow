import { CONVERSION_MCM_TO_MWH } from "./config.ts";
import {
  CAPACITY_ROUTES,
  CAPACITY_ROUTE_BY_ID,
  capacityRouteLabel,
  type CapacityRouteDefinition,
} from "./capacity-routes.ts";
import type { CapacityRow, FlowRow } from "./types.ts";

export interface CapacityValue {
  value_mwh: number;
  source_date: string;
  last_update: string;
}

export interface CapacityRouteSummary {
  route: CapacityRouteDefinition;
  key: string;
  label: string;
  technical_mwh: number | null;
  booked_mwh: number | null;
  technical_mcm: number | null;
  booked_mcm: number | null;
  used_mcm: number | null;
  utilisation_booked: number | null;
  utilisation_used: number | null;
  flow_reference_date?: string;
  capacity_reference_date?: string;
  capacity_source_date?: string;
  source?: CapacityRow["source"];
  data_status: CapacityRow["data_status"];
  is_proxy: boolean;
  is_carried_forward: boolean;
  is_stale: boolean;
  warning?: string;
  row?: CapacityRow;
  perDate: { date: string; used_mcm: number | null; util_pct: number | null }[];
}

export interface CapacityAggregateSummary {
  technical_mcm: number | null;
  booked_mcm: number | null;
  used_mcm: number | null;
  technical_available: boolean;
  booked_available: boolean;
  used_available: boolean;
  route_count: number;
  hint: string;
}

export function capacityUnitToMwhDay(value: number, unit: string): number {
  if (!Number.isFinite(value)) throw new Error("Invalid numeric capacity value");
  if (value < 0) throw new Error("Negative capacity value");

  const normalized = unit.trim().toLowerCase().replace(/\s+/g, "");
  if (["kwh/d", "kwh/day"].includes(normalized)) return value / 1000;
  if (["mwh/d", "mwh/day"].includes(normalized)) return value;
  if (["gwh/d", "gwh/day"].includes(normalized)) return value * 1000;
  if (["kwh/h", "kwh/hour"].includes(normalized)) return (value * 24) / 1000;

  throw new Error(`Unsupported capacity unit: ${unit}`);
}

export function mwhDayToMcmDay(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : value / CONVERSION_MCM_TO_MWH;
}

export function latestMeasuredFlowRow(flows: FlowRow[]): FlowRow | undefined {
  return [...flows]
    .sort((a, b) => b.date.localeCompare(a.date))
    .find(
      (flow) =>
        flow.kiskundorozsma_hu > 0 ||
        flow.kireevo > 0 ||
        flow.kalotina > 0 ||
        flow.kiskundorozsma_2 > 0,
    );
}

export function capacityRowMatchesRoute(row: CapacityRow, route: CapacityRouteDefinition) {
  if (row.route_id) return row.route_id === route.id;
  return (
    row.tso === route.operator &&
    normalizePoint(row.border_point) === normalizePoint(route.borderPoint) &&
    row.direction === route.direction
  );
}

export function normalizePoint(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .trim();
}

export function selectCapacityForReferenceDate(
  capacity: CapacityRow[],
  routeId: string,
  referenceDate?: string,
): CapacityRow | undefined {
  if (!referenceDate) return undefined;
  const route = CAPACITY_ROUTE_BY_ID.get(routeId);
  if (!route) return undefined;
  return capacity
    .filter(
      (row) =>
        capacityRowMatchesRoute(row, route) &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.period) &&
        row.period <= referenceDate,
    )
    .sort((a, b) => b.period.localeCompare(a.period))[0];
}

export function buildCapacityRouteSummaries(
  capacity: CapacityRow[],
  flows: FlowRow[],
): CapacityRouteSummary[] {
  const flowRow = latestMeasuredFlowRow(flows);
  const flowReferenceDate = flowRow?.date;

  return CAPACITY_ROUTES.map((route) => {
    const row = selectCapacityForReferenceDate(capacity, route.id, flowReferenceDate);
    const technicalMwh = row?.technical_mwh ?? (row ? row.offered_mwh : null);
    const bookedMwh = row?.booked_mwh ?? null;
    const technicalMcm = mwhDayToMcmDay(technicalMwh);
    const bookedMcm = mwhDayToMcmDay(bookedMwh);
    const usedMcm = flowRow ? (flowRow[route.physicalFlowKey] ?? null) : null;
    const capacitySourceDate = row?.source_date ?? row?.capacity_source_date ?? row?.period;
    const capacityReferenceDate = row?.period;

    const utilisationBooked =
      technicalMcm != null && technicalMcm > 0 && bookedMcm != null
        ? (bookedMcm / technicalMcm) * 100
        : null;
    const utilisationUsed =
      technicalMcm != null && technicalMcm > 0 && usedMcm != null
        ? (usedMcm / technicalMcm) * 100
        : null;

    return {
      route,
      key: route.id,
      label: capacityRouteLabel(route),
      technical_mwh: technicalMwh,
      booked_mwh: bookedMwh,
      technical_mcm: technicalMcm,
      booked_mcm: bookedMcm,
      used_mcm: usedMcm,
      utilisation_booked: utilisationBooked,
      utilisation_used: utilisationUsed,
      flow_reference_date: flowReferenceDate,
      capacity_reference_date: capacityReferenceDate,
      capacity_source_date: capacitySourceDate,
      source: row?.source,
      data_status: row?.data_status ?? "unavailable",
      is_proxy: !!row?.is_proxy || route.sourceStrategy === "counterparty-proxy",
      is_carried_forward: !!row?.is_carried_forward,
      is_stale: !!row?.is_stale,
      warning: row?.warning,
      row,
      perDate: flows.map((flow) => {
        const used = flow[route.physicalFlowKey] ?? null;
        return {
          date: flow.date,
          used_mcm: used,
          util_pct:
            technicalMcm != null && technicalMcm > 0 && used != null
              ? (used / technicalMcm) * 100
              : null,
        };
      }),
    };
  });
}

export function deduplicateCapacityAggregate(
  summaries: CapacityRouteSummary[],
): CapacityAggregateSummary {
  const byPhysicalKey = new Map<string, CapacityRouteSummary>();
  for (const summary of summaries) {
    const key = summary.route.physicalFlowKey;
    const existing = byPhysicalKey.get(key);
    if (!existing) {
      byPhysicalKey.set(key, summary);
      continue;
    }
    if (existing.is_proxy && !summary.is_proxy) {
      byPhysicalKey.set(key, summary);
    }
  }

  const unique = [...byPhysicalKey.values()];
  const technicalValues = unique.map((r) => r.technical_mcm).filter(isNumber);
  const bookedValues = unique.map((r) => r.booked_mcm).filter(isNumber);
  const usedValues = unique.map((r) => r.used_mcm).filter(isNumber);

  return {
    technical_mcm: technicalValues.length ? sum(technicalValues) : null,
    booked_mcm: bookedValues.length ? sum(bookedValues) : null,
    used_mcm: usedValues.length ? sum(usedValues) : null,
    technical_available: technicalValues.length > 0,
    booked_available: bookedValues.length > 0,
    used_available: usedValues.length > 0,
    route_count: unique.length,
    hint: "Aggregate totals deduplicate paired operator sides.",
  };
}

export function isNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
