import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type DataMode = "dummy" | "live";
export type SaveState = "idle" | "loading" | "saving" | "saved" | "error";

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
  saveState: SaveState;
}

const Ctx = createContext<DashboardSettings | null>(null);
const STORAGE_KEY = "gas-dashboard.scenario.v2";

interface PersistedScenario {
  usePolynomial: boolean;
  curveShift: number;
  curveDistortion: number;
  domesticProduction: number;
  bihShare: number;
  rangePastDays: number;
  rangeFutureDays: number;
}

const DEFAULTS: PersistedScenario = {
  usePolynomial: true,
  curveShift: 1,
  curveDistortion: 1,
  domesticProduction: 0.5,
  bihShare: 0.07,
  rangePastDays: 10,
  rangeFutureDays: 10,
};

function readScenario(): PersistedScenario {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PersistedScenario>;
    return {
      usePolynomial: parsed.usePolynomial ?? DEFAULTS.usePolynomial,
      curveShift: Number(parsed.curveShift ?? DEFAULTS.curveShift),
      curveDistortion: Number(parsed.curveDistortion ?? DEFAULTS.curveDistortion),
      domesticProduction: Number(parsed.domesticProduction ?? DEFAULTS.domesticProduction),
      bihShare: Number(parsed.bihShare ?? DEFAULTS.bihShare),
      rangePastDays: Number(parsed.rangePastDays ?? DEFAULTS.rangePastDays),
      rangeFutureDays: Number(parsed.rangeFutureDays ?? DEFAULTS.rangeFutureDays),
    };
  } catch {
    return DEFAULTS;
  }
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DataMode>("live");
  const [rangePastDays, setRangePastDays] = useState(DEFAULTS.rangePastDays);
  const [rangeFutureDays, setRangeFutureDays] = useState(DEFAULTS.rangeFutureDays);
  const [usePolynomial, setUsePolynomial] = useState(DEFAULTS.usePolynomial);
  const [curveShift, setCurveShift] = useState(DEFAULTS.curveShift);
  const [curveDistortion, setCurveDistortion] = useState(DEFAULTS.curveDistortion);
  const [domesticProduction, setDomesticProduction] = useState(DEFAULTS.domesticProduction);
  const [bihShare, setBihShare] = useState(DEFAULTS.bihShare);
  const [saveState, setSaveState] = useState<SaveState>("loading");

  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const saved = readScenario();
    setUsePolynomial(saved.usePolynomial);
    setCurveShift(saved.curveShift);
    setCurveDistortion(saved.curveDistortion);
    setDomesticProduction(saved.domesticProduction);
    setBihShare(saved.bihShare);
    setRangePastDays(saved.rangePastDays);
    setRangeFutureDays(saved.rangeFutureDays);
    loadedRef.current = true;
    setSaveState("idle");
  }, []);

  const persist = useCallback((next: PersistedScenario) => {
    if (!loadedRef.current || typeof window === "undefined") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveState("saving");
    timerRef.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 350);
  }, []);

  useEffect(() => {
    persist({
      usePolynomial,
      curveShift,
      curveDistortion,
      domesticProduction,
      bihShare,
      rangePastDays,
      rangeFutureDays,
    });
  }, [
    persist,
    usePolynomial,
    curveShift,
    curveDistortion,
    domesticProduction,
    bihShare,
    rangePastDays,
    rangeFutureDays,
  ]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

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
      saveState,
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
      saveState,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboard() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDashboard must be used within DashboardProvider");
  return v;
}
