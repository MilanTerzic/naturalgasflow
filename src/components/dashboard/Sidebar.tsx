import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useDashboard } from "@/state/dashboard-context";

export function Sidebar() {
  const s = useDashboard();
  return (
    <aside className="space-y-5 border-r bg-sidebar p-4 text-sidebar-foreground lg:w-72 lg:shrink-0">
      <div>
        <h2 className="text-sm font-semibold">Dashboard controls</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Defaults to dummy data. Switch to live to fetch Open-Meteo + ENTSOG.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border bg-card p-3">
        <div>
          <Label className="text-xs font-medium">Use dummy data</Label>
          <p className="text-[11px] text-muted-foreground">Offline preview</p>
        </div>
        <Switch
          checked={s.mode === "dummy"}
          onCheckedChange={(v) => s.setMode(v ? "dummy" : "live")}
        />
      </div>

      <div className="space-y-3 rounded-md border bg-card p-3">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs font-medium">Past days</Label>
            <span className="text-xs tabular-nums">{s.rangePastDays}</span>
          </div>
          <Slider
            value={[s.rangePastDays]}
            min={3}
            max={60}
            step={1}
            onValueChange={(v) => s.setRange(v[0], s.rangeFutureDays)}
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs font-medium">Future days</Label>
            <span className="text-xs tabular-nums">{s.rangeFutureDays}</span>
          </div>
          <Slider
            value={[s.rangeFutureDays]}
            min={0}
            max={16}
            step={1}
            onValueChange={(v) => s.setRange(s.rangePastDays, v[0])}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border bg-card p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Demand model
        </h3>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Polynomial model</Label>
          <Switch
            checked={s.usePolynomial}
            onCheckedChange={s.setUsePolynomial}
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs">Curve shift (mcm/d)</Label>
            <span className="text-xs tabular-nums">{s.curveShift.toFixed(1)}</span>
          </div>
          <Slider
            value={[s.curveShift]}
            min={-5}
            max={5}
            step={0.1}
            onValueChange={(v) => s.setCurveShift(v[0])}
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs">Curve distortion (×)</Label>
            <span className="text-xs tabular-nums">{s.curveDistortion.toFixed(2)}</span>
          </div>
          <Slider
            value={[s.curveDistortion]}
            min={0.5}
            max={1.5}
            step={0.01}
            onValueChange={(v) => s.setCurveDistortion(v[0])}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border bg-card p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Balance inputs
        </h3>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs">Domestic production (mcm/d)</Label>
            <span className="text-xs tabular-nums">{s.domesticProduction.toFixed(2)}</span>
          </div>
          <Slider
            value={[s.domesticProduction]}
            min={0}
            max={2}
            step={0.05}
            onValueChange={(v) => s.setDomesticProduction(v[0])}
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs">Bosnia share (%)</Label>
            <span className="text-xs tabular-nums">{(s.bihShare * 100).toFixed(1)}</span>
          </div>
          <Slider
            value={[s.bihShare * 100]}
            min={0}
            max={20}
            step={0.5}
            onValueChange={(v) => s.setBihShare(v[0] / 100)}
          />
        </div>
      </div>
    </aside>
  );
}
