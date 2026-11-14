"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Brain,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock,
  Gauge,
  LoaderCircle,
  Network,
  Play,
  Route as RouteIcon,
  ScrollText,
  Target,
} from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { getScenario } from "@/simulation/scenarios";
import { runAnalysis, buildAnalysisContext } from "@/simulation/analysis";
import type { EvidenceKind, HypothesisResult, Incident } from "@/simulation/types";
import { PageHeader } from "@/components/shared/page-header";
import { IncidentStatusBadge, SeverityBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";

const EVIDENCE_ICON: Record<EvidenceKind, React.ComponentType<{ className?: string }>> = {
  metric: Gauge,
  log: ScrollText,
  trace: RouteIcon,
  dependency: Network,
  incident: Activity,
};

function confidenceTone(v: number): { bar: string; text: string } {
  if (v >= 0.75) return { bar: "bg-success", text: "text-success" };
  if (v >= 0.45) return { bar: "bg-cyan", text: "text-cyan" };
  if (v >= 0.25) return { bar: "bg-warning", text: "text-warning" };
  return { bar: "bg-muted-foreground", text: "text-muted-foreground" };
}

interface Signal {
  key: string;
  title: string;
}

function InvestigationContent() {
  const { state, incidentOp } = useSimulation();
  const searchParams = useSearchParams();
  const router = useRouter();
  const scenario = getScenario(state.scenarioId);
  // URL is the source of truth for the selected incident (deep-linkable).
  const incidentId = searchParams.get("incident") ?? "live";
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<HypothesisResult[] | null>(null);
  const [ranAtTick, setRanAtTick] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const selectIncident = (id: string) => {
    router.replace(id === "live" ? "/investigate" : `/investigate?incident=${id}`, {
      scroll: false,
    });
  };

  const scenarioIncidents = state.incidents.filter(
    (i) => i.scenarioId === scenario.id && i.status !== "resolved",
  );
  const selectedIncident: Incident | undefined =
    incidentId === "live" ? undefined : state.incidents.find((i) => i.id === incidentId);

  const signals = useMemo<Signal[]>(() => {
    if (!results) return [];
    const map = new Map<string, Signal>();
    for (const r of results) {
      for (const m of r.matched) {
        if (!map.has(m.item.title)) map.set(m.item.title, { key: m.slot.id, title: m.item.title });
      }
    }
    return [...map.values()].slice(0, 8);
  }, [results]);

  const detectSignals = () => {
    setRunning(true);
    setResults(null);
    window.setTimeout(() => {
      setResults(runAnalysis(state, scenario));
      setRanAtTick(state.tick);
      setRunning(false);
    }, 700);
  };

  const actual = scenario.hypotheses.find((h) => h.actual);
  const stale = results && ranAtTick !== null && state.tick - ranAtTick > 5;
  const revealAnswer =
    selectedIncident?.status === "resolved" || Boolean(selectedIncident?.rootCause);

  // Live signal pulse even before analysis.
  const ctx = buildAnalysisContext(state, scenario);
  const errorLogs = ctx.countLogs({ levels: ["error", "fatal"], sinceTick: state.tick - 10 });
  const failingTraces = ctx.traceStats({ status: "error", sinceTick: state.tick - 15 });
  const unhealthy = scenario.services.filter(
    (s) => (state.services[s.id]?.status ?? "healthy") !== "healthy",
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Investigation Engine"
        description="Correlate logs, metrics, traces and service dependencies into ranked root-cause hypotheses with confidence scores and supporting evidence."
        eyebrow={
          selectedIncident ? (
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={selectedIncident.severity} />
              <IncidentStatusBadge status={selectedIncident.status} />
              <span className="font-mono text-[11px] text-muted-foreground">{selectedIncident.number}</span>
            </div>
          ) : (
            <Badge variant="secondary">Live system state</Badge>
          )
        }
        actions={
          <div className="flex items-center gap-2">
            <Select value={incidentId} onValueChange={selectIncident}>
              <SelectTrigger className="w-64" aria-label="Select incident context">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">Live system state</SelectItem>
                {scenarioIncidents.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.number} — {i.title.slice(0, 40)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={detectSignals} disabled={running}>
              {running ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" /> Correlating…
                </>
              ) : results ? (
                <>
                  <Brain className="h-4 w-4" /> Re-run analysis
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" /> Run correlation analysis
                </>
              )}
            </Button>
          </div>
        }
      />

      {/* Live pulse strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <PulseStat
          label="Unhealthy services"
          value={`${unhealthy.length} / ${scenario.services.length}`}
          tone={unhealthy.length > 0 ? "text-warning" : "text-success"}
          icon={<Network className="h-3.5 w-3.5" />}
        />
        <PulseStat
          label="Error logs (10 ticks)"
          value={String(errorLogs)}
          tone={errorLogs > 20 ? "text-destructive" : "text-muted-foreground"}
          icon={<ScrollText className="h-3.5 w-3.5" />}
        />
        <PulseStat
          label="Failing traces (15 ticks)"
          value={`${Math.round(failingTraces.errorPct * 100)}% of ${failingTraces.total}`}
          tone={failingTraces.errorPct > 0.2 ? "text-destructive" : "text-muted-foreground"}
          icon={<RouteIcon className="h-3.5 w-3.5" />}
        />
        <PulseStat
          label="Context"
          value={selectedIncident ? selectedIncident.number : `T+${state.tick} live`}
          tone="text-primary"
          icon={<Target className="h-3.5 w-3.5" />}
        />
      </div>

      {running ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-3 h-2 w-full" />
              <Skeleton className="mt-4 h-3 w-full" />
              <Skeleton className="mt-1.5 h-3 w-4/5" />
            </Card>
          ))}
        </div>
      ) : results ? (
        <>
          {stale ? (
            <p className="text-xs text-warning">
              Analysis is from T+{ranAtTick} — the simulation has advanced. Re-run for fresh
              evidence.
            </p>
          ) : null}

          {/* Detected signals */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan" /> Detected signals
              </CardTitle>
              <CardDescription>
                {signals.length} unique signals matched across hypotheses at T+{ranAtTick}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {signals.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No anomalous signals detected — the system looks healthy.
                </p>
              ) : (
                signals.map((s) => (
                  <span
                    key={s.key}
                    className="rounded-md border border-cyan/35 bg-cyan/8 px-2 py-1 text-[11px] text-cyan"
                  >
                    {s.title}
                  </span>
                ))
              )}
            </CardContent>
          </Card>

          {/* Hypotheses */}
          <div className="grid gap-3 lg:grid-cols-2">
            {results.map((h, i) => {
              const tone = confidenceTone(h.confidence);
              const isChosen = selectedIncident?.rootCause?.hypothesisId === h.id;
              const revealAnswer = selectedIncident?.status === "resolved";
              const isOpen = expanded === h.id;
              return (
                <Card
                  key={h.id}
                  data-testid="hypothesis-card"
                  data-rank={i}
                  data-hypothesis={h.id}
                  className={cn(
                    "flex flex-col",
                    isChosen && "border-primary/60",
                    revealAnswer && h.actual && "border-success/60",
                  )}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold",
                            i === 0 ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground",
                          )}
                        >
                          {i + 1}
                        </span>
                        <div>
                          <CardTitle className="text-[13.5px] leading-snug">{h.title}</CardTitle>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary">{h.category}</Badge>
                            {isChosen ? <Badge variant="default">Your RC</Badge> : null}
                            {revealAnswer && h.actual ? (
                              <Badge variant="success">
                                <CircleCheck className="h-3 w-3" /> Actual root cause
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={cn("kpi-value text-xl font-bold", tone.text)}>
                          {Math.round(h.confidence * 100)}%
                        </p>
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                          confidence
                        </p>
                      </div>
                    </div>
                    <div className="mt-1">
                      <Progress value={h.confidence * 100} indicatorClassName={tone.bar} />
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">{h.summary}</p>

                    <div className="rounded-md border border-border bg-panel-2 p-2.5">
                      <p className="text-[11px] font-medium text-foreground">{h.explanation}</p>
                    </div>

                    {/* Evidence */}
                    <div className="space-y-1.5">
                      {h.matched.map(({ slot, item }) => {
                        const Icon = EVIDENCE_ICON[item.kind];
                        return (
                          <Link
                            key={slot.id}
                            href={item.href}
                            className="group flex items-start gap-2 rounded-md border border-border px-2.5 py-1.5 transition-colors hover:border-primary/60 hover:bg-accent/40"
                          >
                            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[11.5px] font-medium text-foreground group-hover:text-primary">
                                {item.title}
                              </span>
                              <span className="block text-[10.5px] leading-snug text-muted-foreground">
                                {item.detail}
                              </span>
                            </span>
                            <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                          </Link>
                        );
                      })}
                      {h.missing.map((slot) => (
                        <div
                          key={slot.id}
                          className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 opacity-50"
                        >
                          <CircleX className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground">
                            Missing signal — {slot.id.replace(/-/g, " ")} (weight {slot.weight})
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Why relevant */}
                    <button
                      type="button"
                      className="flex w-full items-center gap-1 text-left text-[11px] font-medium text-primary hover:underline"
                      onClick={() => setExpanded(isOpen ? null : h.id)}
                    >
                      Why is this hypothesis relevant?
                      <ChevronDown className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")} />
                    </button>
                    {isOpen ? (
                      <p className="text-[11.5px] leading-relaxed text-muted-foreground">{h.whyRelevant}</p>
                    ) : null}

                    {selectedIncident ? (
                      <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
                        <span className="text-[10px] text-muted-foreground">
                          {isChosen
                            ? `Recorded on ${selectedIncident.number}`
                            : h.matched.length === 0
                              ? "Unsupported by current evidence"
                              : `${h.matched.length}/${h.matched.length + h.missing.length} signals present`}
                        </span>
                        <Button
                          size="xs"
                          variant={isChosen ? "outline" : "default"}
                          disabled={isChosen || selectedIncident.status === "resolved"}
                          onClick={() => {
                            incidentOp(selectedIncident.id, {
                              op: "rootCause",
                              hypothesisId: h.id,
                              title: h.title,
                              confidence: h.confidence,
                            });
                            if (selectedIncident.status === "triggered") {
                              incidentOp(selectedIncident.id, { op: "investigate" });
                            }
                          }}
                        >
                          {isChosen ? "Recorded ✓" : "Set as root cause"}
                        </Button>
                      </div>
                    ) : (
                      <div className="border-t border-border pt-2.5 text-[10.5px] text-muted-foreground">
                        Select an incident to record a root cause.
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {selectedIncident?.rootCause && selectedIncident.status !== "resolved" ? (
            <Card className="border-primary/50">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-2 text-sm">
                  <Target className="h-4 w-4 text-primary" />
                  <span>
                    Root cause on {selectedIncident.number}:{" "}
                    <strong>{selectedIncident.rootCause.title}</strong>
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/incidents/${selectedIncident.id}`}>Open incident</Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link href="/recovery">
                      Try recovery actions <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {revealAnswer && selectedIncident?.rootCause && actual ? (
            <Card
              className={cn(
                selectedIncident.rootCause.hypothesisId === actual.id
                  ? "border-success/60"
                  : "border-destructive/60",
              )}
            >
              <CardContent className="flex items-center gap-3 p-4 text-sm">
                {selectedIncident.rootCause.hypothesisId === actual.id ? (
                  <>
                    <CircleCheck className="h-4 w-4 text-success" />
                    <span>
                      Verified: your root cause matches the planted cause — the outcome is saved in
                      Reports.
                    </span>
                  </>
                ) : (
                  <>
                    <CircleX className="h-4 w-4 text-destructive" />
                    <span>
                      Refuted: the actual cause was <strong>{actual.title}</strong>. Review the
                      evidence you weighted too lightly.
                    </span>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={<Brain className="h-5 w-5" />}
          title="No analysis yet"
          description="Run correlation analysis to score every hypothesis against the live telemetry. The engine weighs evidence slots — pool saturation, failing spans, dependency health, log signatures — and produces a deterministic confidence ranking."
          action={
            <Button onClick={detectSignals}>
              <Play className="h-4 w-4" /> Run correlation analysis
            </Button>
          }
        />
      )}

      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <Clock className="mt-0.5 h-3 w-3 shrink-0" />
        Scoring is deterministic: confidence = base prior + evidence weight actually present in the
        current window. Identical telemetry always produces identical rankings — re-run at any tick
        to verify.
      </p>
    </div>
  );
}

function PulseStat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {icon} {label}
        </span>
        <span className={cn("kpi-value text-sm font-semibold", tone)}>{value}</span>
      </div>
    </Card>
  );
}

export default function InvestigatePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <InvestigationContent />
    </Suspense>
  );
}
