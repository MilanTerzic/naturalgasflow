import { CONVERSION_MCM_TO_MWH } from "./config";

export interface MetHuNomination {
  gas_day: string;
  nominated_mwh: number;
  updated_at: string;
  updated_by_email: string;
}

export type HungarySplit = {
  metMcm: number | null;
  othersMcm: number | null;
  unattributedMcm: number | null;
  mismatchMcm: number | null;
  status: "split" | "default_zero" | "missing_nomination" | "missing_allocation" | "over_nomination";
};

// The ENTSOG HU→RS allocation is authoritative for the total. MET is a manual
// nomination and the residual is not a metered measurement of third-party gas.
// By agreement, a day with no saved nomination defaults MET to 0 and the whole
// observed Hungary entry is attributed to "Others". Only when a saved
// nomination exceeds the observed total does the split stay unreconciled.
export function splitHungaryEntry(
  totalHungaryMcm: number | null,
  metNominationMwh: number | null,
): HungarySplit {
  if (totalHungaryMcm === null || !Number.isFinite(totalHungaryMcm) || totalHungaryMcm < 0) {
    return {
      metMcm: null, othersMcm: null, unattributedMcm: null,
      mismatchMcm: null, status: "missing_allocation",
    };
  }
  if (metNominationMwh === null || !Number.isFinite(metNominationMwh) || metNominationMwh < 0) {
    return {
      metMcm: 0, othersMcm: totalHungaryMcm, unattributedMcm: null,
      mismatchMcm: null, status: "default_zero",
    };
  }
  const metMcm = metNominationMwh / CONVERSION_MCM_TO_MWH;
  const excess = metMcm - totalHungaryMcm;
  // If the nominated amount is greater than observed ENTSOG Allocation,
  // it is not possible to construct a non-negative "Others" segment. Keep
  // the source total visible and call attention to the mismatch instead.
  if (excess > 1e-6) {
    return {
      metMcm: null, othersMcm: null, unattributedMcm: totalHungaryMcm,
      mismatchMcm: excess, status: "over_nomination",
    };
  }
  return {
    metMcm: Math.min(metMcm, totalHungaryMcm),
    othersMcm: Math.max(0, totalHungaryMcm - metMcm),
    unattributedMcm: null,
    mismatchMcm: null,
    status: "split",
  };
}
