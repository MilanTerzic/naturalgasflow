// EUR/HUF and EUR/RSD from the National Bank of Romania reference rates (BNR publishes
// RON per EUR, per 100 HUF and per RSD), so both crosses come from one official fixing.
// Relative imports only (unit-tested).

import type { FxRates } from "./convert";

export const BNR_FX_URL = "https://curs.bnr.ro/nbrfxrates10days.xml";

function rate(block: string, currency: string): number | null {
  const m = block.match(
    new RegExp(`<Rate\\s+currency="${currency}"(?:\\s+multiplier="(\\d+)")?\\s*>([\\d.]+)</Rate>`),
  );
  return m ? Number(m[2]) / Number(m[1] ?? 1) : null;
}

/** Newest BNR fixing on or before `onOrBefore` with EUR, HUF and RSD; crosses vs EUR. */
export function parseBnrCrosses(xml: string, onOrBefore: string): FxRates | null {
  const days = [...xml.matchAll(/<Cube\s+date="(\d{4}-\d{2}-\d{2})"\s*>([\s\S]*?)<\/Cube>/g)]
    .map((m) => ({ date: m[1], block: m[2] }))
    .filter((d) => d.date <= onOrBefore)
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const d of days) {
    const eur = rate(d.block, "EUR");
    if (!eur) continue;
    const huf = rate(d.block, "HUF");
    const rsd = rate(d.block, "RSD");
    return {
      date: d.date,
      hufPerEur: huf ? eur / huf : null,
      rsdPerEur: rsd ? eur / rsd : null,
      source: `BNR reference rates (${BNR_FX_URL})`,
    };
  }
  return null;
}
