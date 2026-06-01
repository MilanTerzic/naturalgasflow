import { CAPACITY_DEFS, CONVERSION_MCM_TO_MWH } from "@/lib/gas/config";
import { fmtMcm, fmtPct } from "@/lib/gas/format";
import type { CapacityRow, FlowRow } from "@/lib/gas/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function flowKeyFor(d: (typeof CAPACITY_DEFS)[number]) {
  const bp = d.borderPoint.toLowerCase();
  if (bp.includes("kiskundorozsma 2")) return "kiskundorozsma_2" as const;
  if (bp.includes("kiskundorozsma")) return "kiskundorozsma_hu" as const;
  if (bp.includes("kireevo") || bp.includes("zaychar")) return "kireevo" as const;
  if (bp.includes("kalotina")) return "kalotina" as const;
  return null;
}

export function CapacityTable({
  capacity,
  flows,
}: {
  capacity: CapacityRow[];
  flows?: FlowRow[];
}) {
  const latestFlow = (flows ?? [])
    .slice()
    .reverse()
    .find((f) => f.kireevo > 0 || f.kalotina > 0 || f.kiskundorozsma_hu > 0);

  return (
    <div className="rounded-md border bg-card p-3 shadow-sm">
      <div className="mb-2">
        <h3 className="text-sm font-semibold">Capacity overview</h3>
        <p className="text-xs text-muted-foreground">
          One row per physical route. Booked is the max commitment across daily / monthly /
          quarterly products. Used is the latest physical ENTSOG flow.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Route</TableHead>
            <TableHead>Dir.</TableHead>
            <TableHead className="text-right">Technical (MWh/d)</TableHead>
            <TableHead className="text-right">Booked (MWh/d)</TableHead>
            <TableHead className="text-right">Used (MWh/d)</TableHead>
            <TableHead className="text-right">Booked %</TableHead>
            <TableHead className="text-right">Used %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {CAPACITY_DEFS.map((d, idx) => {
            const matched = capacity.filter(
              (r) =>
                r.tso === d.tso && r.border_point === d.borderPoint && r.direction === d.direction,
            );
            const available = matched.reduce((m, r) => Math.max(m, r.offered_mwh), 0);
            const booked = matched.reduce((m, r) => Math.max(m, r.booked_mwh), 0);
            const fk = flowKeyFor(d);
            const used = fk && latestFlow ? (latestFlow[fk] ?? 0) * CONVERSION_MCM_TO_MWH : 0;
            const bookedPct = available > 0 ? (booked / available) * 100 : 0;
            const usedPct = available > 0 ? (used / available) * 100 : 0;
            return (
              <TableRow key={idx}>
                <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                <TableCell className="text-xs">
                  <div className="font-medium">{d.tso}</div>
                  <div className="text-muted-foreground">{d.borderPoint}</div>
                </TableCell>
                <TableCell className="text-xs">{d.direction}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMwh(available)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMwh(booked)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMwh(used)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct(bookedPct)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct(usedPct)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
