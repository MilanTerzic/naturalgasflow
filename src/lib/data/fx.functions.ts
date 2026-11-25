import { createServerFn } from "@tanstack/react-start";
import { fetchText } from "@/lib/prices/exchanges/http";
import { BNR_FX_URL, parseBnrCrosses } from "@/lib/gas/tariffs/fx";

/** EUR/HUF and EUR/RSD (BNR fixing on or before the given day) for tariff conversion. */
export const fetchTariffFx = createServerFn({ method: "GET" })
  .inputValidator((d: { onOrBefore: string }) => ({ onOrBefore: String(d?.onOrBefore ?? "") }))
  .handler(async ({ data }) => {
    try {
      const xml = await fetchText(BNR_FX_URL, {
        attempts: 2,
        timeoutMs: 15_000,
        accept: "text/xml",
      });
      const fx = xml ? parseBnrCrosses(xml, data.onOrBefore) : null;
      return fx
        ? { fx, error: null }
        : { fx: null, error: "BNR rates contain no EUR/HUF/RSD fixing" };
    } catch (err) {
      return {
        fx: null,
        error: `BNR rates unavailable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });
