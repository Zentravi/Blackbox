"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Clock, ScrollText, Users } from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { useSettings } from "@/state/settings-context";
import { getScenario } from "@/simulation/scenarios";
import { downstreamOf, upstreamOf } from "@/data/selectors";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge, StatusDot } from "@/components/shared/badges";
import { SeriesChart } from "@/components/charts/series-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatMs, formatPct, formatRps } from "@/lib/format";
import { STATUS_COLORS } from "@/lib/constants";

type Range = "60" | "120" | "all";

export default function ServiceDetailPage() {
  const params = useParams<{ id: string }>();
  const { state } = useSimulation();
  const { settings } = useSettings();
  const scenario = getScenario(state.scenarioId);
  const [range, setRange] = useState<Range>("60");

  const def = scenario.services.find((s) => s.id === params.id);
  const runtime = state.services[params.id];

  const series = state.metrics[params.id] ?? [];
  const slice = range === "all" ? series : series.slice(-Number(range));

  const chartData = slice.map((s) => ({
    ts: s.ts,
    cpu: s.cpuPct,
    mem: s.memPct,
    p95: s.latencyP95Ms,
    base: def?.baseline.latencyP95Ms ?? 0,
    errPct: s.errorRate * 100,
    rps: s.rps,
    sat: s.saturation * 100,
  }));

  const logs = state.logs.filter((l) => l.serviceId === params.id).slice(-6).reverse();
  const traces = state.traces
    .filter((t) => t.spans.some((sp) => sp.serviceId === params.id))
    .slice(-5)
    .reverse();

  if (!def || !runtime) notFound();

  const upstream = upstreamOf(scenario, def.id);
  const downstream = downstreamOf(scenario, def.id);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button asChild variant="ghost" size="xs">
          <Link href="/services">
            <ArrowLeft className="h-3 w-3" /> Service Monitor
          </Link>
        </Button>
        <span>/</span>
        <span className="text-foreground">{def.name}</span>
      </div>

      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <HealthBadge status={runtime.status} />
            <Badge variant="secondary" className="capitalize">
              {def.kind}
            </Badge>
            <Badge variant="outline">{def.runtime}</Badge>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Users className="h-3 w-3" /> {def.team}
            </span>
          </div>
        }
        title={def.name}
        description={def.description}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/logs?service=${def.id}`}>
              <ScrollText className="h-3.5 w-3.5" /> View logs
            </Link>
          </Button>
        }
      />

      {/* Current stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          { label: "CPU", value: `${runtime.current.cpuPct.toFixed(0)}%` },
          { label: "Memory", value: `${runtime.current.memPct.toFixed(0)}%` },
          { label: "p95 latency", value: formatMs(runtime.current.latencyP95Ms) },
          { label: "Error rate", value: formatPct(runtime.current.errorRate, 2) },
          { label: "Traffic", value: formatRps(runtime.current.rps) },
          { label: "Availability", value: formatPct(runtime.availability, 2) },
        ].map((s) => (
          <Card key={s.label} className="p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {s.label}
            </p>
            <p className="kpi-value mt-1 text-base font-semibold">{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Metric charts */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Historical metrics</CardTitle>
            <CardDescription>
              Deterministic samples · baseline p95 {formatMs(def.baseline.latencyP95Ms)} · SLO{" "}
              {(def.slo * 100).toFixed(2)}%
            </CardDescription>
          </div>
          <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
            <TabsList>
              <TabsTrigger value="60">60 ticks</TabsTrigger>
              <TabsTrigger value="120">120 ticks</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">CPU &amp; memory (%)</p>
            <SeriesChart
              data={chartData}
              height={190}
              showLegend
              series={[
                { key: "cpu", name: "CPU %", color: "#3d7dff", type: "area" },
                { key: "mem", name: "Memory %", color: "#a78bfa", type: "area" },
              ]}
              yFormatter={(v) => `${v}%`}
              valueFormatters={{ cpu: (v) => `${v.toFixed(1)}%`, mem: (v) => `${v.toFixed(1)}%` }}
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Latency p95 (ms)</p>
            <SeriesChart
              data={chartData}
              height={190}
              showLegend
              series={[
                { key: "p95", name: "p95 ms", color: "#22d3ee", type: "area" },
                { key: "base", name: "baseline", color: "#64748b", dash: true },
              ]}
              yFormatter={(v) => `${v}ms`}
              valueFormatters={{ p95: (v) => formatMs(v) }}
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Error rate (%)</p>
            <SeriesChart
              data={chartData}
              height={190}
              series={[
                { key: "errPct", name: "Errors %", color: "#ef4444", type: "area" },
              ]}
              yFormatter={(v) => `${v}%`}
              valueFormatters={{ errPct: (v) => `${v.toFixed(2)}%` }}
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Traffic (rps) &amp; saturation (%)
            </p>
            <SeriesChart
              data={chartData}
              height={190}
              showLegend
              series={[
                { key: "rps", name: "rps", color: "#22c55e", axis: "left" },
                { key: "sat", name: "Saturation %", color: "#f59e0b", axis: "right", dash: true },
              ]}
              yFormatter={(v) => `${v}`}
              rightFormatter={(v) => `${v}%`}
              valueFormatters={{ rps: (v) => formatRps(v), sat: (v) => `${v.toFixed(0)}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Dependencies */}
        <Card>
          <CardHeader>
            <CardTitle>Dependencies</CardTitle>
            <CardDescription>Position in the active topology</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Upstream (calls this service)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {upstream.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Edge of the graph</span>
                ) : (
                  upstream.map((u) => (
                    <Link key={u.id} href={`/services/${u.id}`}>
                      <Badge variant="secondary" className="hover:border-primary/60 hover:text-primary">
                        {u.name}
                      </Badge>
                    </Link>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Downstream (this service calls)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {downstream.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Terminal node</span>
                ) : (
                  downstream.map((d) => (
                    <Link key={d.id} href={`/services/${d.id}`}>
                      <Badge variant="outline" className="hover:border-primary/60 hover:text-primary">
                        {d.name}
                      </Badge>
                    </Link>
                  ))
                )}
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href={`/dependencies?focus=${def.id}`}>
                Locate on dependency map <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Recent logs */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Recent logs</CardTitle>
              <CardDescription>Latest entries for this service</CardDescription>
            </div>
            <Button asChild variant="ghost" size="xs">
              <Link href={`/logs?service=${def.id}`}>Open explorer</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {logs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No logs in the current window.</p>
            ) : (
              logs.map((l) => (
                <div key={l.id} className="rounded-md border border-border bg-terminal px-2.5 py-1.5">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">{formatDateTime(l.ts, settings.timezone)}</span>
                    <span
                      className={
                        l.level === "error" || l.level === "fatal"
                          ? "font-semibold text-destructive"
                          : l.level === "warn"
                            ? "text-warning"
                            : "text-info"
                      }
                    >
                      {l.level.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 break-all font-mono text-[11px] leading-snug text-foreground/90">
                    {l.message}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent traces */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Recent traces</CardTitle>
              <CardDescription>Requests touching this service</CardDescription>
            </div>
            <Button asChild variant="ghost" size="xs">
              <Link href={`/traces?service=${def.id}`}>Open traces</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {traces.length === 0 ? (
              <p className="text-xs text-muted-foreground">No sampled traces in the window.</p>
            ) : (
              traces.map((t) => (
                <Link
                  key={t.id}
                  href={`/traces/${t.id}`}
                  className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 transition-colors hover:border-primary/50"
                >
                  <StatusDot
                    status={t.status === "ok" ? "healthy" : t.status === "timeout" ? "critical" : "degraded"}
                  />
                  <span className="font-mono text-[11px] text-foreground">{t.id}</span>
                  <span className="ml-auto flex items-center gap-1.5 text-[11px] tabular text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatMs(t.durationMs)}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <Sparkline
          data={series.slice(-90).map((s) => s.latencyP95Ms)}
          color={STATUS_COLORS[runtime.status]}
          height={40}
          className="max-w-md"
        />
        <span className="text-[11px] text-muted-foreground">
          Last updated T+{state.tick} · {formatDateTime(state.simTimeMs, settings.timezone)}
        </span>
      </div>
    </div>
  );
}
