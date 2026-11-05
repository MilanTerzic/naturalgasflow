import { CONVERSION_MCM_TO_MWH } from "./config";

export interface MetHuNomination {
  gas_day: string;
  nominated_mwh: number;
  updated_at: string;
  updated_by_email: string;
}

export function nextNominationDay(today: string): string {
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

export function nominationDays(dates: string[], today: string): string[] {
  const tomorrow = nextNominationDay(today);
  return [...new Set([today, tomorrow, ...dates])].sort((a, b) => {
    if (a === b) return 0;
    if (a === tomorrow) return -1;
    if (b === tomorrow) return 1;
    if (a === today) return -1;
    if (b === today) return 1;
    const pastA = a <= today;
    const pastB = b <= today;
    if (pastA !== pastB) return pastA ? -1 : 1;
    return pastA ? b.localeCompare(a) : a.localeCompare(b);
  });
}

export type HungarySplit = {
  metMcm: number | null;
  othersMcm: number | null;
  mismatchMcm: number | null;
  status: "split" | "default_zero" | "missing_allocation" | "over_nomination";
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
      metMcm: null, othersMcm: null,
      mismatchMcm: null, status: "missing_allocation",
    };
  }
  if (metNominationMwh === null || !Number.isFinite(metNominationMwh) || metNominationMwh < 0) {
    return {
      metMcm: 0, othersMcm: totalHungaryMcm,
      mismatchMcm: null, status: "default_zero",
    };
  }
  const metMcm = metNominationMwh / CONVERSION_MCM_TO_MWH;
  const excess = metMcm - totalHungaryMcm;
  // If the nominated amount is greater than observed ENTSOG Allocation,
  // keep the source total visible by attributing it to Others and flag
  // the mismatch in the tooltip/table instead of leaving a gap.
  if (excess > 1e-6) {
    return {
      metMcm: null, othersMcm: totalHungaryMcm,
      mismatchMcm: excess, status: "over_nomination",
    };
  }
  return {
    metMcm: Math.min(metMcm, totalHungaryMcm),
    othersMcm: Math.max(0, totalHungaryMcm - metMcm),
    mismatchMcm: null,
    status: "split",
  };
}
