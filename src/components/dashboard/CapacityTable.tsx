import { buildCapacityRouteSummaries } from "@/lib/gas/capacity-utils";
import { fmtMcm, fmtPct, fmtShortDateYear } from "@/lib/gas/format";
import type { CapacityRow, FlowRow } from "@/lib/gas/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function fmtMaybeMcm(value: number | null | undefined) {
  return value == null ? "N/A" : fmtMcm(value);
}

function fmtMaybePct(value: number | null | undefined) {
  return value == null ? "N/A" : fmtPct(value);
}

function sourceLabel(row: ReturnType<typeof buildCapacityRouteSummaries>[number]) {
  if (row.data_status === "unavailable") return "Unavailable";
  if (row.is_proxy) return "Counterparty proxy";
  if (row.data_status === "cached") return "Cached";
  if (row.data_status === "historical") return "Historical";
  if (row.source === "ENTSOG") return "Live ENTSOG";
  return row.source ?? "N/A";
}

export function CapacityTable({ capacity, flows }: { capacity: CapacityRow[]; flows?: FlowRow[] }) {
  const rows = buildCapacityRouteSummaries(capacity, flows ?? []);

  return (
    <div className="rounded-md border bg-card p-3 shadow-sm">
      <div className="mb-2">
        <h3 className="text-sm font-semibold">Capacity overview</h3>
        <p className="text-xs text-muted-foreground">
          One row per operator-side route. Booked means aggregate firm booked capacity. Used is
          measured physical flow. Proxy rows are labelled explicitly.
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
            <TableHead>Source</TableHead>
            <TableHead>Reference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, idx) => (
            <TableRow key={row.route.id}>
              <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
              <TableCell className="text-xs">
                <div className="font-medium">{row.route.operator}</div>
                <div className="text-muted-foreground">{row.route.borderPoint}</div>
                {row.is_proxy && (
                  <div className="mt-1 text-[11px] text-amber-700">Counterparty-side proxy</div>
                )}
              </TableCell>
              <TableCell className="text-xs">{row.route.direction}</TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtMaybeMcm(row.technical_mcm)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtMaybeMcm(row.booked_mcm)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtMaybeMcm(row.used_mcm)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtMaybePct(row.utilisation_booked)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtMaybePct(row.utilisation_used)}
              </TableCell>
              <TableCell className="text-xs">
                <div>{sourceLabel(row)}</div>
                {row.is_carried_forward && row.capacity_source_date && (
                  <div className="text-[11px] text-muted-foreground">
                    Capacity as of {fmtShortDateYear(row.capacity_source_date)}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-xs">
                <div>
                  Capacity:{" "}
                  {row.capacity_reference_date
                    ? fmtShortDateYear(row.capacity_reference_date)
                    : "N/A"}
                </div>
                <div className="text-muted-foreground">
                  Flow:{" "}
                  {row.flow_reference_date ? fmtShortDateYear(row.flow_reference_date) : "N/A"}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
