// Persist Srbijagas overrides in localStorage so the analytical tab keeps state.
import { useEffect, useState, useCallback } from "react";
import { DEFAULT_OVERRIDES } from "./helpers";
import type { SrbijagasOverrides } from "./types";

const KEY = "srbijagas.overrides.v1";

function load(): SrbijagasOverrides {
  if (typeof window === "undefined") return DEFAULT_OVERRIDES;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_OVERRIDES;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_OVERRIDES, ...parsed };
  } catch {
    return DEFAULT_OVERRIDES;
  }
}

export function useSrbijagasOverrides() {
  const [state, setState] = useState<SrbijagasOverrides>(DEFAULT_OVERRIDES);
  useEffect(() => {
    setState(load());
  }, []);

  const persist = useCallback((next: SrbijagasOverrides) => {
    setState(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }, []);

  const update = useCallback(
    (patch: Partial<SrbijagasOverrides>) => {
      const next: SrbijagasOverrides = { ...state, ...patch } as SrbijagasOverrides;
      persist(next);
    },
    [state, persist],
  );

  const reset = useCallback(() => persist(DEFAULT_OVERRIDES), [persist]);

  return { overrides: state, update, reset };
}
