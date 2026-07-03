// AGSI+ (GIE) gas storage — server function wrapper for the AGSI REST API.
// Docs: https://agsi.gie.eu/  (requires an x-key API key)
import { createServerFn } from "@tanstack/react-start";

export interface AgsiRow {
  gasDayStart: string; // YYYY-MM-DD
  gasInStorage: number | null; // TWh
  full: number | null; // %
  workingGasVolume: number | null; // TWh
  injection: number | null; // GWh/d
  withdrawal: number | null; // GWh/d
  injectionCapacity: number | null; // GWh/d
  withdrawalCapacity: number | null; // GWh/d
  trend: number | null;
  status: string | null; // C / E / N
  info: string | null;
}

export interface AgsiResponse {
  country: string;
  from: string;
  to: string;
  data: AgsiRow[];
  fetchedAt: string;
  error?: string;
  missingKey?: boolean;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const cache = new Map<string, { at: number; res: AgsiResponse }>();

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

async function fetchPage(country: string, from: string, to: string, page: number, key: string) {
  const isEu = country.toLowerCase() === "eu";
  const params = new URLSearchParams({
    from,
    to,
    size: "300",
    page: String(page),
  });
  if (isEu) params.set("type", "EU");
  else params.set("country", country.toUpperCase());
  const url = `https://agsi.gie.eu/api?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "x-key": key, accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`AGSI HTTP ${res.status}`);
  }
  return (await res.json()) as {
    last_page?: number;
    current_page?: number;
    data?: Array<Record<string, unknown>>;
  };
}

export const fetchAgsiStorage = createServerFn({ method: "GET" })
  .inputValidator((input: { country: string; from: string; to: string }) => input)
  .handler(async ({ data }): Promise<AgsiResponse> => {
    const country = (data.country || "eu").toLowerCase();
    const from = data.from;
    const to = data.to;
    const key = process.env.AGSI_API_KEY;
    const cacheKey = `${country}|${from}|${to}`;
    const now = Date.now();

    if (!key) {
      return {
        country,
        from,
        to,
        data: [],
        fetchedAt: new Date().toISOString(),
        missingKey: true,
        error: "AGSI_API_KEY not configured",
      };
    }

    const hit = cache.get(cacheKey);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.res;

    try {
      const rows: AgsiRow[] = [];
      // AGSI paginates newest → oldest. Fetch all pages.
      let page = 1;
      let lastPage = 1;
      do {
        const j = await fetchPage(country, from, to, page, key);
        lastPage = j.last_page ?? 1;
        for (const r of j.data ?? []) {
          const gasDay = str(r.gasDayStart);
          if (!gasDay) continue;
          rows.push({
            gasDayStart: gasDay,
            gasInStorage: num(r.gasInStorage),
            full: num(r.full),
            workingGasVolume: num(r.workingGasVolume),
            injection: num(r.injection),
            withdrawal: num(r.withdrawal),
            injectionCapacity: num(r.injectionCapacity),
            withdrawalCapacity: num(r.withdrawalCapacity),
            trend: num(r.trend),
            status: str(r.status),
            info: str(r.info),
          });
        }
        page += 1;
        if (page > 40) break; // safety
      } while (page <= lastPage);

      rows.sort((a, b) => a.gasDayStart.localeCompare(b.gasDayStart));

      const res: AgsiResponse = {
        country,
        from,
        to,
        data: rows,
        fetchedAt: new Date().toISOString(),
      };
      cache.set(cacheKey, { at: now, res });
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Fall back to last cached value if any.
      if (hit) return { ...hit.res, error: `${msg} (showing cached)` };
      return {
        country,
        from,
        to,
        data: [],
        fetchedAt: new Date().toISOString(),
        error: msg,
      };
    }
  });
