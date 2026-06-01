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
            <TableHead className="text-right">Technical (mcm/d)</TableHead>
            <TableHead className="text-right">Booked (mcm/d)</TableHead>
            <TableHead className="text-right">Used (mcm/d)</TableHead>
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
            // Convert MWh/d → mcm/d so capacity shares a unit with physical flow.
            const available =
              matched.reduce((m, r) => Math.max(m, r.offered_mwh), 0) / CONVERSION_MCM_TO_MWH;
            const bookedRaw =
              matched.reduce((m, r) => Math.max(m, r.booked_mwh), 0) / CONVERSION_MCM_TO_MWH;
            // Booked can never physically exceed technical capacity.
            const booked = Math.min(bookedRaw, available);
            const fk = flowKeyFor(d);
            const usedRaw = fk && latestFlow ? latestFlow[fk] ?? 0 : 0;
            // Clamp used to technical for the % column; show raw value in the
            // "Used" column so the user can still see slight measurement overshoot.
            const used = usedRaw;
            const bookedPct = available > 0 ? (booked / available) * 100 : 0;
            const usedPct = available > 0 ? (Math.min(usedRaw, available) / available) * 100 : 0;
            return (
              <TableRow key={idx}>
                <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                <TableCell className="text-xs">
                  <div className="font-medium">{d.tso}</div>
                  <div className="text-muted-foreground">{d.borderPoint}</div>
                </TableCell>
                <TableCell className="text-xs">{d.direction}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMcm(available)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMcm(booked)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMcm(used)}</TableCell>
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
