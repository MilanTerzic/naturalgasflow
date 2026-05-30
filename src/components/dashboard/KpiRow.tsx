import { KpiCard } from "./KpiCard";
import { fmtMcm, fmtTemp } from "@/lib/gas/format";
import type { BalanceRow } from "@/lib/gas/types";

export function KpiRow({ balance, today }: { balance: BalanceRow[]; today: string }) {
  // Latest historical (today or last historical row).
  const idx = (() => {
    let i = balance.findIndex((r) => r.date === today);
    if (i === -1) i = balance.length - 1;
    return i;
  })();
  const cur = balance[idx];
  const prev = balance[idx - 1];
  if (!cur) return null;

  const importHu = cur.kiskundorozsma_entry_mcm;
  const importBg = cur.imports_from_bulgaria_mcm;
  const storage = cur.storage_imbalance_mcm;
  const storageLabel = storage >= 0 ? "Injection / surplus" : "Withdrawal / deficit";
  const delta = (k: keyof BalanceRow) => {
    if (!prev) return null;
    const a = cur[k];
    const b = prev[k];
    if (typeof a !== "number" || typeof b !== "number") return null;
    return a - b;
  };

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
      <KpiCard
        label="Forecast demand"
        value={`${fmtMcm(cur.demand_mcm)} mcm`}
        hint="Required Serbian demand"
        delta={delta("demand_mcm")}
      />
      <KpiCard
        label="Total supply"
        value={`${fmtMcm(cur.serbian_available_supply_mcm)} mcm`}
        hint="Available to Serbia"
        delta={delta("serbian_available_supply_mcm")}
      />
      <KpiCard
        label="Storage ±"
        value={`${fmtMcm(storage)} mcm`}
        hint={storageLabel}
        tone={storage >= 0 ? "positive" : "negative"}
      />
      <KpiCard
        label="Belgrade temperature"
        value={fmtTemp(cur.temperature_c)}
        hint={`2-day avg ${fmtTemp(cur.avg_temperature_c)}`}
      />
      <KpiCard
        label="Import HU"
        value={`${fmtMcm(importHu)} mcm`}
        hint="Kiskundorozsma entry"
        delta={delta("kiskundorozsma_entry_mcm")}
      />
      <KpiCard
        label="Import BG (net)"
        value={`${fmtMcm(importBg)} mcm`}
        hint="Kireevo − KKD-2"
        delta={delta("imports_from_bulgaria_mcm")}
      />
      <KpiCard
        label="Kalotina"
        value={`${fmtMcm(cur.kalotina_entry_mcm)} mcm`}
        hint="BG → RS direct"
        delta={delta("kalotina_entry_mcm")}
      />
      <KpiCard
        label="Production"
        value={`${fmtMcm(cur.domestic_production_mcm)} mcm`}
        hint="Domestic, constant"
      />
      <KpiCard
        label="Bosnia export"
        value={`${fmtMcm(cur.bosnia_consumption_mcm)} mcm`}
        hint="Share of BG import"
      />
    </div>
  );
}
