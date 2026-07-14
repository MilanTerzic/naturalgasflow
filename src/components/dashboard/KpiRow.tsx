import {
  ArrowDownToLine,
  Factory,
  Flame,
  Gauge,
  Thermometer,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { KpiCard } from "./KpiCard";
import { fmtMcm, fmtTemp } from "@/lib/gas/format";
import type { BalanceRow } from "@/lib/gas/types";

export function KpiRow({ balance, today }: { balance: BalanceRow[]; today: string }) {
  const idx = (() => {
    let i = balance.findIndex((r) => r.date === today);
    if (i === -1) i = balance.length - 1;
    return i;
  })();
  const cur = balance[idx];
  const prev = balance[idx - 1];
  if (!cur) return null;

  const delta = (k: keyof BalanceRow) => {
    if (!prev) return null;
    const a = cur[k];
    const b = prev[k];
    if (typeof a !== "number" || typeof b !== "number") return null;
    return a - b;
  };

  const estimatedHint =
    cur.is_estimated && cur.estimated_from ? `Estimated from ${cur.estimated_from}` : undefined;
  const balanceTone = cur.storage_imbalance_mcm >= 0 ? "positive" : "negative";
  const balanceStatus = cur.storage_imbalance_mcm >= 0 ? "Surplus" : "Deficit";
  const balanceHint =
    cur.storage_imbalance_mcm >= 0 ? "Potential storage injection" : "Required storage withdrawal";

  return (
    <section aria-label="Today at a glance" className="space-y-3">
      {cur.is_estimated && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="font-medium">Estimated flow values.</span> ENTSOG flow data for{" "}
          {cur.date} is not yet published; values are carried forward from {cur.estimated_from}.
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.25fr]">
        <KpiCard
          label="Forecast demand"
          value={fmtMcm(cur.demand_mcm)}
          unit="mcm/day"
          hint="Required Serbian demand"
          delta={delta("demand_mcm")}
          variant="primary"
          icon={<Flame />}
        />
        <KpiCard
          label="Available supply"
          value={fmtMcm(cur.serbian_available_supply_mcm)}
          unit="mcm/day"
          hint={estimatedHint ?? "Total supply available to Serbia"}
          delta={delta("serbian_available_supply_mcm")}
          variant="primary"
          icon={<Gauge />}
          estimated={cur.is_estimated}
        />
        <KpiCard
          label="Gas balance"
          value={fmtMcm(cur.storage_imbalance_mcm)}
          unit="mcm/day"
          hint={
            cur.is_estimated && estimatedHint ? `${balanceHint} · ${estimatedHint}` : balanceHint
          }
          tone={balanceTone}
          variant="balance"
          status={balanceStatus}
          emphasis="strong"
          icon={cur.storage_imbalance_mcm >= 0 ? <TrendingUp /> : <TrendingDown />}
          estimated={cur.is_estimated}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Belgrade temperature"
          value={fmtTemp(cur.temperature_c)}
          hint={`2-day average ${fmtTemp(cur.avg_temperature_c)}`}
          icon={<Thermometer />}
        />
        <KpiCard
          label="Import from Hungary"
          value={fmtMcm(cur.kiskundorozsma_entry_mcm)}
          unit="mcm/day"
          hint={estimatedHint ?? "Kiskundorozsma entry"}
          delta={delta("kiskundorozsma_entry_mcm")}
          icon={<ArrowDownToLine />}
          estimated={cur.is_estimated}
        />
        <KpiCard
          label="Net import from Bulgaria"
          value={fmtMcm(cur.imports_from_bulgaria_mcm)}
          unit="mcm/day"
          hint={estimatedHint ?? "Kireevo less KKD-2 transit"}
          delta={delta("imports_from_bulgaria_mcm")}
          icon={<ArrowDownToLine />}
          estimated={cur.is_estimated}
        />
        <KpiCard
          label="Kalotina entry"
          value={fmtMcm(cur.kalotina_entry_mcm)}
          unit="mcm/day"
          hint={estimatedHint ?? "Bulgaria to Serbia direct"}
          delta={delta("kalotina_entry_mcm")}
          icon={<ArrowDownToLine />}
          estimated={cur.is_estimated}
        />
        <KpiCard
          label="Domestic production"
          value={fmtMcm(cur.domestic_production_mcm)}
          unit="mcm/day"
          hint="Domestic constant"
          icon={<Factory />}
        />
        <KpiCard
          label="Bosnia export"
          value={fmtMcm(cur.bosnia_consumption_mcm)}
          unit="mcm/day"
          hint={estimatedHint ?? "Share of Bulgaria import"}
          icon={<ArrowDownToLine />}
          estimated={cur.is_estimated}
        />
      </div>
    </section>
  );
}
