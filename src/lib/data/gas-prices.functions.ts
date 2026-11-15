// Public gas spot prices for the Balkan map. No API keys: only public files / pages.
//   TTF  — EEX Neutral Gas Price CSVs (final 60-day history + 15-minute current file)
//   CEGH — CEGHIX day-ahead table on the CEGH homepage
// Every hub reports its own status; a failed or changed source never produces a number.
import { createServerFn } from "@tanstack/react-start";
import { HUBS, type HubId } from "@/lib/prices/hubs";
import { parseCeghDayAhead, parseEexNgpCsv, type PricePoint } from "@/lib/prices/parsers";

export type PriceStatus = "live" | "cache" | "stale" | "error" | "unavailable";

export interface HubPrices {
  hub: HubId;
  status: PriceStatus;
  reason?: string;
  /** Ascending by date. €/MWh. */
  points: PricePoint[];
  fetchedAt: string;
  sourceUrl: string;
}

export interface GasPricesResponse {
  hubs: Record<HubId, HubPrices>;
  fetchedAt: string;
}

const TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const cache = new Map<HubId, { at: number; res: HubPrices }>();

const EEX_HISTORY = "https://gasandregistry.eex.com/Gas/NGP/TTF_NGP_60_Days.csv";
const EEX_CURRENT = "https://gasandregistry.eex.com/Gas/NGP/TTF_NGP_15_Mins.csv";
const CEGH_HOME = "https://www.cegh.at/";

async function getText(url: string, referer: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SerbiaGasDashboard/1.0)",
        accept: "text/csv,text/html,application/xhtml+xml,*/*",
        referer,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function belgradeToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(new Date());
}

async function withCache(
  hub: HubId,
  load: () => Promise<PricePoint[]>,
  sourceUrl: string,
): Promise<HubPrices> {
  const cached = cache.get(hub);
  if (cached && Date.now() - cached.at < TTL_MS) return { ...cached.res, status: "cache" };
  try {
    const points = await load();
    if (!points.length)
      throw new Error("source answered but no prices could be read (format may have changed)");
    const res: HubPrices = {
      hub,
      status: "live",
      points,
      fetchedAt: new Date().toISOString(),
      sourceUrl,
    };
    cache.set(hub, { at: Date.now(), res });
    return res;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "request failed";
    console.warn(`[gas-prices] ${hub}: ${reason}`);
    if (cached)
      return { ...cached.res, status: "stale", reason: `Last good fetch kept: ${reason}` };
    return {
      hub,
      status: "error",
      reason,
      points: [],
      fetchedAt: new Date().toISOString(),
      sourceUrl,
    };
  }
}

async function loadTtf(): Promise<PricePoint[]> {
  const [history, current] = await Promise.allSettled([
    getText(EEX_HISTORY, "https://www.eex.com/"),
    getText(EEX_CURRENT, "https://www.eex.com/"),
  ]);
  const finals = history.status === "fulfilled" ? parseEexNgpCsv(history.value, true) : [];
  const provisional = current.status === "fulfilled" ? parseEexNgpCsv(current.value, false) : [];
  // Final prices win; the 15-minute file only adds days without a final value yet.
  const byDate = new Map<string, PricePoint>();
  for (const p of provisional) if (p.date) byDate.set(p.date, p);
  for (const p of finals) if (p.date) byDate.set(p.date, p);
  if (!byDate.size && history.status === "rejected") throw history.reason;
  return [...byDate.values()].sort((a, b) => (a.date! < b.date! ? -1 : 1));
}

async function loadCegh(): Promise<PricePoint[]> {
  return parseCeghDayAhead(await getText(CEGH_HOME, CEGH_HOME), belgradeToday());
}

export const fetchGasPrices = createServerFn({ method: "GET" }).handler(
  async (): Promise<GasPricesResponse> => {
    const [ttf, cegh] = await Promise.all([
      withCache("TTF", loadTtf, HUBS.TTF.url),
      withCache("CEGH", loadCegh, HUBS.CEGH.url),
    ]);
    const now = new Date().toISOString();
    const none = (hub: HubId): HubPrices => ({
      hub,
      status: "unavailable",
      reason: HUBS[hub].reason,
      points: [],
      fetchedAt: now,
      sourceUrl: HUBS[hub].url,
    });
    return {
      fetchedAt: now,
      hubs: {
        TTF: ttf,
        CEGH: cegh,
        BGH: none("BGH"),
        CEEGEX: none("CEEGEX"),
        HENEX: none("HENEX"),
        BRM: none("BRM"),
        EPIAS: none("EPIAS"),
      },
    };
  },
);
