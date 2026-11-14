"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { ArrowLeft, Check, CircleX, Download, Printer, Target } from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { useSettings } from "@/state/settings-context";
import { PageHeader } from "@/components/shared/page-header";
import { IncidentStatusBadge, SeverityBadge } from "@/components/shared/badges";
import { IncidentTimeline } from "@/components/incidents/timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { buildReport, reportToJson, reportToMarkdown } from "@/lib/report-format";
import { downloadTextFile } from "@/lib/export";
import { formatDateTime, formatMs, formatPct, formatTickDuration } from "@/lib/format";
import { cn } from "@/lib/cn";

export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const { state } = useSimulation();
  const { settings } = useSettings();

  const model = buildReport(state, params.id);
  if (!model) notFound();

  const inc = model.incident;
  const isActiveScenario = inc.scenarioId === state.scenarioId;

  const downloadMd = () =>
    downloadTextFile(`${inc.number}-report.md`, reportToMarkdown(model, settings.timezone), "text/markdown");
  const downloadJson = () =>
    downloadTextFile(`${inc.number}-report.json`, reportToJson(model), "application/json");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button asChild variant="ghost" size="xs">
          <Link href="/reports">
            <ArrowLeft className="h-3 w-3" /> Reports
          </Link>
        </Button>
        <span>/</span>
        <span className="font-mono text-foreground">{inc.number}</span>
      </div>

      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={inc.severity} />
            <IncidentStatusBadge status={inc.status} />
            <Badge variant="outline" className="font-mono">
              {inc.number}
            </Badge>
            <span className="text-[11px] text-muted-foreground">{model.scenarioName}</span>
          </div>
        }
        title={`Incident report — ${inc.title}`}
        description="Generated from the deterministic simulation state — exportable for post-incident review."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={downloadMd}>
              <Download className="h-3.5 w-3.5" /> Markdown
            </Button>
            <Button variant="outline" size="sm" onClick={downloadJson}>
              <Download className="h-3.5 w-3.5" /> JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
          </>
        }
      />

      {/* Report sheet */}
      <Card className="mx-auto max-w-5xl">
        <CardContent className="space-y-6 p-5 sm:p-7">
          {/* Summary */}
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">
              1 · Incident summary
            </h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { k: "Scenario", v: model.scenarioName },
                { k: "Severity", v: inc.severity.toUpperCase() },
                { k: "Status", v: inc.status },
                { k: "Opened", v: `${formatDateTime(inc.openedTs, settings.timezone)} · T+${inc.openedTick}` },
                {
                  k: "Resolved",
                  v: inc.resolvedTs ? `${formatDateTime(inc.resolvedTs, settings.timezone)} · T+${inc.resolvedTick}` : "open",
                },
                { k: "Duration", v: formatTickDuration(model.durationTicks) },
                { k: "Affected services", v: inc.serviceIds.join(", ") },
                { k: "Workspace", v: settings.workspaceName },
                { k: "Environment", v: settings.environment },
              ].map((row) => (
                <div key={row.k} className="rounded-md border border-border bg-panel-2 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{row.k}</p>
                  <p className="mt-0.5 text-xs font-medium text-foreground">{row.v}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{inc.description}</p>
          </section>

          <Separator />

          {/* Impact */}
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">2 · Impact</h2>
            {model.impact ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <MetricBox label="Peak error rate" value={formatPct(model.impact.peakErrorRate, 2)} tone="text-destructive" />
                <MetricBox label="Peak p95 latency" value={formatMs(model.impact.peakLatencyP95Ms)} tone="text-warning" />
                <MetricBox label="Min health score" value={`${model.impact.minHealth.toFixed(0)}%`} tone="text-danger" />
                <MetricBox label="Observed window" value={`${model.impact.windowTicks} ticks`} tone="text-foreground" />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Impact metrics are available when the report is generated while its scenario is
                active (metrics are scoped to the live simulation).
              </p>
            )}
          </section>

          <Separator />

          {/* RCA */}
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">
              3 · Root cause analysis
            </h2>
            {model.rootCauseTitle ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="cyan">RC</Badge>
                  <strong>{model.rootCauseTitle}</strong>
                  <span className="text-xs text-muted-foreground">
                    {Math.round((model.rootCauseConfidence ?? 0) * 100)}% confidence · set by{" "}
                    {model.rootCauseSetBy}
                  </span>
                </div>
                {model.verified !== null ? (
                  <Alert variant={model.verified ? "success" : "destructive"}>
                    <AlertTitle className="flex items-center gap-2">
                      {model.verified ? <Check className="h-4 w-4" /> : <CircleX className="h-4 w-4" />}
                      {model.verified
                        ? "Verified — matches the actual scenario root cause."
                        : `Refuted — actual cause: ${model.actualRootCauseTitle}`}
                    </AlertTitle>
                    <AlertDescription>
                      {model.verified
                        ? "The hypothesis was supported by the evidence chain and confirmed at resolution."
                        : "Compare the evidence you weighted against the planted cause to sharpen the next investigation."}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Verification becomes available once the incident is resolved.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Target className="h-3.5 w-3.5" />
                No root cause was recorded for this incident.
                <Button asChild variant="link" size="xs" className="h-auto p-0">
                  <Link href={`/investigate?incident=${inc.id}`}>Run analysis now</Link>
                </Button>
              </div>
            )}
          </section>

          <Separator />

          {/* Recovery */}
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">
              4 · Recovery outcomes
            </h2>
            {model.actions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {isActiveScenario
                  ? "No recovery actions were applied during this incident."
                  : "Recovery actions are recorded while the incident's scenario is active."}
              </p>
            ) : (
              <div className="space-y-2">
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2">Tick</th>
                        <th className="px-3 py-2">Action</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2 text-right">Health Δ</th>
                        <th className="px-3 py-2 text-right">Error</th>
                        <th className="px-3 py-2 text-right">p95</th>
                        <th className="px-3 py-2">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.actions.map((a) => (
                        <tr key={a.id} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2 font-mono text-muted-foreground">T+{a.tick}</td>
                          <td className="px-3 py-2 font-medium text-foreground">{a.name}</td>
                          <td className="px-3 py-2">
                            <Badge variant="secondary" className="capitalize">
                              {a.category}
                            </Badge>
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right font-semibold tabular",
                              a.healthDelta > 0.05 ? "text-success" : a.healthDelta < -0.05 ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {a.healthDelta >= 0 ? "+" : ""}
                            {a.healthDelta}
                          </td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">
                            {formatPct(a.errorBefore, 1)} → {formatPct(a.errorAfter, 1)}
                          </td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">
                            {formatMs(a.p95Before)} → {formatMs(a.p95After)}
                          </td>
                          <td className="px-3 py-2">
                            {a.rolledBack ? (
                              <Badge variant="warning">rolled back</Badge>
                            ) : (
                              <Badge variant="success">active</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {model.actions[0]?.notes?.length ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    <strong className="text-foreground/80">Operator notes: </strong>
                    {model.actions.map((a) => a.notes.join(" ")).join(" ")}
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <Separator />

          {/* Timeline */}
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">
              5 · Timeline
            </h2>
            <IncidentTimeline events={inc.timeline} />
          </section>

          <Separator />

          {/* Outcome & lessons */}
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">
              6 · Outcome &amp; lessons
            </h2>
            <Alert variant={inc.status === "resolved" ? "success" : "info"}>
              <AlertTitle>{inc.status === "resolved" ? "Resolved" : "Still open"}</AlertTitle>
              <AlertDescription>
                {inc.resolution ?? "The incident has not been resolved at export time."}
              </AlertDescription>
            </Alert>
            <ul className="mt-3 space-y-1.5">
              {model.lessons.map((l, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  {l}
                </li>
              ))}
            </ul>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricBox({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-md border border-border bg-panel-2 px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("kpi-value mt-1 text-lg font-semibold", tone)}>{value}</p>
    </div>
  );
}
