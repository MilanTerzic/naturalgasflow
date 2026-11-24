// Srbijagas gas held in Hungarian storage, split into MET and Others.
// Relative imports only (unit-tested in tests/srbijagas-hu-storage.test.mjs).
//
// MET: a stated stock at the start of one gas day (anchor). Earlier days are rebuilt by
//   adding back MET nominations; later days subtract them. A day without a saved
//   nomination counts as 0, the same rule as the Hungary entry split.
// Others: a stated opening stock; every gas day subtracts the HU→RS entry at Horgoš 1
//   (ENTSOG allocation at Kiskundorozsma) that was not MET. The series stops at the first
//   day whose allocation is not published — nothing is filled in.

import { CONVERSION_MCM_TO_MWH } from "./config";

export interface HuStorageAnchors {
  others: { date: string; mcm: number };
  met: { date: string; mcm: number };
}

export const HU_STORAGE_ANCHORS: HuStorageAnchors = {
  /** Others stock at the start of this gas day, mcm. */
  others: { date: "2026-10-01", mcm: 201 },
  /** MET stock at the start of this gas day, mcm. */
  met: { date: "2026-11-24", mcm: 25.06 },
};

export interface HuStorageRow {
  date: string;
  /** End-of-gas-day stock, mcm; null when it cannot be derived. */
  met: number | null;
  others: number | null;
  total: number | null;
  /** Withdrawn that gas day, mcm. */
  metOut: number;
  othersOut: number | null;
  /** True when the HU allocation is smaller than the MET nomination (Others set to 0). */
  overNomination: boolean;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function huStorageDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * @param huEntryMcm ENTSOG allocation HU→RS at Kiskundorozsma per gas day; null/absent = not published.
 * @param nominationsMwh MET nominations per gas day (MWh); absent = 0.
 * @param to last gas day to report (MET continues on nominations; Others stops at missing allocation).
 */
export function buildHuStorage(args: {
  huEntryMcm: Map<string, number | null>;
  nominationsMwh: Map<string, number>;
  to: string;
  anchors?: HuStorageAnchors;
}): HuStorageRow[] {
  const anchors = args.anchors ?? HU_STORAGE_ANCHORS;
  const from = anchors.others.date < anchors.met.date ? anchors.others.date : anchors.met.date;
  const days = huStorageDays(from, args.to);
  const metOut = (d: string) => (args.nominationsMwh.get(d) ?? 0) / CONVERSION_MCM_TO_MWH;

  // MET end-of-day stock. Closing of the day before the anchor = anchor opening.
  const met = new Map<string, number>();
  const anchorPrev = addDays(anchors.met.date, -1);
  let stock = anchors.met.mcm;
  for (let d = anchors.met.date; d <= args.to; d = addDays(d, 1)) {
    stock -= metOut(d);
    met.set(d, stock);
  }
  stock = anchors.met.mcm;
  for (let d = anchorPrev; d >= from; d = addDays(d, -1)) {
    met.set(d, stock);
    stock += metOut(d);
  }

  let others: number | null = anchors.others.mcm;
  return days.map((date) => {
    const entry = args.huEntryMcm.get(date);
    const out = metOut(date);
    let othersOut: number | null = null;
    let overNomination = false;
    if (date < anchors.others.date) {
      // before the Others opening: nothing to subtract yet
    } else if (others !== null && entry !== null && entry !== undefined && Number.isFinite(entry)) {
      othersOut = Math.max(0, entry - out);
      overNomination = out - entry > 1e-6;
      others -= othersOut;
    } else {
      others = null;
    }
    const m = met.get(date) ?? null;
    const o = date < anchors.others.date ? null : others;
    return {
      date,
      met: m,
      others: o,
      total: m !== null && o !== null ? m + o : null,
      metOut: out,
      othersOut,
      overNomination,
    };
  });
}
