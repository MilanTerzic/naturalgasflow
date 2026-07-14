import type { FlowPoint } from "./config.ts";

export type CapacityOperator = "FGSZ" | "Bulgartransgaz" | "Gastrans";
export type CapacitySourceStrategy = "direct-entsog" | "counterparty-proxy";

export interface CapacityRouteDefinition {
  id: string;
  operator: CapacityOperator;
  borderPoint: string;
  shortPointName: string;
  direction: "entry" | "exit";
  countryFrom: string;
  countryTo: string;
  entsogPointDirection?: string;
  physicalFlowKey: FlowPoint;
  pairedRouteId?: string;
  sourceStrategy: CapacitySourceStrategy;
  displayOrder: number;
}

export const CAPACITY_ROUTES: CapacityRouteDefinition[] = [
  {
    id: "fgsz-kiskundorozsma-hu-exit",
    operator: "FGSZ",
    borderPoint: "Kiskundorozsma (HU) / Kiskundorozsma (RS)",
    shortPointName: "Kiskundorozsma (HU)",
    direction: "exit",
    countryFrom: "Hungary",
    countryTo: "Serbia",
    entsogPointDirection: "hu-tso-0001itp-00055exit",
    physicalFlowKey: "kiskundorozsma_hu",
    sourceStrategy: "direct-entsog",
    displayOrder: 1,
  },
  {
    id: "bgt-kireevo-bg-exit",
    operator: "Bulgartransgaz",
    borderPoint: "Kireevo (BG) / Zaychar (RS)",
    shortPointName: "Kireevo (BG)",
    direction: "exit",
    countryFrom: "Bulgaria",
    countryTo: "Serbia",
    entsogPointDirection: "bg-tso-0001itp-00529exit",
    physicalFlowKey: "kireevo",
    sourceStrategy: "direct-entsog",
    displayOrder: 2,
  },
  {
    id: "gastrans-kireevo-entry",
    operator: "Gastrans",
    borderPoint: "Kireevo (BG) / Zaychar (RS)",
    shortPointName: "Kireevo (BG)",
    direction: "entry",
    countryFrom: "Bulgaria",
    countryTo: "Serbia",
    physicalFlowKey: "kireevo",
    pairedRouteId: "bgt-kireevo-bg-exit",
    sourceStrategy: "counterparty-proxy",
    displayOrder: 3,
  },
  {
    id: "bgt-kalotina-bg-exit",
    operator: "Bulgartransgaz",
    borderPoint: "Kalotina (BG) / Dimitrovgrad (RS)",
    shortPointName: "Kalotina (BG)",
    direction: "exit",
    countryFrom: "Bulgaria",
    countryTo: "Serbia",
    entsogPointDirection: "bg-tso-0001itp-00134exit",
    physicalFlowKey: "kalotina",
    sourceStrategy: "direct-entsog",
    displayOrder: 4,
  },
  {
    id: "gastrans-kiskundorozsma2-exit",
    operator: "Gastrans",
    borderPoint: "Kiskundorozsma 2 / Horgos",
    shortPointName: "Kiskundorozsma 2",
    direction: "exit",
    countryFrom: "Serbia",
    countryTo: "Hungary",
    physicalFlowKey: "kiskundorozsma_2",
    pairedRouteId: "fgsz-kiskundorozsma2-entry",
    sourceStrategy: "counterparty-proxy",
    displayOrder: 5,
  },
  {
    id: "fgsz-kiskundorozsma2-entry",
    operator: "FGSZ",
    borderPoint: "Kiskundorozsma 2 / Horgos",
    shortPointName: "Kiskundorozsma 2",
    direction: "entry",
    countryFrom: "Serbia",
    countryTo: "Hungary",
    entsogPointDirection: "hu-tso-0001itp-10013entry",
    physicalFlowKey: "kiskundorozsma_2",
    sourceStrategy: "direct-entsog",
    displayOrder: 6,
  },
] as const satisfies CapacityRouteDefinition[];

export const CAPACITY_ROUTE_BY_ID = new Map(CAPACITY_ROUTES.map((route) => [route.id, route]));

export function capacityRouteLabel(route: CapacityRouteDefinition) {
  return `${route.operator} · ${route.shortPointName} (${route.direction})`;
}
