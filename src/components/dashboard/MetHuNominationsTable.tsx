import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CONVERSION_MCM_TO_MWH } from "@/lib/gas/config";
import { fmtMcm } from "@/lib/gas/format";
import { splitHungaryEntry, type MetHuNomination } from "@/lib/gas/met-nominations";
import type { BalanceRow } from "@/lib/gas/types";
import { removeMetHuNomination, saveMetHuNomination } from "@/lib/met-hu-nominations.functions";

type Unit = "mwh" | "mcm";
type Drafts = Record<string, string>;

function inputValue(nominatedMwh: number | undefined, unit: Unit): string {
  if (nominatedMwh === undefined) return "";
  const amount = unit === "mwh" ? nominatedMwh : nominatedMwh / CONVERSION_MCM_TO_MWH;
  return Number(amount.toFixed(unit === "mwh" ? 3 : 6)).toString();
}

export function MetHuNominationsTable({
  balance, today, nominations, loading, loadError, disabled,
}: {
  balance: BalanceRow[];
  today: string;
  nominations: MetHuNomination[];
  loading: boolean;
  loadError: string | null;
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [unit, setUnit] = useState<Unit>("mwh");
  const [drafts, setDrafts] = useState<Drafts>({});
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const nominationByDate = new Map(nominations.map((row) => [row.gas_day, row]));
  const rows = [...balance].sort((a, b) => {
    if (a.date === today) return -1;
    if (b.date === today) return 1;
    const pastA = a.date <= today;
    const pastB = b.date <= today;
    if (pastA !== pastB) return pastA ? -1 : 1;
    return pastA ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  });

  const setDisplayUnit = (next: Unit) => {
    if (next === unit) return;
    setDrafts((previous) =>
      Object.fromEntries(Object.entries(previous).map(([day, text]) => {
        const parsed = Number(text);
        if (text.trim() === "" || !Number.isFinite(parsed)) return [day, text];
        const converted = next === "mcm" ? parsed / CONVERSION_MCM_TO_MWH : parsed * CONVERSION_MCM_TO_MWH;
        return [day, Number(converted.toFixed(next === "mcm" ? 6 : 3)).toString()];
      })),
    );
    setUnit(next);
  };

  const save = async (gasDay: string) => {
    const prior = nominationByDate.get(gasDay);
    const draft = drafts[gasDay] ?? inputValue(prior?.nominated_mwh, unit);
    if (draft.trim() === "") {
      setActionError("Enter a number (including 0) before saving. Use Remove to delete a nomination.");
      return;
    }
    const parsed = Number(draft);
    const nominatedMwh = unit === "mwh" ? parsed : parsed * CONVERSION_MCM_TO_MWH;
    if (!Number.isFinite(nominatedMwh) || nominatedMwh < 0 || nominatedMwh > 1_000_000) {
      setActionError("Enter a non-negative nomination no greater than 1,000,000 MWh/day.");
      return;
    }
    setBusyDate(gasDay);
    setActionError(null);
    try {
      await saveMetHuNomination({ data: { gasDay, nominatedMwh } });
      await queryClient.invalidateQueries({ queryKey: ["met-hu-nominations"] });
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[gasDay];
        return next;
      });
      setLastSaved(gasDay);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save nomination.");
    } finally {
      setBusyDate(null);
    }
  };

  const remove = async (gasDay: string) => {
    if (!nominationByDate.has(gasDay)) return;
    setBusyDate(gasDay);
    setActionError(null);
    try {
      await removeMetHuNomination({ data: { gasDay } });
      await queryClient.invalidateQueries({ queryKey: ["met-hu-nominations"] });
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[gasDay];
        return next;
      });
      setLastSaved(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not remove nomination.");
    } finally {
      setBusyDate(null);
    }
  };

  return (
    <section className="rounded-xl border bg-card" aria-label="MET Hungary entry nominations">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">MET nominations: Hungary → Serbia</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Enter MET's daily nominated volume. Other Hungary entry = ENTSOG Hungary allocation − MET nomination.
            A nomination is not a measurement of MET's physical delivery.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium">
          Input unit
          <select
            value={unit}
            onChange={(event) => setDisplayUnit(event.target.value as Unit)}
            disabled={disabled}
            className="h-9 rounded-md border bg-background px-2"
          >
            <option value="mwh">MWh/day</option>
            <option value="mcm">mcm/day</option>
          </select>
        </label>
      </div>

      {disabled && (
        <div className="px-4 pt-3 text-xs text-amber-700">
          Switch to Live Data to view and edit shared nominations.
        </div>
      )}
      {loading && <p className="px-4 pt-3 text-xs text-muted-foreground">Loading shared nominations…</p>}
      {loadError && (
        <div role="alert" className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {loadError}. The database migration may need to be applied; saved values cannot be shown until this is fixed.
        </div>
      )}
      {actionError && (
        <div role="alert" className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {actionError}
        </div>
      )}
      {lastSaved && !actionError && (
        <p role="status" className="px-4 pt-2 text-xs text-emerald-700">
          MET nomination for {lastSaved} saved and chart updated.
        </p>
      )}

      <div className="max-h-[430px] overflow-auto">
        <table className="w-full min-w-[850px] text-left text-xs">
          <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Gas day</th>
              <th className="px-3 py-2 text-right font-medium">HU entry (mcm/d)</th>
              <th className="px-3 py-2 font-medium">MET nomination ({unit === "mwh" ? "MWh/d" : "mcm/d"})</th>
              <th className="px-3 py-2 text-right font-medium">MET (mcm/d)</th>
              <th className="px-3 py-2 text-right font-medium">Others (mcm/d)</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const saved = nominationByDate.get(row.date);
              const observed = row.supply_available ? row.kiskundorozsma_entry_mcm : null;
              const split = splitHungaryEntry(observed, saved?.nominated_mwh ?? null);
              const draft = drafts[row.date] ?? inputValue(saved?.nominated_mwh, unit);
              const edited = drafts[row.date] !== undefined;
              const isSaving = busyDate === row.date;
              const blocked = disabled || loading || !!loadError || !!busyDate;
              return (
                <tr key={row.date} className={row.date === today ? "border-b bg-primary/5" : "border-b last:border-0"}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {row.date}{row.date === today && <span className="ml-1 text-primary">(Today)</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {observed == null ? "—" : fmtMcm(observed)}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`MET nomination for ${row.date}`}
                      type="number" min="0" step="any"
                      placeholder="Not entered"
                      value={draft}
                      onChange={(event) => {
                        setDrafts((previous) => ({ ...previous, [row.date]: event.target.value }));
                        setLastSaved(null);
                      }}
                      disabled={disabled || loading || !!loadError || isSaving}
                      className="h-8 w-36 rounded-md border bg-background px-2 tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {split.metMcm == null ? "—" : fmtMcm(split.metMcm)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {split.othersMcm == null ? "—" : fmtMcm(split.othersMcm)}
                  </td>
                  <td className="px-3 py-2">
                    {split.status === "split" ? (
                      <span className="text-emerald-700">Split saved</span>
                    ) : split.status === "over_nomination" ? (
                      <span className="font-medium text-amber-700">MET exceeds HU entry</span>
                    ) : split.status === "missing_allocation" ? (
                      <span className="text-muted-foreground">No HU allocation</span>
                    ) : (
                      <span className="text-muted-foreground">Awaiting nomination</span>
                    )}
                    {saved && (
                      <div className="max-w-44 truncate text-[10px] text-muted-foreground" title={`Edited by ${saved.updated_by_email} · ${saved.updated_at}`}>
                        {saved.updated_by_email} · {saved.updated_at.slice(0, 10)}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button" disabled={blocked || (!edited && !saved)}
                      onClick={() => void save(row.date)}
                      className="rounded-md border bg-background px-2 py-1.5 font-medium text-primary disabled:opacity-40"
                    >
                      {isSaving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button" disabled={blocked || !saved}
                      onClick={() => void remove(row.date)}
                      className="ml-1 rounded-md border px-2 py-1.5 text-muted-foreground disabled:opacity-40"
                    >Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        Shared nominations are saved by gas day in Supabase and displayed using the selected unit.
        If no nomination is saved, HU entry remains <strong>unattributed</strong>, not automatically
        "Others". If MET exceeds HU Allocation, the chart preserves the ENTSOG total and marks
        the split as unreconciled. Future-day nominations can be stored before allocations arrive.
        The input only changes chart attribution, not total Serbian supply or demand.
      </div>
    </section>
  );
}
