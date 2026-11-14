"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  CircleCheck,
  Network,
  Play,
  Route,
  ScrollText,
  Search,
  Wrench,
} from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { useSettings } from "@/state/settings-context";
import { getScenario, SCENARIO_LIST } from "@/simulation/scenarios";
import { incidentById } from "@/data/selectors";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge, IncidentStatusBadge, SeverityBadge, StatusDot } from "@/components/shared/badges";
import { IncidentTimeline } from "@/components/incidents/timeline";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { formatDateTime, formatTickDuration } from "@/lib/format";
import { cn } from "@/lib/cn";

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const { state, incidentOp } = useSimulation();
  const { settings } = useSettings();
  const incident = incidentById(state, params.id);
  const [note, setNote] = useState("");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolution, setResolution] = useState("");

  if (!incident) notFound();

  const scenario = getScenario(incident.scenarioId);
  const isActiveScenario = incident.scenarioId === state.scenarioId;
  const actualHypothesis = scenario.hypotheses.find((h) => h.actual);
  const isResolved = incident.status === "resolved";
  const duration = (incident.resolvedTick ?? state.tick) - incident.openedTick;
  const scenarioMeta = SCENARIO_LIST.find((s) => s.id === incident.scenarioId);

  const relatedActions = isActiveScenario ? state.actions : [];
  const evidenceService = incident.serviceIds[0];

  const verified =
    isResolved && incident.rootCause && actualHypothesis
      ? incident.rootCause.hypothesisId === actualHypothesis.id
      : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button asChild variant="ghost" size="xs">
          <Link href="/incidents">
            <ArrowLeft className="h-3 w-3" /> Incident Center
          </Link>
        </Button>
        <span>/</span>
        <span className="font-mono text-foreground">{incident.number}</span>
      </div>

      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={incident.severity} />
            <IncidentStatusBadge status={incident.status} />
            <Badge variant="outline" className="font-mono">
              {incident.number}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {scenarioMeta?.name ?? incident.scenarioId}
            </span>
          </div>
        }
        title={incident.title}
        description={incident.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {incident.status === "triggered" ? (
              <Button size="sm" onClick={() => incidentOp(incident.id, { op: "ack" })}>
                <Check className="h-3.5 w-3.5" /> Acknowledge
              </Button>
            ) : null}
            {incident.status === "acknowledged" || incident.status === "triggered" ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => incidentOp(incident.id, { op: "investigate" })}
              >
                <Search className="h-3.5 w-3.5" /> Start investigation
              </Button>
            ) : null}
            {incident.status === "investigating" ? (
              <Button variant="secondary" size="sm" disabled>
                <Search className="h-3.5 w-3.5" /> Investigating
              </Button>
            ) : null}
            {!isResolved ? (
              <Button variant="outline" size="sm" onClick={() => setResolveOpen(true)}>
                <CircleCheck className="h-3.5 w-3.5" /> Resolve
              </Button>
            ) : null}
            <Button asChild size="sm" variant={isActiveScenario ? "default" : "secondary"}>
              <Link href={`/investigate?incident=${incident.id}`}>
                <Brain className="h-3.5 w-3.5" /> Investigate
              </Link>
            </Button>
          </div>
        }
      />

      {isResolved ? (
        <Alert variant="success">
          <AlertTitle className="flex items-center gap-2">
            <CircleCheck className="h-4 w-4" /> Incident resolved · {formatTickDuration(duration)}
          </AlertTitle>
          <AlertDescription>{incident.resolution}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-4 lg:col-span-2">
          {/* Impacted services */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Affected services</CardTitle>
                <CardDescription>
                  Opened T+{incident.openedTick} ·{" "}
                  {formatDateTime(incident.openedTs, settings.timezone)} · duration{" "}
                  {formatTickDuration(duration)}
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="xs">
                <Link href={`/dependencies?focus=${evidenceService}`}>
                  <Network className="h-3 w-3" /> Map
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {incident.serviceIds.map((sid) => {
                const def = scenario.services.find((s) => s.id === sid);
                const rt = state.services[sid];
                return (
                  <Link
                    key={sid}
                    href={def ? `/services/${sid}` : "#"}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border border-border bg-panel-2 px-3 py-2 transition-colors hover:border-primary/60",
                      !def && "pointer-events-none opacity-60",
                    )}
                  >
                    {rt ? <StatusDot status={rt.status} pulse /> : null}
                    <span className="text-[13px] font-medium">{def?.name ?? sid}</span>
                    {rt ? <HealthBadge status={rt.status} /> : null}
                  </Link>
                );
              })}
            </CardContent>
          </Card>

          {/* Root cause */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Root cause analysis</CardTitle>
                <CardDescription>Recorded hypothesis from the Investigation Engine</CardDescription>
              </div>
              <Button asChild variant="outline" size="xs">
                <Link href={`/investigate?incident=${incident.id}`}>
                  <Brain className="h-3 w-3" /> Open engine
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {incident.rootCause ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="cyan">RC</Badge>
                    <span className="text-sm font-semibold text-foreground">
                      {incident.rootCause.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(incident.rootCause.confidence * 100)}% confidence · set by{" "}
                      {incident.rootCause.setBy} at T+{incident.rootCause.atTick}
                    </span>
                  </div>
                  {verified !== null ? (
                    <Alert variant={verified ? "success" : "destructive"}>
                      <AlertTitle>
                        {verified
                          ? "Confirmed — this matches the actual scenario root cause."
                          : `Refuted — the actual root cause was “${actualHypothesis?.title}”.`}
                      </AlertTitle>
                      <AlertDescription>
                        {verified
                          ? "Your evidence chain matched the planted cause. The outcome is recorded in Reports."
                          : "Compare the evidence you used against the signals the engine found, then update your hypothesis."}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-xs text-muted-foreground">
                    No root cause recorded yet. Run a correlation analysis to rank hypotheses
                    against live logs, metrics, traces and dependencies.
                  </p>
                  <Button asChild size="sm">
                    <Link href={`/investigate?incident=${incident.id}`}>
                      <Play className="h-3.5 w-3.5" /> Run investigation
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Evidence shortcuts */}
          <Card>
            <CardHeader>
              <CardTitle>Evidence</CardTitle>
              <CardDescription>Telemetry correlated with this incident</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/logs?service=${evidenceService}&level=error`}>
                  <ScrollText className="h-3.5 w-3.5" /> Error logs
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/traces?status=error&service=${evidenceService}`}>
                  <Route className="h-3.5 w-3.5" /> Failing traces
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/services/${evidenceService}`}>
                  <ArrowRight className="h-3.5 w-3.5" /> Service metrics
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/recovery">
                  <Wrench className="h-3.5 w-3.5" /> Recovery simulator
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Recovery actions taken */}
          {relatedActions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Recovery actions in this run</CardTitle>
                <CardDescription>Applied after the incident opened (if any)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {relatedActions.map((a) => {
                  const delta = a.kpiAfter.health - a.kpiBefore.health;
                  const afterIncident = a.tick >= incident.openedTick;
                  return (
                    <div
                      key={a.id}
                      className={cn(
                        "flex flex-wrap items-center gap-2 rounded-md border border-border bg-panel-2 px-3 py-2 text-xs",
                        !afterIncident && "opacity-50",
                      )}
                    >
                      <Wrench className="h-3.5 w-3.5 text-cyan" />
                      <span className="font-medium text-foreground">{a.name}</span>
                      <span className="text-muted-foreground">T+{a.tick}</span>
                      <span
                        className={cn(
                          "ml-auto tabular font-semibold",
                          delta > 0.05 ? "text-success" : delta < -0.05 ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {delta >= 0 ? "+" : ""}
                        {delta.toFixed(1)} health
                      </span>
                      {a.rolledBack ? <Badge variant="warning">rolled back</Badge> : null}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {/* Add note */}
          {!isResolved ? (
            <Card>
              <CardHeader>
                <CardTitle>Add timeline note</CardTitle>
                <CardDescription>Notes are recorded on the incident timeline (actor: you)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Paged the DBA on-call; pool wait timeout rate confirmed at 42/s…"
                  aria-label="Timeline note"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!note.trim()}
                    onClick={() => {
                      incidentOp(incident.id, { op: "note", message: note });
                      setNote("");
                    }}
                  >
                    Add note
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Timeline column */}
        <Card className="lg:sticky lg:top-[4.5rem] lg:self-start">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>{incident.timeline.length} events · newest last</CardDescription>
          </CardHeader>
          <CardContent>
            <Separator className="mb-4" />
            <IncidentTimeline events={incident.timeline} />
          </CardContent>
        </Card>
      </div>

      {/* Resolve dialog */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve {incident.number}?</DialogTitle>
            <DialogDescription>
              Record the outcome. Resolution notes appear in Reports and the incident timeline.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="What fixed it? e.g. Pool resized to 400; p95 recovered to 190ms; verified for 10 minutes."
            aria-label="Resolution notes"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="success"
              onClick={() => {
                incidentOp(incident.id, { op: "resolve", resolution });
                setResolution("");
                setResolveOpen(false);
              }}
            >
              Mark resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
