import {
  BIH_SHARE,
  CONVERSION_MCM_TO_GWH,
  DOMESTIC_PRODUCTION_MCM,
  LINEAR_COEFFS,
  POLY_COEFFS,
} from "@/lib/gas/config";
import { fmtMcm, fmtShortDate, fmtTemp } from "@/lib/gas/format";
import type { BalanceRow } from "@/lib/gas/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function ModelPanel({
  balance,
  usePolynomial,
  curveShift,
  curveDistortion,
  domesticProduction,
  bihShare,
}: {
  balance: BalanceRow[];
  usePolynomial: boolean;
  curveShift: number;
  curveDistortion: number;
  domesticProduction: number;
  bihShare: number;
}) {
  const refreshDate = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        All supply and demand values are shown in <strong>mcm/day</strong>. Estimated values are
        used only where actual ENTSOG data is not available, and are clearly marked.
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Polynomial model */}
        <div className="rounded-md border bg-card p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Polynomial regression (active{usePolynomial ? "" : " — fallback to linear"})</h3>
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${usePolynomial ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>
              {usePolynomial ? "DEFAULT" : "inactive"}
            </span>
          </div>
          <p className="font-mono text-xs">
            y = {POLY_COEFFS[0]}·x³ {POLY_COEFFS[1]}·x² {POLY_COEFFS[2]}·x + {POLY_COEFFS[3]}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            y = Serbian daily demand (mcm/day) · x = Belgrade 2-day average temperature (°C).
          </p>
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead className="h-7">Term</TableHead>
                <TableHead className="h-7 text-right">Coefficient</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>x³</TableCell><TableCell className="text-right tabular-nums">{POLY_COEFFS[0]}</TableCell></TableRow>
              <TableRow><TableCell>x²</TableCell><TableCell className="text-right tabular-nums">{POLY_COEFFS[1]}</TableCell></TableRow>
              <TableRow><TableCell>x</TableCell><TableCell className="text-right tabular-nums">{POLY_COEFFS[2]}</TableCell></TableRow>
              <TableRow><TableCell>constant</TableCell><TableCell className="text-right tabular-nums">{POLY_COEFFS[3]}</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Linear fallback */}
        <div className="rounded-md border bg-card p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Linear regression (fallback)</h3>
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${!usePolynomial ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>
              {!usePolynomial ? "ACTIVE" : "fallback"}
            </span>
          </div>
          <p className="font-mono text-xs">
            y = {LINEAR_COEFFS[0]}·x + {LINEAR_COEFFS[1]}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Used only if the polynomial model fails, produces invalid output, or input
            temperature data is missing/insufficient.
          </p>
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead className="h-7">Term</TableHead>
                <TableHead className="h-7 text-right">Coefficient</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>x</TableCell><TableCell className="text-right tabular-nums">{LINEAR_COEFFS[0]}</TableCell></TableRow>
              <TableRow><TableCell>constant</TableCell><TableCell className="text-right tabular-nums">{LINEAR_COEFFS[1]}</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Assumptions */}
        <div className="rounded-md border bg-card p-3 shadow-sm lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold">Assumptions (live from sidebar)</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parameter</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Domestic Serbian production</TableCell>
                <TableCell className="text-right tabular-nums">{domesticProduction.toFixed(2)} mcm/day</TableCell>
                <TableCell className="text-xs text-muted-foreground">Default {DOMESTIC_PRODUCTION_MCM.toFixed(2)} — user adjustable.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Bosnia consumption / export share</TableCell>
                <TableCell className="text-right tabular-nums">{(bihShare * 100).toFixed(1)} %</TableCell>
                <TableCell className="text-xs text-muted-foreground">Default {(BIH_SHARE * 100).toFixed(1)}% — applied to Import BG net only.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Import from BG (net)</TableCell>
                <TableCell className="text-right tabular-nums font-mono">max(Kireevo − KKD-2, 0)</TableCell>
                <TableCell className="text-xs text-muted-foreground">Isolates physical Serbia entry, not regional transit.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Bosnia export</TableCell>
                <TableCell className="text-right tabular-nums font-mono">{(bihShare * 100).toFixed(1)}% × max(Kireevo − KKD-2, 0)</TableCell>
                <TableCell className="text-xs text-muted-foreground">Replaced by actual data when available.</TableCell>
              </TableRow>
              <TableRow className="border-t-2">
                <TableCell className="font-medium">Serbian available supply</TableCell>
                <TableCell className="text-right tabular-nums font-mono whitespace-nowrap">
                  KKD HU + Import BG net + Kalotina + Production − Bosnia
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">Single formula used everywhere (KPIs, charts, table).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Storage balance / imbalance</TableCell>
                <TableCell className="text-right tabular-nums font-mono">Available supply − Required demand</TableCell>
                <TableCell className="text-xs text-muted-foreground">Positive = injection, negative = withdrawal.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Energy conversion</TableCell>
                <TableCell className="text-right tabular-nums">1 mcm = {CONVERSION_MCM_TO_GWH} GWh</TableCell>
                <TableCell className="text-xs text-muted-foreground">GCV ≈ 10.55 kWh/m³.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Curve shift</TableCell>
                <TableCell className="text-right tabular-nums">{curveShift.toFixed(2)} mcm/day</TableCell>
                <TableCell className="text-xs text-muted-foreground">Applied after base regression result.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Curve distortion</TableCell>
                <TableCell className="text-right tabular-nums">{curveDistortion.toFixed(2)} ×</TableCell>
                <TableCell className="text-xs text-muted-foreground">Multiplier on regression output.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Refresh date</TableCell>
                <TableCell className="text-right tabular-nums">{refreshDate}</TableCell>
                <TableCell className="text-xs text-muted-foreground">ENTSOG + Open-Meteo last sync window.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Debug / transparency table */}
      <div className="rounded-md border bg-card shadow-sm">
        <div className="border-b p-3">
          <h3 className="text-sm font-semibold">Per-day source &amp; balance trace</h3>
          <p className="text-xs text-muted-foreground">
            For each day: what data was used (actual / historical fallback / future fallback),
            the source date if estimated, and the computed supply &amp; storage.
          </p>
        </div>
        <ScrollArea className="h-96">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>From</TableHead>
                <TableHead className="text-right">Temp °C</TableHead>
                <TableHead className="text-right">Demand</TableHead>
                <TableHead className="text-right">Supply</TableHead>
                <TableHead className="text-right">Storage ±</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balance.map((r) => (
                <TableRow key={r.date} className={r.is_estimated ? "bg-emerald-50/60" : undefined}>
                  <TableCell>{fmtShortDate(r.date)}</TableCell>
                  <TableCell className="text-xs">
                    {r.is_forecast ? "forecast" : r.source_type.replace("_", " ")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.estimated_from ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtTemp(r.temperature_c)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMcm(r.demand_mcm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMcm(r.serbian_available_supply_mcm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMcm(r.storage_imbalance_mcm)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </div>
  );
}
