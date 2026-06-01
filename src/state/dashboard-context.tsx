import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type DataMode = "dummy" | "live";

export interface DashboardSettings {
  mode: DataMode;
  setMode: (m: DataMode) => void;
  rangePastDays: number;
  rangeFutureDays: number;
  setRange: (past: number, future: number) => void;
  usePolynomial: boolean;
  setUsePolynomial: (v: boolean) => void;
  curveShift: number;
  setCurveShift: (v: number) => void;
  curveDistortion: number;
  setCurveDistortion: (v: number) => void;
  domesticProduction: number;
  setDomesticProduction: (v: number) => void;
  bihShare: number;
  setBihShare: (v: number) => void;
}

const Ctx = createContext<DashboardSettings | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DataMode>("live");
  const [rangePastDays, setRangePastDays] = useState(10);
  const [rangeFutureDays, setRangeFutureDays] = useState(10);
  const [usePolynomial, setUsePolynomial] = useState(true);
  const [curveShift, setCurveShift] = useState(0);
  const [curveDistortion, setCurveDistortion] = useState(1);
  const [domesticProduction, setDomesticProduction] = useState(0.5);
  const [bihShare, setBihShare] = useState(0.07);

  const value = useMemo<DashboardSettings>(
    () => ({
      mode,
      setMode,
      rangePastDays,
      rangeFutureDays,
      setRange: (past, future) => {
        setRangePastDays(past);
        setRangeFutureDays(future);
      },
      usePolynomial,
      setUsePolynomial,
      curveShift,
      setCurveShift,
      curveDistortion,
      setCurveDistortion,
      domesticProduction,
      setDomesticProduction,
      bihShare,
      setBihShare,
    }),
    [
      mode,
      rangePastDays,
      rangeFutureDays,
      usePolynomial,
      curveShift,
      curveDistortion,
      domesticProduction,
      bihShare,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboard() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDashboard must be used within DashboardProvider");
  return v;
}
