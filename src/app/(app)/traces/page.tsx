"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Route as RouteIcon } from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { useSettings } from "@/state/settings-context";
import { getScenario } from "@/simulation/scenarios";
import type { Trace } from "@/simulation/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatMs, shortId } from "@/lib/format";
import { cn } from "@/lib/cn";
import { STATUS_COLORS } from "@/lib/constants";

const STATUS_BADGE: Record<Trace["status"], { label: string; variant: "success" | "warning" | "destructive" }> = {
  ok: { label: "OK", variant: "success" },
  error: { label: "ERROR", variant: "destructive" },
  timeout: { label: "TIMEOUT", variant: "warning" },
};

function TraceListContent() {
  const { state } = useSimulation();
  const { settings } = useSettings();
  const scenario = getScenario(state.scenarioId);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [status, setStatus] = useState(searchParams.get("status") ?? "all");
  const [service, setService] = useState(searchParams.get("service") ?? "all");
  const [minDuration, setMinDuration] = useState("0");

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "all" || value === "0") next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const filtered = useMemo(() => {
    const min = Number(minDuration);
    return [...state.traces]
      .filter((t) => {
        if (status !== "all" && t.status !== status) return false;
        if (service !== "all" && !t.spans.some((s) => s.serviceId === service)) return false;
        if (min > 0 && t.durationMs < min) return false;
        return true;
      })
      .sort((a, b) => b.tick - a.tick || b.ts - a.ts);
  }, [state.traces, status, service, minDuration]);

  const maxDur = Math.max(1, ...filtered.slice(0, 50).map((t) => t.durationMs));
  const errorRate =
    state.traces.length > 0
      ? state.traces.filter((t) => t.status !== "ok").length / state.traces.length
      : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trace Explorer"
        description="Distributed request paths across services — span durations, failed hops and latency bottlenecks."
        actions={
          <div className="flex items-center gap-3 rounded-lg border border-border bg-panel px-3 py-2 text-xs">
            <span className="text-muted-foreground">{state.traces.length} sampled</span>
            <span className={cn("font-semibold", errorRate > 0.15 ? "text-destructive" : "text-success")}>
              {(errorRate * 100).toFixed(0)}% failing
            </span>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setParam("status", v);
          }}
        >
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="ok">OK</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="timeout">Timeout</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={service}
          onValueChange={(v) => {
            setService(v);
            setParam("service", v);
          }}
        >
          <SelectTrigger className="w-52" aria-label="Filter by service">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {scenario.services.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={minDuration} onValueChange={setMinDuration}>
          <SelectTrigger className="w-40" aria-label="Minimum duration">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Any duration</SelectItem>
            <SelectItem value="500">≥ 500 ms</SelectItem>
            <SelectItem value="1000">≥ 1 s</SelectItem>
            <SelectItem value="2000">≥ 2 s</SelectItem>
          </SelectContent>
        </Select>

        <span className="ml-auto text-xs tabular text-muted-foreground">{filtered.length} traces</span>
      </div>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<RouteIcon className="h-5 w-5" />}
            title="No traces match"
            description="The engine samples traces continuously — try widening the filters."
            className="m-4"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trace</TableHead>
                <TableHead>Route</TableHead>
                <TableHead className="hidden md:table-cell">Entry service</TableHead>
                <TableHead className="w-44">Duration</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Spans</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Time</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 120).map((t) => {
                const entry = scenario.services.find((s) => s.id === t.entryServiceId);
                const tone =
                  t.status === "ok"
                    ? STATUS_COLORS.healthy
                    : t.status === "timeout"
                      ? STATUS_COLORS.degraded
                      : STATUS_COLORS.down;
                return (
                  <TableRow
                    key={t.id}
                    className="density-row cursor-pointer"
                    onClick={() => router.push(`/traces/${t.id}`)}
                  >
                    <TableCell className="font-mono text-[11px] text-cyan">{shortId(t.id, 10)}</TableCell>
                    <TableCell className="text-[12px] font-medium">{t.rootName}</TableCell>
                    <TableCell className="hidden font-mono text-[11px] text-muted-foreground md:table-cell">
                      {t.entryServiceId}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs tabular">{formatMs(t.durationMs)}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.max(3, (t.durationMs / maxDur) * 100)}%`,
                              backgroundColor: tone,
                            }}
                          />
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-right text-xs tabular text-muted-foreground sm:table-cell">
                      {t.spans.length}
                      {entry ? <span className="ml-1 text-[10px]">({new Set(t.spans.map((s) => s.serviceId)).size} svc)</span> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[t.status].variant}>{STATUS_BADGE[t.status].label}</Badge>
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-[11px] tabular text-muted-foreground lg:table-cell">
                      {formatDateTime(t.ts, settings.timezone)}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {filtered.length > 120 ? (
        <p className="text-center text-xs text-muted-foreground">
          Showing newest 120 of {filtered.length} matching traces — narrow the filters to see the rest.
        </p>
      ) : null}
    </div>
  );
}

export default function TracesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <TraceListContent />
    </Suspense>
  );
}
