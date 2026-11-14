"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Ban,
  FlaskConical,
  Gauge,
  RotateCcw,
  ShieldAlert,
  Timer,
  TrendingDown,
  TrendingUp,
  Wrench,
  Zap,
} from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { getScenario } from "@/simulation/scenarios";
import type { RecoveryActionDef, ScenarioFault } from "@/simulation/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SeriesChart } from "@/components/charts/series-chart";
import { formatMs, formatPct } from "@/lib/format";
import { cn } from "@/lib/cn";

const CATEGORY_VARIANT: Record<RecoveryActionDef<ScenarioFault>["category"], "success" | "default" | "warning"> = {
  fix: "success",
  mitigation: "default",
  experiment: "warning",
};

const RISK_TONE: Record<string, string> = {
  low: "text-success",
  medium: "text-warning",
  high: "text-destructive",
};

function Delta({ value, suffix = "", invert = false }: { value: number; suffix?: string; invert?: boolean }) {
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.05;
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 tabular text-xs font-semibold",
        flat ? "text-muted-foreground" : good ? "text-success" : "text-destructive",
      )}
    >
      {!flat && value > 0 ? <TrendingUp className="h-3 w-3" /> : null}
      {!flat && value < 0 ? <TrendingDown className="h-3 w-3" /> : null}
      {value >= 0 ? "+" : ""}
      {value.toFixed(1)}
      {suffix}
    </span>
  );
}

export default function RecoveryPage() {
  const { state, apply, rollback } = useSimulation();
  const scenario = getScenario(state.scenarioId);
  const [pending, setPending] = useState<RecoveryActionDef<ScenarioFault> | null>(null);

  const summary = scenario.faultSummary(state.fault);
  const lastActive = [...state.actions].reverse().find((a) => !a.rolledBack);
  const latest = state.actions.at(-1);

  // Health series for the chart + action markers.
  const healthData = useMemo(
    () => state.healthSeries.slice(-90).map((h) => ({ ts: h.ts, health: h.health })),
    [state.healthSeries],
  );
  const markers = useMemo(
    () =>
      state.actions
        .map((a) => {
          const point = state.healthSeries.find((h) => h.t === a.tick);
          if (!point) return null;
          return {
            x: point.ts,
            y: point.health,
            color: a.rolledBack ? "#64748b" : "#3d7dff",
            label: a.rolledBack ? "↺" : "⚡",
          };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null),
    [state.actions, state.healthSeries],
  );

  const cascading = state.fault.kind === "cascading" ? state.fault : null;
  const relapseIn =
    cascading && cascading.relapseAtTick !== null ? cascading.relapseAtTick - state.tick : null;

  const before = lastActive?.kpiBefore ?? latest?.kpiBefore;
  const after = lastActive?.kpiAfter;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recovery Simulator"
        description="Apply simulated recovery actions, watch before/after metrics move, roll back, and iterate — deterministically."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/investigate">
                <Gauge className="h-3.5 w-3.5" /> Investigation
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/incidents">
                Incident timeline <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        }
      />

      {/* Warnings */}
      {state.fault.kind === "cascading" && state.fault.gatewayFailOpen ? (
        <Alert variant="destructive">
          <AlertTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Gateway running FAIL-OPEN
          </AlertTitle>
          <AlertDescription>
            Traffic flows without token verification. This is a stopgap with a security regression —
            fix auth-service and re-enable enforcement as soon as possible.
          </AlertDescription>
        </Alert>
      ) : null}
      {relapseIn !== null && relapseIn > 0 ? (
        <Alert variant="warning">
          <AlertTitle className="flex items-center gap-2">
            <Timer className="h-4 w-4" /> Relapse scheduled in {relapseIn} tick{relapseIn === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>
            auth-service was restarted but its session cache is still unbounded — expect another
            OOM crash. Apply the cache cap (or the combined patch) to stabilise it.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Fault state */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-cyan" /> Live fault state
            </CardTitle>
            <CardDescription>Engine parameters driving the current failure</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-1.5">
            {summary.map((item) => (
              <div key={item.label} className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                <p className="mt-0.5 truncate text-[11.5px] font-medium text-foreground">{item.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Before / after */}
        <Card>
          <CardHeader>
            <CardTitle>Before / after</CardTitle>
            <CardDescription>
              {lastActive
                ? `Comparing "${lastActive.name}" at T+${lastActive.tick}`
                : "Apply an action to capture a comparison snapshot"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {before && after ? (
              <div className="space-y-2">
                <KpiRow label="Health score" before={before.health} after={after.health} suffix="%" invert />
                <KpiRow label="Error rate" before={before.errorRate * 100} after={after.errorRate * 100} suffix="%" invert />
                <KpiRow label="p95 latency" before={before.latencyP95Ms} after={after.latencyP95Ms} suffix="ms" invert />
                <KpiRow label="Availability" before={before.availability * 100} after={after.availability * 100} suffix="%" />
                <div className="flex items-center justify-between rounded-md border border-border bg-panel-2 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Down / degraded services</span>
                  <span className="tabular">
                    {before.downServices}/{before.degradedServices} →{" "}
                    <strong className={after.downServices < before.downServices ? "text-success" : undefined}>
                      {after.downServices}/{after.degradedServices}
                    </strong>
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {lastActive?.notes.at(-1)}
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  {state.tick - lastActive!.tick} tick{state.tick - lastActive!.tick === 1 ? "" : "s"} have
                  elapsed since application — the live chart below shows the ongoing effect.
                </p>
              </div>
            ) : (
              <EmptyState
                icon={<Zap className="h-5 w-5" />}
                title="No actions applied yet"
                description="Pick a recovery action from the catalogue — the engine snapshots health, error rate and latency for comparison."
                className="py-6"
              />
            )}
          </CardContent>
        </Card>

        {/* Health chart */}
        <Card className="lg:col-span-1 xl:col-span-1">
          <CardHeader>
            <CardTitle>Health over time</CardTitle>
            <CardDescription>Markers show applied actions (↺ = rolled back)</CardDescription>
          </CardHeader>
          <CardContent>
            <SeriesChart
              data={healthData}
              height={220}
              series={[{ key: "health", name: "Health", color: "#3d7dff", type: "area" }]}
              markers={markers}
              yFormatter={(v) => `${v}`}
              valueFormatters={{ health: (v) => `${v.toFixed(0)}%` }}
              reference={{ y: 88, label: "recovery target", color: "#22c55e" }}
            />
          </CardContent>
        </Card>
      </div>

      {/* Action catalogue */}
      <div>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-foreground">Recovery actions</h2>
          <p className="text-xs text-muted-foreground">
            {scenario.actions.length} actions available for {scenario.name} — every effect is
            modelled inside the deterministic engine.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {scenario.actions.map((action) => {
            const used = state.actions.filter((a) => a.actionId === action.id);
            return (
              <Card key={action.id} data-testid="action-card" className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-[13px] leading-snug">{action.name}</CardTitle>
                    <Badge variant={CATEGORY_VARIANT[action.category]} className="shrink-0 capitalize">
                      {action.category}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider">
                    <span className={cn(RISK_TONE[action.risk])}>risk: {action.risk}</span>
                    {used.length > 0 ? (
                      <span className="text-muted-foreground">· applied {used.length}×</span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-2 pt-1">
                  <p className="text-xs leading-relaxed text-muted-foreground">{action.description}</p>
                  <div className="rounded-md border border-success/30 bg-success/6 px-2.5 py-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-success">
                      Expected effect
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-foreground/85">{action.expected}</p>
                  </div>
                  {action.sideEffects ? (
                    <div className="rounded-md border border-warning/30 bg-warning/6 px-2.5 py-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-warning">
                        Side effects
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-foreground/85">{action.sideEffects}</p>
                    </div>
                  ) : null}
                  <div className="mt-auto flex gap-2 pt-1">
                    <Button size="sm" className="flex-1" onClick={() => setPending(action)}>
                      <Wrench className="h-3.5 w-3.5" /> Apply action
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/investigate`}>
                        <Gauge className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Applied history */}
      <Card>
        <CardHeader>
          <CardTitle>Applied action history</CardTitle>
          <CardDescription>
            Stack semantics — only the most recent active action can be rolled back. Re-applying is
            allowed for repeat experiments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.actions.length === 0 ? (
            <EmptyState
              icon={<Ban className="h-5 w-5" />}
              title="Nothing applied yet"
              description="Action history appears here with before/after KPIs for each experiment."
              className="py-6"
            />
          ) : (
            <div className="space-y-2">
              {[...state.actions].reverse().map((a) => {
                const delta = a.kpiAfter.health - a.kpiBefore.health;
                const isLatestActive = lastActive?.id === a.id;
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5",
                      a.rolledBack ? "border-border bg-muted/30 opacity-60" : "border-border bg-panel-2",
                    )}
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">T+{a.tick}</span>
                    <Wrench className="h-3.5 w-3.5 shrink-0 text-cyan" />
                    <span className="text-[13px] font-medium text-foreground">{a.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      health {a.kpiBefore.health} → {a.kpiAfter.health}
                    </span>
                    <Delta value={delta} suffix=" pts" invert />
                    <span className="hidden text-[11px] text-muted-foreground sm:inline">
                      err {formatPct(a.kpiBefore.errorRate, 1)} → {formatPct(a.kpiAfter.errorRate, 1)} · p95{" "}
                      {formatMs(a.kpiBefore.latencyP95Ms)} → {formatMs(a.kpiAfter.latencyP95Ms)}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {a.rolledBack ? (
                        <Badge variant="secondary">rolled back T+{a.rolledBackTick}</Badge>
                      ) : isLatestActive ? (
                        <Button size="xs" variant="outline" onClick={() => rollback(a.id)}>
                          <RotateCcw className="h-3 w-3" /> Roll back
                        </Button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          older action — roll back later ones first
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Apply confirm dialog */}
      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply “{pending?.name}”?</DialogTitle>
            <DialogDescription>
              The engine recalculates the affected system state immediately, snapshots before/after
              KPIs, and records the action on the incident timeline.
            </DialogDescription>
          </DialogHeader>
          {pending ? (
            <div className="space-y-2">
              <div className="rounded-md border border-success/30 bg-success/6 p-2.5 text-xs">
                <span className="font-semibold text-success">Expected: </span>
                <span className="text-foreground/85">{pending.expected}</span>
              </div>
              {pending.sideEffects ? (
                <div className="rounded-md border border-warning/30 bg-warning/6 p-2.5 text-xs">
                  <span className="font-semibold text-warning">Side effects: </span>
                  <span className="text-foreground/85">{pending.sideEffects}</span>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant={pending?.risk === "high" ? "destructive" : "default"}
              onClick={() => {
                if (pending) apply(pending.id);
                setPending(null);
              }}
            >
              Apply now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiRow({
  label,
  before,
  after,
  suffix,
  invert = false,
}: {
  label: string;
  before: number;
  after: number;
  suffix: string;
  invert?: boolean;
}) {
  const diff = after - before;
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-panel-2 px-3 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 tabular">
        <span className="text-muted-foreground">{before.toFixed(1)}{suffix}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <strong className="text-foreground">{after.toFixed(1)}{suffix}</strong>
        <Delta value={diff} suffix={suffix === "%" ? "pp" : suffix} invert={invert} />
      </span>
    </div>
  );
}


