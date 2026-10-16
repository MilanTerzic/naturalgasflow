import type { FlowPointName, FlowRow } from "./types";

// Indicative Gastrans exit capacity into the Serbian network, in mcm/day.
// This is a reference for identifying suspect reconciliations, not a hard
// physical limit or a substitute for dated TSO capacity publications.
export const GASTRANS_SERBIAN_EXIT_REFERENCE_MCM = 11.51;

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
  // A small margin avoids warnings for rounding and minor operational timing.
  return remaining !== null && remaining > GASTRANS_SERBIAN_EXIT_REFERENCE_MCM + 0.5;
}
