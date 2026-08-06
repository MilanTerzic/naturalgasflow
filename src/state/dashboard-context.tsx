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
import { supabase } from "@/integrations/supabase/client";

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

const SETTINGS_ID = "global";

interface PersistedScenario {
  usePolynomial: boolean;
  curveShift: number;
  curveDistortion: number;
  domesticProduction: number;
  bihShare: number;
  rangePastDays: number;
  rangeFutureDays: number;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DataMode>("live");
  const [rangePastDays, setRangePastDays] = useState(10);
  const [rangeFutureDays, setRangeFutureDays] = useState(10);
  const [usePolynomial, setUsePolynomial] = useState(true);
  const [curveShift, setCurveShift] = useState(1);
  const [curveDistortion, setCurveDistortion] = useState(1);
  const [domesticProduction, setDomesticProduction] = useState(0.5);
  const [bihShare, setBihShare] = useState(0.07);
  const [saveState, setSaveState] = useState<SaveState>("loading");

  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load shared scenario settings once so every visitor sees the saved parameters.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("dashboard_settings")
        .select(
          "use_polynomial, curve_shift, curve_distortion, domestic_production, bih_share, range_past_days, range_future_days",
        )
        .eq("id", SETTINGS_ID)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setSaveState("error");
        loadedRef.current = true;
        return;
      }
      if (data) {
        setUsePolynomial(Boolean(data.use_polynomial));
        setCurveShift(Number(data.curve_shift));
        setCurveDistortion(Number(data.curve_distortion));
        setDomesticProduction(Number(data.domestic_production));
        setBihShare(Number(data.bih_share));
        setRangePastDays(Number(data.range_past_days));
        setRangeFutureDays(Number(data.range_future_days));
      }
      loadedRef.current = true;
      setSaveState("idle");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: PersistedScenario) => {
    if (!loadedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveState("saving");
    timerRef.current = setTimeout(async () => {
      const { error } = await supabase.from("dashboard_settings").upsert(
        {
          id: SETTINGS_ID,
          use_polynomial: next.usePolynomial,
          curve_shift: next.curveShift,
          curve_distortion: next.curveDistortion,
          domestic_production: next.domesticProduction,
          bih_share: next.bihShare,
          range_past_days: next.rangePastDays,
          range_future_days: next.rangeFutureDays,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      setSaveState(error ? "error" : "saved");
    }, 600);
  }, []);

  // Save whenever a scenario parameter changes (debounced).
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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

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
