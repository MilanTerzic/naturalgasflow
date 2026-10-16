import type { FlowPointName, FlowRow } from "./types";

// Assumed technical upper bound for Gastrans delivery to Serbia's domestic
// transmission system, mcm/day. This is NOT Kireevo's total pipeline entry
// capacity. Update when dated TSO technical capacity becomes available.
export const GASTRANS_SERBIAN_EXIT_TECHNICAL_CAP_MCM = 11.5;

// This is a modelling constraint, not a measurement of actual Serbian offtake.
export function limitedGastransDomesticProxy(rawKireevoMinusHungaryMcm: number) {
  const nonNegativeResidual = Math.max(rawKireevoMinusHungaryMcm, 0);
  return {
    delivery_mcm: Math.min(nonNegativeResidual, GASTRANS_SERBIAN_EXIT_TECHNICAL_CAP_MCM),
    unreconciled_excess_mcm: Math.max(
      nonNegativeResidual - GASTRANS_SERBIAN_EXIT_TECHNICAL_CAP_MCM,
      0,
    ),
  };
}

const ENTRY_POINTS: FlowPointName[] = [
  "kiskundorozsma_hu",
  "kireevo",
  "kalotina",
];

export function hasOperationalObservation(
  row: FlowRow | undefined,
  point: FlowPointName,
): boolean {
  if (!row) return false;
  if (row.point_source?.[point]) return true;
  if (row.published_points) return row.published_points.includes(point);
  // A row with point-level provenance but no publication list has no evidence
  // for missing points. Legacy/demo rows with neither field are complete.
  return !row.point_source;
}

// Total border entry into the transmission system, including gas that
// subsequently transits to Hungary. Never interpret this as Serbian demand.
export function grossPipelineEntryMcm(row: FlowRow | undefined): number | null {
  if (!row || ENTRY_POINTS.some((point) => !hasOperationalObservation(row, point))) {
    return null;
  }
  return row.kiskundorozsma_hu + row.kireevo + row.kalotina;
}

// Cross-TSO proxy, not a measured domestic import. Can differ from offtake
// because of linepack, TSO publication timing, or other reconciliation items.
export function gastransAfterHungaryMcm(row: FlowRow | undefined): number | null {
  if (
    !row ||
    !hasOperationalObservation(row, "kireevo") ||
    !hasOperationalObservation(row, "kiskundorozsma_2")
  ) {
    return null;
  }
  return row.kireevo - row.kiskundorozsma_2;
}

export function isGastransResidualOutlier(row: FlowRow | undefined): boolean {
  const remaining = gastransAfterHungaryMcm(row);
  // Small tolerance for rounding; any material excess is a reconciliation issue.
  return remaining !== null && remaining > GASTRANS_SERBIAN_EXIT_TECHNICAL_CAP_MCM + 0.005;
}
