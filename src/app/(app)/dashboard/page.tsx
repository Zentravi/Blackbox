"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Brain,
  FileText,
  Gauge,
  Siren,
  TrendingDown,
  TrendingUp,
  Wrench,
  Zap,
} from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { useSettings } from "@/state/settings-context";
import { getScenario, SCENARIO_LIST } from "@/simulation/scenarios";
import {
  activeIncidents,
  aggregateSeries,
  serviceRows,
  statusCounts,
} from "@/data/selectors";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { HealthBadge, SeverityBadge, StatusDot } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { SeriesChart } from "@/components/charts/series-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { HealthGauge } from "@/components/dashboard/health-gauge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatClock, formatMs, formatPct, formatTickDuration } from "@/lib/format";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { STATUS_COLORS } from "@/lib/constants";

const ACTIVITY_STYLE: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  incident: { icon: Siren, color: "#ef4444" },
  action: { icon: Wrench, color: "#38bdf8" },
  scenario: { icon: Zap, color: "#a78bfa" },
  system: { icon: Activity, color: "#f59e0b" },
};

export default function DashboardPage() {
  const { state, loadScenario } = useSimulation();
  const { settings } = useSettings();
  const [pendingScenario, setPendingScenario] = useState<string | null>(null);

  const scenario = getScenario(state.scenarioId);
  const rows = useMemo(() => serviceRows(state, scenario), [state, scenario]);
  const agg = useMemo(() => aggregateSeries(state, scenario, 60), [state, scenario]);
  const open = activeIncidents(state, scenario.id);
  const counts = statusCounts(rows);

  const last = agg.at(-1);
  const prev = agg.at(-11);
  const err = last?.errorRate ?? 0;
  const prevErr = prev?.errorRate ?? err;
  const p95 = last?.latencyP95Ms ?? 0;
  const prevP95 = prev?.latencyP95Ms ?? p95;

  const chartData = agg.map((p) => ({ ts: p.ts, errPct: p.errorRate * 100, p95: p.latencyP95Ms }));

  const sevCount = (sev: string) => open.filter((i) => i.severity === sev).length;
  const availability =
    rows.reduce((a, r) => a + r.runtime.availability, 0) / Math.max(1, rows.length);

  const sortedRows = [...rows].sort((a, b) => {
    const order = { down: 0, critical: 1, degraded: 2, healthy: 3 } as const;
    return order[a.runtime.status] - order[b.runtime.status];
  });

  const recentIncidents = [...state.incidents]
    .filter((i) => i.scenarioId === scenario.id)
    .sort((a, b) => b.openedTick - a.openedTick)
    .slice(0, 4);

  const activity = [...state.activity].reverse().slice(0, 9);

  return (
    <div className="space-y-5">
      <PageHeader
        title="System health"
        description={`${scenario.name} — live deterministic simulation of the production workspace.`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/investigate">
                <Brain className="h-3.5 w-3.5" />
                Investigate
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/recovery">
                <Wrench className="h-3.5 w-3.5" />
                Recovery simulator
              </Link>
            </Button>
          </>
        }
      />

      {/* KPI row */}
      <motion.div
        className="grid grid-cols-2 gap-3 xl:grid-cols-5"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={staggerItem} className="col-span-2 xl:col-span-1">
          <Card>
            <CardContent className="flex items-center justify-center p-4">
              <HealthGauge value={state.health} />
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={staggerItem}>
<KpiCard
          label="Active incidents"
          value={open.length}
          sub={
            open.length > 0
              ? `${sevCount("sev1")} SEV1 · ${sevCount("sev2")} SEV2`
              : "all clear"
          }
          trendTone={open.length > 0 ? "bad" : "good"}
          icon={<Siren className="h-4 w-4" />}
        />
        </motion.div>
        <motion.div variants={staggerItem}>
<KpiCard
          label="Error rate"
          value={formatPct(err, 2)}
          sub={
            <>
              {err > prevErr + 0.0005 ? <TrendingUp className="mr-0.5 inline h-3 w-3" /> : null}
              {err < prevErr - 0.0005 ? <TrendingDown className="mr-0.5 inline h-3 w-3" /> : null}
              {((err - prevErr) * 100).toFixed(2)}pp
            </>
          }
          trendTone={err > prevErr ? "bad" : "good"}
          icon={<Activity className="h-4 w-4" />}
        >
          <Sparkline data={chartData.map((d) => d.errPct)} color="#ef4444" height={28} />
        </KpiCard>
        </motion.div>
        <motion.div variants={staggerItem}>
<KpiCard
          label="Latency p95"
          value={formatMs(p95)}
          sub={`${p95 - prevP95 >= 0 ? "+" : ""}${Math.round(p95 - prevP95)}ms`}
          trendTone={p95 > prevP95 * 1.05 ? "bad" : "good"}
          icon={<Gauge className="h-4 w-4" />}
        >
          <Sparkline data={chartData.map((d) => d.p95)} color="#22d3ee" height={28} />
        </KpiCard>
        </motion.div>
        <motion.div variants={staggerItem}>
<KpiCard
          label="Availability"
          value={formatPct(availability, 2)}
          sub={`${counts.down} down · ${counts.degraded + counts.critical} degraded`}
          trendTone={counts.down > 0 ? "bad" : "good"}
          icon={<Zap className="h-4 w-4" />}
        />
        </motion.div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Error rate &amp; latency</CardTitle>
                <CardDescription>Weighted across all services · last 60 ticks</CardDescription>
              </div>
              <Badge variant="secondary" className="font-mono">
                T+{state.tick}
              </Badge>
            </CardHeader>
            <CardContent>
              <SeriesChart
                data={chartData}
                height={240}
                showLegend
                series={[
                  { key: "errPct", name: "Error rate (%)", color: "#ef4444", type: "area" },
                  { key: "p95", name: "p95 latency (ms)", color: "#22d3ee", axis: "right", dash: true },
                ]}
                yFormatter={(v) => `${v}%`}
                rightFormatter={(v) => `${v}ms`}
                valueFormatters={{
                  errPct: (v) => `${v.toFixed(2)}%`,
                  p95: (v) => formatMs(v),
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Service availability</CardTitle>
                <CardDescription>Rolling success rate over the last 10 ticks</CardDescription>
              </div>
              <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                <Link href="/services">
                  View monitor <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-1 p-3">
              {sortedRows.map((r) => (
                <Link
                  key={r.def.id}
                  href={`/services/${r.def.id}`}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50"
                >
                  <StatusDot status={r.runtime.status} pulse />
                  <span className="w-40 shrink-0 truncate text-[13px] font-medium text-foreground">
                    {r.def.name}
                  </span>
                  <span className="hidden w-20 shrink-0 text-[11px] text-muted-foreground sm:block">
                    {r.def.kind}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Sparkline
                      data={r.spark}
                      color={STATUS_COLORS[r.runtime.status]}
                      height={24}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs tabular text-muted-foreground">
                    {formatPct(r.runtime.availability, 2)}
                  </span>
                  <div className="hidden w-24 shrink-0 justify-end md:flex">
                    <HealthBadge status={r.runtime.status} />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Active incidents</CardTitle>
              <Button asChild variant="ghost" size="xs">
                <Link href="/incidents">View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {open.length === 0 ? (
                <EmptyState
                  icon={<Siren className="h-5 w-5" />}
                  title="No active incidents"
                  description="The current scenario has not triggered, or everything is resolved."
                  className="py-6"
                />
              ) : (
                open.map((inc) => (
                  <Link
                    key={inc.id}
                    href={`/incidents/${inc.id}`}
                    className="block rounded-lg border border-border bg-panel-2 p-3 transition-colors hover:border-primary/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <SeverityBadge severity={inc.severity} />
                      <span className="font-mono text-[10px] text-muted-foreground">{inc.number}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
                      {inc.title}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>opened T+{inc.openedTick} · {formatTickDuration(state.tick - inc.openedTick)} ago</span>
                      <span className="text-primary">Investigate →</span>
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Incident &amp; operator events across the simulation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-0">
              {activity.map((a) => {
                const style = ACTIVITY_STYLE[a.kind] ?? ACTIVITY_STYLE.system;
                const Icon = style.icon;
                return (
                  <div key={a.id} className="relative flex gap-3 pb-3 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
                        style={{ borderColor: `${style.color}44`, backgroundColor: `${style.color}14` }}
                      >
                        <Icon className="h-3 w-3" />
                      </span>
                      <span className="mt-1 w-px flex-1 bg-border" />
                    </div>
                    <div className="min-w-0 pb-1">
                      <p className="text-xs leading-snug text-foreground">
                        {a.href ? (
                          <Link href={a.href} className="hover:text-primary hover:underline">
                            {a.message}
                          </Link>
                        ) : (
                          a.message
                        )}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        T+{a.tick} · {formatClock(a.ts, settings.timezone, false)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scenario history</CardTitle>
              <CardDescription>Latest incidents in this workspace</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {recentIncidents.map((inc) => (
                <Link
                  key={inc.id}
                  href={`/incidents/${inc.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent/50"
                >
                  <SeverityBadge severity={inc.severity} />
                  <span className="truncate text-foreground">{inc.title}</span>
                  <span
                    className={cn(
                      "ml-auto shrink-0 text-[10px] font-medium",
                      inc.status === "resolved" ? "text-success" : "text-warning",
                    )}
                  >
                    {inc.status}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Scenario launcher */}
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Simulation scenarios</h2>
            <p className="text-xs text-muted-foreground">
              Each scenario is fully deterministic — identical actions produce identical outcomes.
            </p>
          </div>
          <Button asChild variant="ghost" size="xs">
            <Link href="/reports">
              <FileText className="h-3 w-3" /> Reports
            </Link>
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {SCENARIO_LIST.map((s) => {
            const active = s.id === scenario.id;
            return (
              <Card key={s.id} className={cn(active && "border-primary/60 glow-primary")}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-[13px]">{s.name}</CardTitle>
                    {active ? <Badge variant="default">ACTIVE</Badge> : null}
                  </div>
                  <CardDescription className="line-clamp-2">{s.tagline}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-2 pt-1">
                  <Badge variant="secondary" className="capitalize">
                    {s.difficulty}
                  </Badge>
                  {active ? (
                    <Button asChild variant="outline" size="xs">
                      <Link href="/dependencies">Open map</Link>
                    </Button>
                  ) : (
                    <Button size="xs" onClick={() => setPendingScenario(s.id)}>
                      Load scenario
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Scenario switch confirm */}
      <Dialog open={pendingScenario !== null} onOpenChange={(o) => !o && setPendingScenario(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load {pendingScenario ? getScenario(pendingScenario as never).name : ""}?</DialogTitle>
            <DialogDescription>
              Current run progress (health {state.health}%, {state.actions.filter((a) => !a.rolledBack).length}{" "}
              recovery action{state.actions.filter((a) => !a.rolledBack).length === 1 ? "" : "s"}) stays in
              Reports; the new scenario replaces the live simulation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingScenario(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (pendingScenario) loadScenario(pendingScenario as never);
                setPendingScenario(null);
              }}
            >
              Load scenario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
