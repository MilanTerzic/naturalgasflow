import { LINEAR_COEFFS, POLY_COEFFS } from "@/lib/gas/config";
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
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border bg-card p-3 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Demand regression</h3>
          <div className="space-y-1 text-sm">
            <p>
              Active model: <span className="font-medium">{usePolynomial ? "Polynomial" : "Linear"}</span>
            </p>
            <p className="font-mono text-xs">
              y = {POLY_COEFFS[0]}·x³ {POLY_COEFFS[1]}·x² {POLY_COEFFS[2]}·x + {POLY_COEFFS[3]}
            </p>
            <p className="font-mono text-xs">
              y = {LINEAR_COEFFS[0]}·x + {LINEAR_COEFFS[1]}
            </p>
            <p className="text-xs text-muted-foreground">
              y = Serbian daily demand (mcm/day) · x = Belgrade 2-day rolling avg temperature (°C)
            </p>
          </div>
        </div>
        <div className="rounded-md border bg-card p-3 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Operational assumptions</h3>
          <ul className="space-y-1 text-sm">
            <li>Domestic production: <span className="font-medium tabular-nums">{domesticProduction} mcm/d</span></li>
            <li>Bosnia share of BG import: <span className="font-medium tabular-nums">{(bihShare * 100).toFixed(1)}%</span></li>
            <li>Curve shift: <span className="font-medium tabular-nums">{curveShift.toFixed(2)} mcm/d</span></li>
            <li>Curve distortion: <span className="font-medium tabular-nums">{curveDistortion.toFixed(2)}×</span></li>
            <li>Demand floor: <span className="font-medium tabular-nums">4.00 mcm/d</span></li>
          </ul>
        </div>
      </div>

      <div className="rounded-md border bg-card shadow-sm">
        <div className="border-b p-3">
          <h3 className="text-sm font-semibold">Daily temperature & demand</h3>
          <p className="text-xs text-muted-foreground">Full series for the selected date range.</p>
        </div>
        <ScrollArea className="h-96">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Temp (°C)</TableHead>
                <TableHead className="text-right">2-day avg</TableHead>
                <TableHead className="text-right">Demand (mcm/d)</TableHead>
                <TableHead className="text-right">Supply (mcm/d)</TableHead>
                <TableHead className="text-right">Storage ± (mcm/d)</TableHead>
                <TableHead>Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balance.map((r) => (
                <TableRow key={r.date}>
                  <TableCell>{fmtShortDate(r.date)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtTemp(r.temperature_c)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtTemp(r.avg_temperature_c)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMcm(r.demand_mcm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMcm(r.serbian_available_supply_mcm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMcm(r.storage_imbalance_mcm)}</TableCell>
                  <TableCell className="text-xs">{r.is_forecast ? "forecast" : "actual"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </div>
  );
}
