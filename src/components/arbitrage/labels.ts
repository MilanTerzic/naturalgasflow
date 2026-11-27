import type { EnsembleResult, PathPoint } from "@/lib/gas/arb/forecast";
import type { DriverReport } from "@/lib/gas/arb/drivers";
import type { Signal } from "@/lib/gas/arb/ta";

export type Target = "spread" | "BGH" | "CEEGEX";

export const TARGET_LABEL: Record<Target, string> = {
  spread: "Spread CEEGEX − BGH",
  BGH: "BGH day-ahead",
  CEEGEX: "CEEGEX day-ahead",
};

export interface ForecastBundle {
  target: Target;
  result: EnsembleResult;
  report: DriverReport[];
  signals: Signal[];
  score: number;
  /** Observations the models trained on (after the crisis filter). */
  observations: number;
}

export interface OpenProb {
  date: string;
  spread: PathPoint;
  costBgHu: number | null;
  costHuBg: number | null;
  pBgHu: number | null;
  pHuBg: number | null;
}
