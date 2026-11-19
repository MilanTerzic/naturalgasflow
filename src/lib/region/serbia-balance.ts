// Serbia's cross-border balance for the Balkan map: one definition shared by the
// "Serbia balance" inspector card, the country net position row and the map's net tag,
// so the three can never disagree.
//
//   Net in Serbia = Kalotina + Kireevo + Kiskundorozsma (entry)
//                 − Kiskundorozsma 2 / Horgoš (transit to Hungary)
//                 − Bosnia flow (modelled share at Zvornik, not metered)
//
// Domestic production and storage are deliberately NOT part of this net.
// Pure module; no framework imports.

import {
  grossPipelineEntryMcm,
  hasOperationalObservation,
  netRemainingInSerbiaMcm,
} from "../gas/flow-metrics";
import type { BalanceRow, FlowRow } from "../gas/types";

export interface SerbiaBalance {
  /** Kalotina + Kireevo + Kiskundorozsma. */
  gross: number | null;
  /** Kiskundorozsma 2 / Horgoš exit to Hungary. */
  exit: number | null;
  /** Modelled Bosnia flow. */
  bosnia: number | null;
  /** gross − exit − bosnia; null unless all four points and the Bosnia model are present. */
  net: number | null;
  /** Signed flow per neighbour (+ into Serbia), only when net is known. */
  byNeighbour: Record<string, number> | null;
  /** Number of gas days behind the figures (1 in day mode). */
  days: number;
}

const EMPTY: SerbiaBalance = {
  gross: null,
  exit: null,
  bosnia: null,
  net: null,
  byNeighbour: null,
  days: 0,
};

export function serbiaBalanceForRow(
  row: FlowRow | undefined,
  bosnia: number | null,
): SerbiaBalance {
  if (!row) return EMPTY;
  const gross = grossPipelineEntryMcm(row);
  const exit = hasOperationalObservation(row, "kiskundorozsma_2") ? row.kiskundorozsma_2 : null;
  const net = netRemainingInSerbiaMcm(row, bosnia);
  return {
    gross,
    exit,
    bosnia,
    net,
    byNeighbour:
      net === null
        ? null
        : {
            HU: row.kiskundorozsma_hu - row.kiskundorozsma_2,
            BG: row.kireevo + row.kalotina,
            BA: -(bosnia as number),
          },
    days: 1,
  };
}

/**
 * Day mode: the selected gas day. Average mode: the mean over days where every
 * component is known, so gross − exit − bosnia = net also holds for the averages.
 */
export function serbiaBalance(args: {
  mode: "day" | "average";
  date: string | null;
  rows: FlowRow[];
  balance: BalanceRow[];
}): SerbiaBalance {
  const { mode, date, rows, balance } = args;
  const bosniaByDate = new Map(balance.map((b) => [b.date, b.bosnia_consumption_mcm]));
  const forRow = (r: FlowRow) => serbiaBalanceForRow(r, bosniaByDate.get(r.date) ?? null);
  if (mode === "day") {
    const row = rows.find((r) => r.date === date);
    return row ? forRow(row) : EMPTY;
  }

  const complete = rows.map(forRow).filter((x) => x.net !== null);
  if (!complete.length) return EMPTY;
  const n = complete.length;
  const mean = (f: (x: SerbiaBalance) => number) => complete.reduce((s, x) => s + f(x), 0) / n;
  return {
    gross: mean((x) => x.gross!),
    exit: mean((x) => x.exit!),
    bosnia: mean((x) => x.bosnia!),
    net: mean((x) => x.net!),
    byNeighbour: {
      HU: mean((x) => x.byNeighbour!.HU),
      BG: mean((x) => x.byNeighbour!.BG),
      BA: mean((x) => x.byNeighbour!.BA),
    },
    days: n,
  };
}

/** Kireevo − Kiskundorozsma 2 (Gastrans after Hungary) over the rows: latest, mean, max, min. */
export function gastransResidualStats(rows: FlowRow[]): {
  latest: number | null;
  latestDate: string | null;
  avg: number | null;
  max: number | null;
  min: number | null;
} {
  const diffs = rows
    .filter(
      (r) =>
        hasOperationalObservation(r, "kireevo") && hasOperationalObservation(r, "kiskundorozsma_2"),
    )
    .map((r) => ({ date: r.date, v: r.kireevo - r.kiskundorozsma_2 }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!diffs.length) return { latest: null, latestDate: null, avg: null, max: null, min: null };
  const values = diffs.map((d) => d.v);
  const last = diffs[diffs.length - 1];
  return {
    latest: last.v,
    latestDate: last.date,
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    max: Math.max(...values),
    min: Math.min(...values),
  };
}
