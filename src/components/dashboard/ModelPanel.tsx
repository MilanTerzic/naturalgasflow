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
  const refreshDate = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border bg-card p-3 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Demand regression</h3>
          <div className="space-y-1 text-sm">
            <p>
              Active model: <span className="font-medium">{usePolynomial ? "Polynomial (cubic)" : "Linear"}</span>
            </p>
            <p className="font-mono text-xs">
              Poly: y = {POLY_COEFFS[0]}·x³ {POLY_COEFFS[1]}·x² {POLY_COEFFS[2]}·x + {POLY_COEFFS[3]}
            </p>
            <p className="font-mono text-xs">
              Linear: y = {LINEAR_COEFFS[0]}·x + {LINEAR_COEFFS[1]}
            </p>
            <p className="text-xs text-muted-foreground">
              y = Serbian daily demand (mcm/day) · x = Belgrade 2-day rolling average temperature (°C).
              Coefficients calibrated against historical demand vs. Belgrade temperature.
            </p>
            <p className="text-xs text-muted-foreground">
              ARIMA / time-series smoothing: not active in this build — temperature-driven regression
              alone matches observed daily variance within the rolling ±10-day window. Can be layered
              on top by post-processing the demand series (e.g. ARIMA(1,0,1) on residuals).
            </p>
          </div>
        </div>
        <div className="rounded-md border bg-card p-3 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Operational assumptions</h3>
          <ul className="space-y-1 text-sm">
            <li>Refresh date: <span className="font-medium tabular-nums">{refreshDate}</span></li>
            <li>Domestic production: <span className="font-medium tabular-nums">{domesticProduction} mcm/d</span> (constant)</li>
            <li>Bosnia export: <span className="font-medium tabular-nums">{(bihShare * 100).toFixed(1)}%</span> of BG→RS via Kireevo/Gastrans</li>
            <li>Storage injection cap: <span className="font-medium tabular-nums">2.50 mcm/d</span></li>
            <li>Storage withdrawal cap: <span className="font-medium tabular-nums">5.00 mcm/d</span></li>
            <li>Curve shift: <span className="font-medium tabular-nums">{curveShift.toFixed(2)} mcm/d</span></li>
            <li>Curve distortion: <span className="font-medium tabular-nums">{curveDistortion.toFixed(2)}×</span></li>
            <li>Demand floor: <span className="font-medium tabular-nums">4.00 mcm/d</span></li>
          </ul>
        </div>
        <div className="rounded-md border bg-card p-3 shadow-sm lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold">Data sources & conversions</h3>
          <ul className="space-y-1 text-sm">
            <li><span className="font-medium">ENTSOG Transparency Platform</span> — Physical Flow, daily, no token required. Points: Kiskundorozsma HU→RS (FGSZ exit), Kireevo BG→RS (Bulgartransgaz exit), Kiskundorozsma-2 (FGSZ entry), Kalotina BG→RS exit.</li>
            <li><span className="font-medium">Open-Meteo</span> — Belgrade daily mean temperature. Archive API for history, forecast API for today + future (≤16 days).</li>
            <li>Refresh window: rolling ±10 days from today.</li>
            <li>Conversion: 1 mcm/day ≈ 10,550 MWh/day ≈ 10,550,000 kWh/day (GCV 10.55 kWh/m³).</li>
            <li>Supply formula: <span className="font-mono text-xs">Total = (Kireevo − KKD-2) + Kalotina + KKD HU + 0.5 − Bosnia</span></li>
            <li>Bosnia export = 7% × (Kireevo − KKD-2).</li>
            <li>Storage ± = supply − demand, clipped to [−5.0, +2.5] mcm/d.</li>
            <li>If today's ENTSOG values are not yet published, the previous day's values are carried forward and a warning banner is shown.</li>
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
