import { useState, type ReactNode } from "react";
import { ChevronDown, PanelRightOpen, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useDashboard } from "@/state/dashboard-context";
import { cn } from "@/lib/utils";

const ASSUMPTION_DEFAULTS = {
  usePolynomial: true,
  curveShift: 1,
  curveDistortion: 1,
  domesticProduction: 0.5,
  bihShare: 0.07,
} as const;

export function Sidebar() {
  return (
    <aside className="hidden border-r bg-sidebar/80 p-4 text-sidebar-foreground lg:block lg:w-72 lg:shrink-0">
      <DashboardControls />
    </aside>
  );
}

export function MobileControlsSheet({ className }: { className?: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-9 gap-2", className)}
          aria-label="Open dashboard controls"
        >
          <PanelRightOpen className="h-4 w-4" />
          Controls
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(92vw,390px)] overflow-y-auto p-4">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle className="text-base">Dashboard controls</SheetTitle>
          <SheetDescription>
            Adjust data view and scenario assumptions for the current dashboard.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5">
          <DashboardControls compact />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DashboardControls({ compact = false }: { compact?: boolean }) {
  const s = useDashboard();
  const resetAssumptions = () => {
    s.setUsePolynomial(ASSUMPTION_DEFAULTS.usePolynomial);
    s.setCurveShift(ASSUMPTION_DEFAULTS.curveShift);
    s.setCurveDistortion(ASSUMPTION_DEFAULTS.curveDistortion);
    s.setDomesticProduction(ASSUMPTION_DEFAULTS.domesticProduction);
    s.setBihShare(ASSUMPTION_DEFAULTS.bihShare);
  };

  return (
    <div className={cn("space-y-4", compact ? "pb-4" : "sticky top-[88px]")}>
      {!compact && (
        <div>
          <h2 className="text-sm font-semibold">Controls</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Live ENTSOG and Open-Meteo data are the default view. Scenario tuning is grouped below.
          </p>
        </div>
      )}

      <section className="space-y-3 rounded-lg border bg-card p-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground">Data view</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Live data range and demo mode.</p>
        </div>
        <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
          <div>
            <Label className="text-xs font-medium">Demo data</Label>
            <p className="text-[11px] text-muted-foreground">Offline preview mode</p>
          </div>
          <Switch
            aria-label="Toggle demo data"
            checked={s.mode === "dummy"}
            onCheckedChange={(v) => s.setMode(v ? "dummy" : "live")}
          />
        </div>
        <RangeSlider
          label="Past days"
          value={s.rangePastDays}
          min={3}
          max={60}
          step={1}
          onChange={(value) => s.setRange(value, s.rangeFutureDays)}
        />
        <RangeSlider
          label="Future days"
          value={s.rangeFutureDays}
          min={0}
          max={16}
          step={1}
          onChange={(value) => s.setRange(s.rangePastDays, value)}
        />
      </section>

      <AdvancedSection title="Demand scenario" defaultOpen={false}>
        <div className="flex min-h-10 items-center justify-between gap-3">
          <Label className="text-xs">Polynomial model</Label>
          <Switch
            aria-label="Toggle polynomial demand model"
            checked={s.usePolynomial}
            onCheckedChange={s.setUsePolynomial}
          />
        </div>
        <RangeSlider
          label="Curve shift (mcm/day)"
          value={s.curveShift}
          min={-5}
          max={5}
          step={0.1}
          format={(value) => value.toFixed(1)}
          onChange={s.setCurveShift}
        />
        <RangeSlider
          label="Curve distortion"
          value={s.curveDistortion}
          min={0.5}
          max={1.5}
          step={0.01}
          format={(value) => value.toFixed(2)}
          onChange={s.setCurveDistortion}
        />
      </AdvancedSection>

      <AdvancedSection title="Balance assumptions" defaultOpen={false}>
        <RangeSlider
          label="Domestic production (mcm/day)"
          value={s.domesticProduction}
          min={0}
          max={2}
          step={0.05}
          format={(value) => value.toFixed(2)}
          onChange={s.setDomesticProduction}
        />
        <RangeSlider
          label="Bosnia share"
          value={s.bihShare * 100}
          min={0}
          max={20}
          step={0.5}
          format={(value) => `${value.toFixed(1)}%`}
          onChange={(value) => s.setBihShare(value / 100)}
        />
      </AdvancedSection>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start text-muted-foreground"
        onClick={resetAssumptions}
      >
        <RotateCcw className="h-4 w-4" />
        Reset scenario assumptions
      </Button>
    </div>
  );
}

function AdvancedSection({
  title,
  children,
  defaultOpen,
}: {
  title: string;
  children: ReactNode;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
        >
          {title}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 border-t px-3 py-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => v.toFixed(0),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs font-medium tabular-nums text-foreground">{format(value)}</span>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}
