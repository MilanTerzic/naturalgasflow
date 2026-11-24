import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchEntsogAllocations } from "@/lib/data/entsog.functions";
import { buildHuStorage, HU_STORAGE_ANCHORS } from "@/lib/gas/srbijagas-hu-storage";
import type { FlowRow } from "@/lib/gas/types";
import { pointSource } from "@/lib/region/map-model";

type Nomination = { gas_day: string; nominated_mwh: number };

/**
 * Loads what the Srbijagas HU storage chart needs: ENTSOG allocation at Kiskundorozsma
 * (HU→RS) since the Others opening day, and MET nominations from the caller (session or
 * newsletter token). Returns rows through `today`.
 */
export function useHuStorage(
  today: string,
  loadNominations: (from: string, to: string) => Promise<Nomination[]>,
  key: string,
) {
  const from =
    HU_STORAGE_ANCHORS.others.date < HU_STORAGE_ANCHORS.met.date
      ? HU_STORAGE_ANCHORS.others.date
      : HU_STORAGE_ANCHORS.met.date;
  // Saved observations render immediately; the live query then fills missing days.
  const saved = useQuery({
    queryKey: ["hu-storage-alloc-saved", from, today],
    queryFn: () => fetchEntsogAllocations({ data: { from, to: today, savedOnly: true } }),
    staleTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const live = useQuery({
    queryKey: ["hu-storage-alloc", from, today],
    queryFn: () => fetchEntsogAllocations({ data: { from, to: today } }),
    staleTime: 10 * 60_000,
    retry: 2,
    retryDelay: 20_000,
    refetchOnWindowFocus: false,
  });
  const alloc = live.data ? live : saved.data?.data?.length ? saved : live;
  const noms = useQuery({
    // Shares the "met-hu-nominations" prefix so saving a nomination refreshes this chart.
    queryKey: ["met-hu-nominations", "hu-storage", key, from, today],
    queryFn: () => loadNominations(from, today),
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const rows = useMemo(() => {
    if (!alloc.data || !noms.data) return [];
    const entry = new Map<string, number | null>(
      (alloc.data.data ?? []).map((r: FlowRow) => [
        r.date,
        pointSource(r, "kiskundorozsma_hu", "allocation") === "allocation"
          ? r.kiskundorozsma_hu
          : null,
      ]),
    );
    const nominations = new Map(noms.data.map((n) => [n.gas_day, n.nominated_mwh]));
    return buildHuStorage({ huEntryMcm: entry, nominationsMwh: nominations, to: today });
  }, [alloc.data, noms.data, today]);
  return {
    rows,
    isLoading: (!alloc.data && live.isLoading) || noms.isLoading,
    settled: (live.isSuccess || live.isError) && (noms.isSuccess || noms.isError),
    error: live.isError && !alloc.data
      ? `ENTSOG allocation: ${(live.error as Error).message}`
      : noms.isError
        ? `MET nominations: ${(noms.error as Error).message}`
        : null,
  };
}

export const HU_STORAGE_NOTE = `MET: ${HU_STORAGE_ANCHORS.met.mcm} mcm at the start of ${HU_STORAGE_ANCHORS.met.date}, moved by saved MET nominations (no nomination = 0). Others: ${HU_STORAGE_ANCHORS.others.mcm} mcm at the start of ${HU_STORAGE_ANCHORS.others.date}, minus daily ENTSOG allocation at Kiskundorozsma (Horgoš 1, HU→RS) that was not MET; stops where allocation is not yet published.`;
