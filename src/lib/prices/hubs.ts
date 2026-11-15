// Gas trading hubs relevant to the Balkan map and how (whether) each is fetched.
// Pure data, relative imports only.

export type HubId = "TTF" | "CEGH" | "BGH" | "CEEGEX" | "HENEX" | "BRM" | "EPIAS";

export interface HubDef {
  id: HubId;
  name: string;
  /** Where the published price can be checked by a person. */
  url: string;
  /** "live" = fetched by the server; "none" = no machine-readable public source yet. */
  feed: "live" | "none";
  /** Why there is no feed (shown in the UI). */
  reason?: string;
}

export const HUBS: Record<HubId, HubDef> = {
  TTF: {
    id: "TTF",
    name: "TTF (EEX NGP)",
    url: "https://www.eex.com/en/market-data/indices-benchmark/indices",
    feed: "live",
  },
  CEGH: { id: "CEGH", name: "CEGH VTP (CEGHIX)", url: "https://www.cegh.at", feed: "live" },
  BGH: {
    id: "BGH",
    name: "Balkan Gas Hub (BGHSPOT)",
    url: "https://www.balkangashub.bg/en",
    feed: "live",
    reason:
      "BGH fills its price table in the browser; its public-data API needs the BGH registration form and API agreement.",
  },
  CEEGEX: {
    id: "CEEGEX",
    name: "CEEGEX (CEEREP)",
    url: "https://ceegex.hu/en/market-data/daily-data",
    feed: "live",
  },
  HENEX: {
    id: "HENEX",
    name: "HEnEx (HGSIDA)",
    url: "https://www.enexgroup.gr/gas-official-list",
    feed: "live",
  },
  BRM: {
    id: "BRM",
    name: "BRM (PMP Global)",
    url: "https://brm.ro/PIATA-SPOT-GN/",
    feed: "live",
  },
  EPIAS: {
    id: "EPIAS",
    name: "EPİAŞ GRF",
    url: "https://seffaflik.epias.com.tr",
    feed: "none",
    reason: "EPİAŞ transparency API requires a registered account.",
  },
};

/**
 * Pricing per country on the map (keys are the Natural Earth names used by the map).
 * `hub` = the country's own traded hub; `reference` = hubs its imports are priced
 * against when it has no hub. A reference hub is never shown as the local price.
 */
export const COUNTRY_PRICING: Record<string, { hub?: HubId; reference?: HubId[] }> = {
  Austria: { hub: "CEGH" },
  Hungary: { hub: "CEEGEX", reference: ["CEGH"] },
  Bulgaria: { hub: "BGH", reference: ["CEGH"] },
  Greece: { hub: "HENEX", reference: ["TTF"] },
  Romania: { hub: "BRM", reference: ["CEGH"] },
  Turkey: { hub: "EPIAS" },
  Serbia: { reference: ["CEGH", "BGH"] },
  "Bosnia and Herz.": { reference: ["CEGH"] },
  Macedonia: { reference: ["BGH"] },
  Croatia: { reference: ["CEGH"] },
  Slovenia: { reference: ["CEGH"] },
  Montenegro: {},
  Albania: {},
  Kosovo: {},
};
