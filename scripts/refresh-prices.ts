#!/usr/bin/env bun
// Manually refresh all four exchange providers (BGH, CEEGEX, HEnEx, BRM) and print an
// audit table. Optional: upsert into Supabase when SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set.
//
//   bun run prices:refresh            # fetch + audit
//   bun run prices:refresh --json     # also print every observation as JSON
//   bun run prices:refresh --backfill # HEnEx: fetch all of the last 30 trading days

import {
  MARKET_META,
  addDays,
  expectedTradingDate,
  type ProviderResult,
} from "../src/lib/prices/exchanges/types";
import {
  EXCHANGE_MARKETS,
  runProvider,
  summarise,
  BACKFILL_DAYS,
} from "../src/lib/prices/exchanges/run";
import { fetchHenex } from "../src/lib/prices/exchanges/henex";
import { toRow } from "../src/lib/prices/exchanges/store.server";

const args = new Set(process.argv.slice(2));

async function main() {
  const results: ProviderResult[] = await Promise.all(
    EXCHANGE_MARKETS.map((m) => {
      if (m === "HENEX" && args.has("--backfill")) {
        const newest = expectedTradingDate(MARKET_META.HENEX);
        return fetchHenex(Array.from({ length: BACKFILL_DAYS }, (_, i) => addDays(newest, -i)));
      }
      return runProvider(m);
    }),
  );

  const rows = results.map((r) => {
    const s = summarise(r.market, r.observations, {
      status: r.status,
      message: r.message,
      at: r.fetchedAt,
      lastSuccessAt: r.observations.length ? r.fetchedAt : null,
    });
    const p = s.latest;
    return {
      Exchange: r.market,
      Status: s.status,
      "Fetch status": r.status,
      Metric: p?.metric ?? "—",
      "Trading date": p?.tradingDate ?? "—",
      "Delivery date": p?.deliveryDate ?? "—",
      "EUR/MWh": p ? p.price.toFixed(3) : "—",
      Original:
        p?.originalCurrency && p.originalCurrency !== "EUR"
          ? `${p.originalPrice} ${p.originalCurrency} @ ${p.fxRate}`
          : "—",
      "Volume MWh": p?.volumeMwh ?? "—",
      Observations: r.observations.length,
      "Ingested at": r.observations.length ? r.fetchedAt : "—",
      Note: (r.message ?? "").slice(0, 90),
    };
  });
  console.table(rows);

  for (const r of results) {
    if (r.status !== "OK")
      console.log(
        `\n[${r.market}] diagnostics:`,
        JSON.stringify(r.diagnostics, null, 2).slice(0, 2500),
      );
  }
  if (args.has("--json"))
    console.log(
      JSON.stringify(
        results.flatMap((r) => r.observations),
        null,
        2,
      ),
    );

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, key, { auth: { persistSession: false } });
    for (const r of results) {
      if (r.observations.length) {
        const { error } = await db
          .from("gas_price_observations")
          .upsert(r.observations.map(toRow), {
            onConflict: "market,product,metric,trading_date,delivery_date",
          });
        console.log(
          `[${r.market}] upsert ${r.observations.length}: ${error ? error.message : "ok"}`,
        );
      }
      await db.from("gas_price_feed_status").upsert(
        {
          market: r.market,
          last_attempt_at: r.fetchedAt,
          last_success_at: r.observations.length ? r.fetchedAt : null,
          status: r.status,
          message: r.message ?? null,
          diagnostics: r.diagnostics,
        },
        { onConflict: "market" },
      );
    }
  } else {
    console.log(
      "\n(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: nothing written to the database)",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
