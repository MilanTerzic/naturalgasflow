import { CAPACITY_DEFS } from "@/lib/gas/config";
import { fmtMwh, fmtPct, fmtPrice } from "@/lib/gas/format";
import type { CapacityRow } from "@/lib/gas/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PRODUCTS = ["daily", "monthly", "quarterly"] as const;

export function CapacityTable({ capacity }: { capacity: CapacityRow[] }) {
  // Group: key = tso|border_point|direction|product
  const groups = new Map<string, CapacityRow[]>();
  for (const r of capacity) {
    const k = `${r.tso}|${r.border_point}|${r.direction}|${r.product}`;
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  // For each grouping, take last 5 periods (chronological by index).
  return (
    <div className="space-y-6">
      {CAPACITY_DEFS.map((d, idx) => (
        <div key={idx} className="rounded-md border bg-card p-3 shadow-sm">
          <div className="mb-2 flex items-baseline justify-between">
            <div>
              <div className="text-sm font-semibold">
                {idx + 1}. {d.tso} — {d.borderPoint}
              </div>
              <div className="text-xs text-muted-foreground">
                Direction: {d.direction} · Price: {d.priceUnit}
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {PRODUCTS.map((product) => {
              const k = `${d.tso}|${d.borderPoint}|${d.direction}|${product}`;
              const rows = groups.get(k) ?? [];
              const periods = rows.slice(0, 5);
              return (
                <div key={product}>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {product}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-32">Metric</TableHead>
                        {periods.map((p) => (
                          <TableHead key={p.period} className="text-right">
                            {p.period}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">Offered (MWh/d)</TableCell>
                        {periods.map((p) => (
                          <TableCell key={p.period} className="text-right tabular-nums">
                            {fmtMwh(p.offered_mwh)}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Booked (MWh/d)</TableCell>
                        {periods.map((p) => (
                          <TableCell key={p.period} className="text-right tabular-nums">
                            {fmtMwh(p.booked_mwh)}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Utilisation</TableCell>
                        {periods.map((p) => (
                          <TableCell key={p.period} className="text-right tabular-nums">
                            {fmtPct(p.utilisation_pct)}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Price</TableCell>
                        {periods.map((p) => (
                          <TableCell key={p.period} className="text-right tabular-nums">
                            {fmtPrice(p.price, p.currency)}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
