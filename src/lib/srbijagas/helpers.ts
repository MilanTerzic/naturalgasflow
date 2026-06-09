// Aggregation, weather metrics, price reconstruction, CSV utilities.
import type {
  AnalysisRow,
  BosniaAssumption,
  DailyFlowRow,
  MonthlyAggRow,
  PowerAssumption,
  PriceFormula,
  PriceRow,
  SrbijagasOverrides,
} from "./types";
import type { TempRow } from "@/lib/gas/types";

export function hdd(t: number | null, base = 18): number | null {
  if (t == null) return null;
  return Math.max(0, base - t);
}
export function cdd(t: number | null, base = 22): number | null {
  if (t == null) return null;
  return Math.max(0, t - base);
}

export function dateRangeIso(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const d = new Date(`${fromISO}T00:00:00Z`);
  const end = new Date(`${toISO}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// Build the analysis row series from raw daily flows, temperatures, and overrides.
export function buildAnalysis(opts: {
  dates: string[];
  flows: DailyFlowRow[];
  temps: TempRow[];
  bosnia: BosniaAssumption;
  power: PowerAssumption;
  domesticProduction: number; // mcm/d
  manualSerbianDaily: Record<string, number>;
  manualBosniaDaily: Record<string, number>;
  manualPowerDaily: Record<string, number>;
  manualTempDaily: Record<string, number>;
}): AnalysisRow[] {
  const flowByDate = new Map(opts.flows.map((f) => [f.date, f]));
  const tempByDate = new Map(opts.temps.map((t) => [t.date, t.temperature_c]));

  // For "manual" Bosnia, we need to spread monthly value across days in that month.
  const manualBosniaMonthlyDay: Record<string, number> = {};
  if (opts.bosnia.method === "manual") {
    const monthCounts: Record<string, number> = {};
    for (const d of opts.dates) {
      const m = d.slice(0, 7);
      monthCounts[m] = (monthCounts[m] ?? 0) + 1;
    }
    for (const [m, mcm] of Object.entries(opts.bosnia.manualMonthly ?? {})) {
      const days = monthCounts[m] ?? 30;
      manualBosniaMonthlyDay[m] = mcm / days;
    }
  }

  return opts.dates.map((date): AnalysisRow => {
    const ts = Date.parse(`${date}T00:00:00Z`);
    const f = flowByDate.get(date);
    const measured = !!f && (f.kireevo > 0 || f.kalotina > 0 || f.kkdHu > 0);
    const kireevo = f?.kireevo ?? 0;
    const kkd2 = f?.kkd2 ?? 0;
    const kkdHu = f?.kkdHu ?? 0;
    const kalotina = f?.kalotina ?? 0;

    const imports_bg_net = Math.max(0, kireevo - kkd2);
    const imports_total = imports_bg_net + kalotina + kkdHu;

    // Bosnia assumption
    let bosnia = 0;
    switch (opts.bosnia.method) {
      case "share_of_net":
        bosnia = imports_bg_net * opts.bosnia.sharePct;
        break;
      case "share_of_kireevo_spread":
        bosnia = Math.max(0, kireevo - kkd2) * opts.bosnia.sharePct;
        break;
      case "constant":
        bosnia = opts.bosnia.constantMcmDay;
        break;
      case "manual": {
        const m = date.slice(0, 7);
        bosnia = manualBosniaMonthlyDay[m] ?? 0;
        break;
      }
    }
    const bosniaManualDay = opts.manualBosniaDaily[date];
    if (bosniaManualDay != null) bosnia = bosniaManualDay;

    // Temperature override
    const tManual = opts.manualTempDaily[date];
    const temperature_c = tManual != null ? tManual : tempByDate.get(date) ?? null;

    // Power (GWh electricity) -> mcm gas
    const powerGwh = opts.manualPowerDaily[date] ?? null;
    const powerGas =
      powerGwh != null && opts.power.efficiencyPct > 0
        ? // gwh elec / eff -> gwh gas; mcm = gwh / (cv kWh/m3 / 1000) ; with cv=10.55 -> mcm = gwh / 10.55
          (powerGwh / opts.power.efficiencyPct) / (opts.power.gasCvKwhM3)
        : null;

    let serbianConsumption = imports_total + opts.domesticProduction - bosnia;
    const manualS = opts.manualSerbianDaily[date];
    if (manualS != null) serbianConsumption = manualS;

    let source: AnalysisRow["source"] = measured ? "measured" : "missing";
    if (manualS != null) source = "manual_override";
    else if (!measured && f) source = "estimated";

    return {
      date,
      ts,
      imports_total_mcm: imports_total,
      imports_bg_net_mcm: imports_bg_net,
      domestic_production_mcm: opts.domesticProduction,
      bosnia_mcm: Math.max(0, bosnia),
      bosnia_source: opts.bosnia.method,
      serbian_consumption_mcm: Math.max(0, serbianConsumption),
      temperature_c,
      hdd: hdd(temperature_c),
      cdd: cdd(temperature_c),
      power_gwh: powerGwh,
      power_gas_equiv_mcm: powerGas,
      source,
    };
  });
}

export function aggregateMonthly(rows: AnalysisRow[]): MonthlyAggRow[] {
  const map = new Map<string, MonthlyAggRow & { _tSum: number; _tCount: number }>();
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    let agg = map.get(m);
    if (!agg) {
      agg = {
        month: m,
        serbian_mcm: 0,
        bosnia_mcm: 0,
        power_gas_mcm: 0,
        total_potential_mcm: 0,
        avg_temp_c: null,
        hdd: 0,
        days: 0,
        _tSum: 0,
        _tCount: 0,
      };
      map.set(m, agg);
    }
    agg.serbian_mcm += r.serbian_consumption_mcm;
    agg.bosnia_mcm += r.bosnia_mcm;
    if (r.power_gas_equiv_mcm != null) agg.power_gas_mcm += r.power_gas_equiv_mcm;
    if (r.temperature_c != null) {
      agg._tSum += r.temperature_c;
      agg._tCount += 1;
    }
    if (r.hdd != null) agg.hdd += r.hdd;
    agg.days += 1;
  }
  return Array.from(map.values())
    .map((a) => ({
      month: a.month,
      serbian_mcm: +a.serbian_mcm.toFixed(2),
      bosnia_mcm: +a.bosnia_mcm.toFixed(2),
      power_gas_mcm: +a.power_gas_mcm.toFixed(2),
      total_potential_mcm: +(a.serbian_mcm + a.bosnia_mcm).toFixed(2),
      avg_temp_c: a._tCount > 0 ? +(a._tSum / a._tCount).toFixed(2) : null,
      hdd: +a.hdd.toFixed(0),
      days: a.days,
    }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

// Smooth extreme outliers in numeric fields by carrying forward the previous
// day's value. An "extreme" is > 2.5× or < 0.4× the previous non-zero value.
// Used for chart display only — raw analysis rows are preserved for tables.
export function smoothExtremes<T extends object>(
  rows: T[],
  fields: (keyof T)[],
): T[] {
  const prev: Partial<Record<keyof T, number>> = {};
  return rows.map((r) => {
    const next = { ...r } as T;
    for (const f of fields) {
      const v = (r as Record<string, unknown>)[f as string];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const p = prev[f];
      if (p != null && p > 0 && (v > p * 2.5 || v < p * 0.4)) {
        (next as Record<string, unknown>)[f as string] = p;
      } else {
        prev[f] = v;
      }
    }
    return next;
  });
}



export function seasonalProfile(monthly: MonthlyAggRow[]) {
  // Average by calendar month across all years.
  const groups: Record<string, number[]> = {};
  for (const m of monthly) {
    const mm = m.month.slice(5, 7);
    (groups[mm] ??= []).push(m.serbian_mcm);
  }
  const out: { m: string; avg: number; min: number; max: number }[] = [];
  for (let i = 1; i <= 12; i++) {
    const mm = String(i).padStart(2, "0");
    const arr = groups[mm] ?? [];
    if (!arr.length) {
      out.push({ m: mm, avg: 0, min: 0, max: 0 });
    } else {
      const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
      out.push({ m: mm, avg: +avg.toFixed(2), min: Math.min(...arr), max: Math.max(...arr) });
    }
  }
  return out;
}

// Price formula reconstruction.
// Convert Brent USD/bbl -> EUR/MWh proxy: configurable factor (default 0.55).
export function reconstructPrice(opts: {
  months: string[];
  ttfByMonth: Record<string, number>;     // EUR/MWh
  brentByMonth: Record<string, number>;   // USD/bbl
  fxByMonth: Record<string, number>;      // EUR per USD or USD per EUR? — assume EUR/USD i.e. 1 EUR = X USD
  officialByMonth: Record<string, number>;
  formula: PriceFormula;
}): PriceRow[] {
  const out: PriceRow[] = [];
  for (const m of opts.months) {
    const ttf = opts.ttfByMonth[m] ?? null;
    const brent = opts.brentByMonth[m] ?? null;
    const fx = opts.fxByMonth[m] ?? null;

    // Apply oil lag: pull Brent value from month - lag.
    let oilIdxed: number | null = null;
    if (opts.formula.oilLagMonths >= 0) {
      const laggedKey = shiftMonth(m, -opts.formula.oilLagMonths);
      const brentLag = opts.brentByMonth[laggedKey];
      const fxLag = opts.fxByMonth[laggedKey] ?? fx;
      if (brentLag != null && fxLag != null && fxLag > 0) {
        // Convert USD/bbl to EUR/bbl then proxy to EUR/MWh.
        const eurPerBbl = brentLag / fxLag;
        oilIdxed = eurPerBbl * opts.formula.brentToEurMwhFactor;
      }
    }

    let reconstructed: number | null = null;
    if (ttf != null || oilIdxed != null) {
      const oilPart = oilIdxed != null ? oilIdxed * opts.formula.oilWeight : 0;
      const ttfPart = ttf != null ? ttf * opts.formula.ttfWeight : 0;
      reconstructed = +(oilPart + ttfPart + opts.formula.addEurMwh).toFixed(2);
    }

    out.push({
      month: m,
      official_eur_mwh: opts.officialByMonth[m] ?? null,
      ttf_eur_mwh: ttf,
      brent_usd_bbl: brent,
      eur_usd: fx,
      reconstructed_eur_mwh: reconstructed,
      oil_indexed_eur_mwh: oilIdxed != null ? +oilIdxed.toFixed(2) : null,
    });
  }
  return out;
}

export function shiftMonth(m: string, delta: number): string {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthsBetween(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const d = new Date(`${fromISO.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${toISO.slice(0, 7)}-01T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

// ---------- CSV utilities ----------

export function parseCsv(text: string): string[][] {
  // Minimal CSV parser supporting quoted fields and commas.
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else if (c === "\r") {
        // skip
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

// Parse a 2-column CSV (date,value) into a record.
export function parseKvCsv(text: string): Record<string, number> {
  const rows = parseCsv(text);
  const out: Record<string, number> = {};
  // Skip header if first row second column is non-numeric.
  const startIdx = rows[0] && Number.isNaN(Number(rows[0][1])) ? 1 : 0;
  for (let i = startIdx; i < rows.length; i++) {
    const [k, v] = rows[i];
    if (!k || v == null) continue;
    const num = Number(String(v).replace(",", "."));
    if (!Number.isFinite(num)) continue;
    out[k.trim()] = num;
  }
  return out;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Defaults for overrides ----------

export const DEFAULT_OVERRIDES: SrbijagasOverrides = {
  bosnia: {
    method: "share_of_net",
    sharePct: 0.07,
    constantMcmDay: 1.0,
    manualMonthly: {},
  },
  power: { efficiencyPct: 0.5, gasCvKwhM3: 10.55 },
  formula: {
    oilWeight: 0.5,
    ttfWeight: 0.5,
    oilLagMonths: 6,
    addEurMwh: 0,
    brentToEurMwhFactor: 0.55,
  },
  manualSerbianDaily: {},
  manualBosniaDaily: {},
  manualPowerDaily: {},
  manualPriceMonthly: {},
  manualTempDaily: {},
};

// ---------- Synthetic TTF/Brent series (clearly labelled) ----------
// Realistic monthly approximations for EU benchmarks 2020–2026.
// User can override these via CSV upload.
export function syntheticTtf(month: string): number {
  // EUR/MWh — calibrated approximation of monthly TTF Day-Ahead averages.
  const data: Record<string, number> = {
    "2020-01": 12, "2020-02": 9, "2020-03": 8, "2020-04": 6, "2020-05": 5, "2020-06": 5,
    "2020-07": 7, "2020-08": 9, "2020-09": 11, "2020-10": 13, "2020-11": 14, "2020-12": 17,
    "2021-01": 18, "2021-02": 17, "2021-03": 17, "2021-04": 20, "2021-05": 25, "2021-06": 31,
    "2021-07": 37, "2021-08": 45, "2021-09": 67, "2021-10": 90, "2021-11": 84, "2021-12": 116,
    "2022-01": 84, "2022-02": 81, "2022-03": 127, "2022-04": 99, "2022-05": 95, "2022-06": 109,
    "2022-07": 175, "2022-08": 235, "2022-09": 197, "2022-10": 100, "2022-11": 115, "2022-12": 110,
    "2023-01": 65, "2023-02": 55, "2023-03": 45, "2023-04": 41, "2023-05": 30, "2023-06": 27,
    "2023-07": 28, "2023-08": 33, "2023-09": 35, "2023-10": 44, "2023-11": 44, "2023-12": 37,
    "2024-01": 31, "2024-02": 25, "2024-03": 26, "2024-04": 29, "2024-05": 32, "2024-06": 33,
    "2024-07": 33, "2024-08": 39, "2024-09": 36, "2024-10": 39, "2024-11": 44, "2024-12": 46,
    "2025-01": 49, "2025-02": 50, "2025-03": 42, "2025-04": 38, "2025-05": 36, "2025-06": 34,
    "2025-07": 34, "2025-08": 33, "2025-09": 32, "2025-10": 33, "2025-11": 35, "2025-12": 36,
    "2026-01": 36, "2026-02": 35, "2026-03": 33, "2026-04": 31, "2026-05": 29, "2026-06": 28,
  };
  return data[month] ?? 35;
}
export function syntheticBrent(month: string): number {
  const data: Record<string, number> = {
    "2020-01": 64, "2020-02": 55, "2020-03": 32, "2020-04": 19, "2020-05": 30, "2020-06": 40,
    "2020-07": 43, "2020-08": 45, "2020-09": 41, "2020-10": 41, "2020-11": 43, "2020-12": 50,
    "2021-01": 55, "2021-02": 62, "2021-03": 65, "2021-04": 65, "2021-05": 68, "2021-06": 73,
    "2021-07": 75, "2021-08": 71, "2021-09": 74, "2021-10": 84, "2021-11": 81, "2021-12": 75,
    "2022-01": 86, "2022-02": 97, "2022-03": 117, "2022-04": 105, "2022-05": 113, "2022-06": 123,
    "2022-07": 105, "2022-08": 100, "2022-09": 91, "2022-10": 93, "2022-11": 91, "2022-12": 81,
    "2023-01": 83, "2023-02": 83, "2023-03": 78, "2023-04": 84, "2023-05": 75, "2023-06": 75,
    "2023-07": 80, "2023-08": 86, "2023-09": 94, "2023-10": 91, "2023-11": 83, "2023-12": 78,
    "2024-01": 80, "2024-02": 83, "2024-03": 84, "2024-04": 89, "2024-05": 83, "2024-06": 82,
    "2024-07": 85, "2024-08": 79, "2024-09": 74, "2024-10": 76, "2024-11": 74, "2024-12": 74,
    "2025-01": 78, "2025-02": 75, "2025-03": 72, "2025-04": 68, "2025-05": 65, "2025-06": 67,
    "2025-07": 70, "2025-08": 72, "2025-09": 73, "2025-10": 72, "2025-11": 71, "2025-12": 70,
    "2026-01": 70, "2026-02": 70, "2026-03": 69, "2026-04": 68, "2026-05": 67, "2026-06": 66,
  };
  return data[month] ?? 75;
}
