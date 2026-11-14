"use client";

import { useState } from "react";
import {
  Database,
  Download,
  Info,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Sliders,
  Sparkles,
  Boxes,
} from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "@/state/settings-context";
import { useSimulation } from "@/state/simulation-context";
import { getScenario } from "@/simulation/scenarios";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadTextFile } from "@/lib/export";
import { APP_VERSION } from "@/lib/constants";

function Row({
  id,
  label,
  hint,
  control,
}: {
  id: string;
  label: string;
  hint: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border/60 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <Label htmlFor={id} className="text-[13px] text-foreground">
          {label}
        </Label>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const { state, loadScenario, reset: resetScenario } = useSimulation();
  const [resetAllOpen, setResetAllOpen] = useState(false);

  const saved = (label: string) => toast.success(`${label} saved`, { id: "settings" });

  const exportWorkspace = () => {
    const snapshot = {
      app: "BLACKBOX",
      version: APP_VERSION,
      exportedAtTick: state.tick,
      settings,
      simulation: {
        scenarioId: state.scenarioId,
        seed: state.seed,
        health: state.health,
        tick: state.tick,
        incidents: state.incidents,
        actions: state.actions,
        healthSeries: state.healthSeries,
        serviceSummary: Object.values(state.services).map((s) => ({
          id: s.id,
          status: s.status,
          availability: s.availability,
        })),
      },
    };
    downloadTextFile(
      `blackbox-workspace-t${state.tick}.json`,
      JSON.stringify(snapshot, null, 2),
      "application/json",
    );
    toast.success("Workspace snapshot downloaded");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Application preferences, simulation defaults and workspace configuration — persisted locally in your browser."
        actions={
          <Badge variant="secondary" className="px-3 py-1.5">
            <Save className="h-3.5 w-3.5" /> Auto-saved
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Simulation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-primary" /> Simulation
            </CardTitle>
            <CardDescription>Defaults applied when the app loads</CardDescription>
          </CardHeader>
          <CardContent>
            <Row
              id="default-speed"
              label="Default playback speed"
              hint="Tick rate used on launch (1 tick = 1 simulated minute)."
              control={
                <Select
                  value={String(settings.defaultSpeed)}
                  onValueChange={(v) => {
                    update({ defaultSpeed: Number(v) as 0.5 | 1 | 2 | 4 });
                    saved("Default speed");
                  }}
                >
                  <SelectTrigger id="default-speed" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.5">0.5×</SelectItem>
                    <SelectItem value="1">1×</SelectItem>
                    <SelectItem value="2">2×</SelectItem>
                    <SelectItem value="4">4×</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <Row
              id="auto-start"
              label="Auto-start simulation"
              hint="Begin ticking immediately when the app loads."
              control={
                <Switch
                  id="auto-start"
                  checked={settings.autoStart}
                  onCheckedChange={(v) => {
                    update({ autoStart: v });
                    saved("Auto-start");
                  }}
                />
              }
            />
            <Row
              id="history-window"
              label="Metric history window"
              hint="Samples kept per service (60 ticks = 1 simulated hour)."
              control={
                <Select
                  value={String(settings.historyWindow)}
                  onValueChange={(v) => {
                    update({ historyWindow: Number(v) as 60 | 120 | 180 });
                    saved("History window");
                  }}
                >
                  <SelectTrigger id="history-window" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="60">60 ticks</SelectItem>
                    <SelectItem value="120">120 ticks</SelectItem>
                    <SelectItem value="180">180 ticks</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <Row
              id="log-cap"
              label="Log retention cap"
              hint="Maximum structured log entries kept in memory."
              control={
                <Select
                  value={String(settings.logCap)}
                  onValueChange={(v) => {
                    update({ logCap: Number(v) as 500 | 1200 | 2000 });
                    saved("Log cap");
                  }}
                >
                  <SelectTrigger id="log-cap" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="500">500</SelectItem>
                    <SelectItem value="1200">1,200</SelectItem>
                    <SelectItem value="2000">2,000</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          </CardContent>
        </Card>

        {/* Workspace */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-cyan" /> Workspace
            </CardTitle>
            <CardDescription>Labels applied across reports and headers</CardDescription>
          </CardHeader>
          <CardContent>
            <Row
              id="workspace-name"
              label="Workspace name"
              hint="Shown on generated reports."
              control={
                <Input
                  id="workspace-name"
                  value={settings.workspaceName}
                  maxLength={64}
                  onChange={(e) => update({ workspaceName: e.target.value })}
                  onBlur={() => saved("Workspace name")}
                  className="w-56"
                />
              }
            />
            <Row
              id="environment"
              label="Environment"
              hint="Display-only environment badge."
              control={
                <Select
                  value={settings.environment}
                  onValueChange={(v) => {
                    update({ environment: v as typeof settings.environment });
                    saved("Environment");
                  }}
                >
                  <SelectTrigger id="environment" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">production</SelectItem>
                    <SelectItem value="staging">staging</SelectItem>
                    <SelectItem value="development">development</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <Row
              id="timezone"
              label="Timestamp timezone"
              hint="How simulated timestamps are rendered."
              control={
                <Select
                  value={settings.timezone}
                  onValueChange={(v) => {
                    update({ timezone: v as "utc" | "local" });
                    saved("Timezone");
                  }}
                >
                  <SelectTrigger id="timezone" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="utc">UTC</SelectItem>
                    <SelectItem value="local">Browser local</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <Row
              id="density"
              label="List density"
              hint="Compact tightens table rows across the app."
              control={
                <Select
                  value={settings.density}
                  onValueChange={(v) => {
                    update({ density: v as "comfortable" | "compact" });
                    saved("Density");
                  }}
                >
                  <SelectTrigger id="density" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comfortable">Comfortable</SelectItem>
                    <SelectItem value="compact">Compact</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          </CardContent>
        </Card>

        {/* Data & reset */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4 text-warning" /> Data &amp; reset
            </CardTitle>
            <CardDescription>Export or reset the local simulation state</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel-2 px-3 py-2.5">
              <div>
                <p className="text-[13px] font-medium">Export workspace snapshot</p>
                <p className="text-[11px] text-muted-foreground">
                  Settings, incidents, recovery actions and health series (JSON).
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={exportWorkspace}>
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel-2 px-3 py-2.5">
              <div>
                <p className="text-[13px] font-medium">Reload current scenario</p>
                <p className="text-[11px] text-muted-foreground">
                  Re-runs the deterministic warm-up for {getScenario(state.scenarioId).name} from its
                  seed — discards this run&rsquo;s actions and timeline progress.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={resetScenario}>
                <RotateCcw className="h-3.5 w-3.5" /> Reload
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/6 px-3 py-2.5">
              <div>
                <p className="text-[13px] font-medium text-destructive">Reset all preferences</p>
                <p className="text-[11px] text-muted-foreground">
                  Restores default settings (does not touch simulation data).
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setResetAllOpen(true)}>
                Reset
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => loadScenario(state.scenarioId)}
                title="Loads the same scenario fresh (keeps other scenarios' incidents)"
              >
                <Sparkles className="h-3.5 w-3.5" /> Re-seed current scenario
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-4 w-4 text-info" /> About BLACKBOX
            </CardTitle>
            <CardDescription>Build &amp; engine information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs text-muted-foreground">
            <div className="flex justify-between border-b border-border/60 pb-2">
              <span>Version</span>
              <span className="font-mono text-foreground">v{APP_VERSION}</span>
            </div>
            <div className="flex justify-between border-b border-border/60 pb-2">
              <span>Engine</span>
              <span className="text-foreground">deterministic (seeded PRNG)</span>
            </div>
            <div className="flex justify-between border-b border-border/60 pb-2">
              <span>Active scenario</span>
              <span className="text-foreground">{getScenario(state.scenarioId).name}</span>
            </div>
            <div className="flex justify-between border-b border-border/60 pb-2">
              <span>Seed</span>
              <span className="font-mono text-foreground">0x{state.seed.toString(16)}</span>
            </div>
            <div className="flex justify-between border-b border-border/60 pb-2">
              <span>Simulation clock</span>
              <span className="font-mono text-foreground">T+{state.tick}</span>
            </div>
            <div className="flex justify-between">
              <span>Data layer</span>
              <span className="text-foreground">in-memory (PostgreSQL-ready, see docs/database.md)</span>
            </div>
            <p className="pt-2 leading-relaxed text-muted-foreground/80">
              Identical scenario seeds and action sequences always reproduce identical telemetry —
              useful for demos, testing runbooks and training exercises.
            </p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={resetAllOpen} onOpenChange={setResetAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset all preferences?</DialogTitle>
            <DialogDescription>
              Workspace name, timezone, density and simulation defaults return to factory values.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetAllOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                reset();
                setResetAllOpen(false);
                toast.info("Preferences reset to defaults");
              }}
            >
              Reset preferences
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <SettingsIcon className="h-3 w-3" />
        Preferences persist in localStorage (schema-validated with Zod — invalid stored values fall
        back to defaults).
      </p>
    </div>
  );
}
