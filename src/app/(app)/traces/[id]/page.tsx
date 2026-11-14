"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Clock, TriangleAlert, Zap } from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { useSettings } from "@/state/settings-context";
import { getScenario } from "@/simulation/scenarios";
import type { TraceSpan } from "@/simulation/types";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatMs } from "@/lib/format";
import { seriesColor, STATUS_COLORS } from "@/lib/constants";
import { cn } from "@/lib/cn";

const SPAN_STATUS_STYLE: Record<TraceSpan["status"], string> = {
  ok: "text-success",
  error: "text-destructive",
  timeout: "text-warning",
};

export default function TraceDetailPage() {
  const params = useParams<{ id: string }>();
  const { state } = useSimulation();
  const { settings } = useSettings();
  const scenario = getScenario(state.scenarioId);
  const [selectedSpan, setSelectedSpan] = useState<string | null>(null);

  const trace = state.traces.find((t) => t.id === params.id);
  const serviceIndex = useMemo(() => {
    const map = new Map<string, number>();
    scenario.services.forEach((s, i) => map.set(s.id, i));
    return map;
  }, [scenario]);

  if (!trace) notFound();

  const total = Math.max(1, trace.durationMs);
  const bottleneck = trace.spans.reduce<TraceSpan | null>(
    (max, s) => (!max || s.durationMs > max.durationMs ? s : max),
    null,
  );
  const failedSpans = trace.spans.filter((s) => s.status !== "ok");
  const span = trace.spans.find((s) => s.id === selectedSpan);
  const uniqueServices = new Set(trace.spans.map((s) => s.serviceId)).size;

  // Depth via parent chain
  const depthOf = (s: TraceSpan): number => {
    let d = 0;
    let cur = s;
    const byId = new Map(trace.spans.map((x) => [x.id, x]));
    while (cur.parentId) {
      const p = byId.get(cur.parentId);
      if (!p) break;
      d += 1;
      cur = p;
    }
    return d;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button asChild variant="ghost" size="xs">
          <Link href="/traces">
            <ArrowLeft className="h-3 w-3" /> Trace Explorer
          </Link>
        </Button>
        <span>/</span>
        <span className="font-mono text-foreground">{trace.id}</span>
      </div>

      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={trace.status === "ok" ? "success" : trace.status === "timeout" ? "warning" : "destructive"}>
              {trace.status.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {trace.id}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              T+{trace.tick} · {formatDateTime(trace.ts, settings.timezone)}
            </span>
          </div>
        }
        title={trace.rootName}
        description={`${trace.spans.length} spans across ${uniqueServices} services · total ${formatMs(trace.durationMs)}`}
      />

      {failedSpans.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/8 px-3.5 py-2.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>{failedSpans.length}</strong> failed span
            {failedSpans.length === 1 ? "" : "s"}:{" "}
            {failedSpans.map((s) => `${s.serviceId} (${s.status})`).join(", ")} — the request path
            breaks here.
          </span>
        </div>
      ) : null}

      {/* Waterfall */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Span waterfall</CardTitle>
            <CardDescription>Bar position = offset from trace start · width = duration</CardDescription>
          </div>
          {bottleneck ? (
            <span className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning">
              <Zap className="h-3 w-3" /> Bottleneck: {bottleneck.serviceId} · {formatMs(bottleneck.durationMs)}
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-1.5">
          {/* axis */}
          <div className="flex justify-between border-b border-border pb-1 pl-52 text-[10px] tabular text-muted-foreground">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <span key={f}>{formatMs(total * f)}</span>
            ))}
          </div>

          {trace.spans.map((s) => {
            const idx = serviceIndex.get(s.serviceId) ?? 0;
            const color = seriesColor(idx);
            const depth = depthOf(s);
            const left = (s.startMs / total) * 100;
            const width = Math.max(1.5, (s.durationMs / total) * 100);
            const isBottleneck = bottleneck?.id === s.id;
            const failed = s.status !== "ok";
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSpan(selectedSpan === s.id ? null : s.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent/50",
                  selectedSpan === s.id && "bg-accent/70 ring-1 ring-primary/60",
                )}
              >
                <span className="flex w-[7.2rem] shrink-0 items-center gap-1.5 sm:w-48">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: failed ? STATUS_COLORS.down : color }}
                  />
                  <span className="truncate text-[11px] font-medium text-foreground" style={{ paddingLeft: depth * 8 }}>
                    {s.serviceId}
                  </span>
                </span>
                <span className="hidden w-40 shrink-0 truncate text-[11px] text-muted-foreground md:block">
                  {s.name}
                </span>
                <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded bg-muted/60">
                  <span
                    className="absolute top-0 h-full rounded"
                    style={{
                      left: `${left}%`,
                      width: `${Math.min(width, 100 - left)}%`,
                      backgroundColor: failed ? `${STATUS_COLORS.down}dd` : `${color}cc`,
                      border: failed ? "1px solid #ef4444" : isBottleneck ? "1px solid #f59e0b" : "1px solid transparent",
                    }}
                  />
                </span>
                <span
                  className={cn(
                    "w-20 shrink-0 text-right text-[11px] tabular",
                    failed ? SPAN_STATUS_STYLE[s.status] : "text-muted-foreground",
                  )}
                >
                  {formatMs(s.durationMs)}
                </span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* Span detail */}
      {span ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="font-mono text-[13px]">{span.name}</CardTitle>
              <Badge variant="outline" className="font-mono">
                {span.serviceId}
              </Badge>
              <Badge variant={span.status === "ok" ? "success" : span.status === "timeout" ? "warning" : "destructive"}>
                {span.status}
              </Badge>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" /> +{formatMs(span.startMs)} → {formatMs(span.startMs + span.durationMs)}
              </span>
            </div>
            <CardDescription>Span id {span.id}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(span.attributes).map(([k, v]) => (
                <div key={k} className="rounded-md border border-border bg-terminal px-2.5 py-1.5">
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-cyan">{String(v)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 text-xs text-muted-foreground">
            Select a span above to inspect its attributes ({trace.spans.length} spans ·{" "}
            {failedSpans.length} failing).
          </CardContent>
        </Card>
      )}
    </div>
  );
}
