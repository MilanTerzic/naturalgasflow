import { createFileRoute } from "@tanstack/react-router";
import { ModelPanel } from "@/components/dashboard/ModelPanel";
import { useDashboard } from "@/state/dashboard-context";
import { useDashboardData } from "@/state/use-dashboard-data";

export const Route = createFileRoute("/_dash/model")({
  head: () => ({
    meta: [
      { title: "Model & Assumptions — Serbia Gas Dashboard" },
      { name: "description", content: "Demand regression coefficients and operational assumptions used in the balance." },
    ],
  }),
  component: ModelPage,
});

function ModelPage() {
  const { balance } = useDashboardData();
  const s = useDashboard();
  return (
    <ModelPanel
      balance={balance}
      usePolynomial={s.usePolynomial}
      curveShift={s.curveShift}
      curveDistortion={s.curveDistortion}
      domesticProduction={s.domesticProduction}
      bihShare={s.bihShare}
    />
  );
}
