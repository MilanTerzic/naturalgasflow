import { useState } from "react";
import { Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { arbitrageBrief, importPriceHistory } from "@/lib/data/arbitrage.functions";
import { parseCsv, parsePriceSheet, type ImportHub, type ImportResult } from "@/lib/gas/arb/import";
import { readXlsx } from "@/lib/prices/exchanges/xlsx";
import { cn } from "@/lib/utils";

type Parsed = { sheet: string; result: ImportResult }[];

function mergeSheets(parsed: Parsed) {
  const series: Partial<Record<ImportHub, { date: string; price: number }[]>> = {};
  const notes: string[] = [];
  for (const { sheet, result } of parsed)
    for (const [hub, xs] of Object.entries(result.series) as [
      ImportHub,
      { date: string; price: number }[],
    ][]) {
      if (series[hub])
        notes.push(
          `${hub} found again in sheet "${sheet}"; rows merged by date (later sheet wins).`,
        );
      const by = new Map((series[hub] ?? []).map((x) => [x.date, x.price]));
      for (const x of xs) by.set(x.date, x.price);
      series[hub] = [...by.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, price]) => ({ date, price }));
    }
  return { series, notes };
}

export function ImportPanel({
  imported,
  onImported,
}: {
  imported: Record<string, { count: number; from: string | null; to: string | null }>;
  onImported: () => void;
}) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const onFile = async (f: File | undefined) => {
    setMsg(null);
    setParsed(null);
    if (!f) return;
    setFileName(f.name);
    try {
      if (/\.(xlsx|xlsm)$/i.test(f.name)) {
        const wb = await readXlsx(new Uint8Array(await f.arrayBuffer()));
        setParsed(wb.sheetNames.map((s) => ({ sheet: s, result: parsePriceSheet(wb.sheets[s]) })));
      } else {
        setParsed([{ sheet: f.name, result: parsePriceSheet(parseCsv(await f.text())) }]);
      }
    } catch (err) {
      setMsg({
        tone: "err",
        text: `Could not read the file: ${err instanceof Error ? err.message : err}`,
      });
    }
  };

  const merged = parsed ? mergeSheets(parsed) : null;
  const total = merged
    ? Object.values(merged.series).reduce((s, xs) => s + (xs?.length ?? 0), 0)
    : 0;

  const doImport = async () => {
    if (!merged || !total) return;
    setBusy(true);
    try {
      const r = await importPriceHistory({ data: { series: merged.series } });
      setMsg({ tone: "ok", text: `Saved ${r.written} prices.` });
      setParsed(null);
      onImported();
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const stored = Object.entries(imported).filter(([, v]) => v.count);
  return (
    <div className="space-y-3 text-xs">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b">
              <th className="py-1 text-left font-medium">Stored series</th>
              <th className="py-1 text-right font-medium">Days</th>
              <th className="py-1 text-right font-medium">From</th>
              <th className="py-1 text-right font-medium">To</th>
            </tr>
          </thead>
          <tbody>
            {stored.length ? (
              stored.map(([h, v]) => (
                <tr key={h} className="border-b last:border-0">
                  <td className="py-1">{h}</td>
                  <td className="py-1 text-right tabular-nums">{v.count}</td>
                  <td className="py-1 text-right tabular-nums">{v.from}</td>
                  <td className="py-1 text-right tabular-nums">{v.to}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-1 text-muted-foreground">
                  Nothing stored yet — the tab is running on the exchanges' last 30–35 days only.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="rounded-md border border-dashed p-3">
        <p className="mb-2 text-muted-foreground">
          Import daily history from Excel (.xlsx) or CSV. One row per gas day: a date column
          (dd.mm.yyyy, ISO or Excel dates) and one column per hub, named e.g. <b>BGH</b>,{" "}
          <b>CEEGEX</b>/<b>HUDEX</b>, <b>TTF</b>, <b>CEGH</b>. Add "MA" / "month" to a header for
          month-ahead quotes. Blank cells stay gaps; volume and spread columns are ignored. All
          sheets are read.
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-1.5 hover:bg-accent">
          <Upload className="h-3.5 w-3.5" />
          <span>{fileName || "Choose file"}</span>
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv,.txt,.tsv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {parsed && merged && (
          <div className="mt-3 space-y-2">
            {parsed.map(({ sheet, result }) => (
              <div key={sheet}>
                <div className="font-semibold">Sheet "{sheet}"</div>
                <div className="text-muted-foreground">
                  {result.columns
                    .filter((c) => c.hub)
                    .map(
                      (c) =>
                        `${c.header || `col ${c.index + 1}`} → ${c.hub}${c.reason && c.reason !== "primary" ? ` (${c.reason})` : ""}`,
                    )
                    .join(" · ") || "no hub columns found"}
                  {result.columns.some((c) => !c.hub && c.reason !== "date") &&
                    ` · ${result.columns.filter((c) => !c.hub && c.reason !== "date").length} other column(s) ignored`}
                </div>
                {result.issues.map((i) => (
                  <div key={i} className="text-amber-700">
                    {i}
                  </div>
                ))}
              </div>
            ))}
            {merged.notes.map((n) => (
              <div key={n} className="text-amber-700">
                {n}
              </div>
            ))}
            <table className="w-full">
              <tbody>
                {Object.entries(merged.series).map(([h, xs]) => (
                  <tr key={h}>
                    <td className="py-0.5 pr-2 font-medium">{h}</td>
                    <td className="py-0.5 pr-2 tabular-nums">{xs?.length} days</td>
                    <td className="py-0.5 tabular-nums text-muted-foreground">
                      {xs?.[0]?.date} → {xs?.[xs.length - 1]?.date}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button size="sm" disabled={!total || busy} onClick={doImport}>
              {busy ? "Saving…" : `Import ${total} prices`}
            </Button>
          </div>
        )}
        {msg && (
          <p className={cn("mt-2", msg.tone === "ok" ? "text-emerald-700" : "text-rose-700")}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

type Brief = Awaited<ReturnType<typeof arbitrageBrief>>;

export function AiBrief({ facts }: { facts: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setBrief(await arbitrageBrief({ data: { facts } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={run} disabled={busy}>
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {busy ? "Writing…" : brief ? "Refresh brief" : "Write trader brief"}
        </Button>
        <span className="text-muted-foreground">
          Uses AI credits on click. Written only from the numbers on this page.
        </span>
      </div>
      {err && <p className="text-rose-700">{err}</p>}
      {brief && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{brief.headline}</span>
            <span className="rounded border px-1.5 py-0.5 text-[10px] font-semibold">
              {brief.view}
            </span>
            <span className="text-[10px] text-muted-foreground">confidence {brief.confidence}</span>
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {brief.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          {brief.risks.length > 0 && (
            <div>
              <div className="font-semibold">Risks</div>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {brief.risks.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
