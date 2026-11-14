"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Info, Network } from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { getScenario } from "@/simulation/scenarios";
import type { HealthStatus } from "@/simulation/types";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge, StatusDot } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { STATUS_COLORS } from "@/lib/constants";
import { formatMs, formatPct, formatRps } from "@/lib/format";
import { downstreamOf, upstreamOf } from "@/data/selectors";
import { cn } from "@/lib/cn";

const DependencyGraph = dynamic(
  () => import("@/components/dependencies/dependency-graph").then((m) => m.DependencyGraph),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
  },
);

const LEGEND: Array<{ label: string; color: string }> = [
  { label: "Healthy", color: STATUS_COLORS.healthy },
  { label: "Degraded", color: STATUS_COLORS.degraded },
  { label: "Critical", color: STATUS_COLORS.critical },
  { label: "Down", color: STATUS_COLORS.down },
];

function DependencyMapContent() {
  const { state } = useSimulation();
  const searchParams = useSearchParams();
  const router = useRouter();
  // The ?focus= query param is the source of truth (deep-linkable selection).
  const selected = searchParams.get("focus") ?? undefined;
  const scenario = getScenario(state.scenarioId);
  const [propagationMode, setPropagationMode] = useState(true);

  const selectNode = (id?: string) => {
    router.replace(id ? `/dependencies?focus=${id}` : "/dependencies", { scroll: false });
  };

  const statuses = useMemo(() => {
    const map: Record<string, { status: HealthStatus; cpu: number; p95: number; err: number }> = {};
    for (const def of scenario.services) {
      const rt = state.services[def.id];
      map[def.id] = {
        status: rt?.status ?? "healthy",
        cpu: rt?.current.cpuPct ?? def.baseline.cpuPct,
        p95: rt?.current.latencyP95Ms ?? def.baseline.latencyP95Ms,
        err: rt?.current.errorRate ?? def.baseline.errorRate,
      };
    }
    return map;
  }, [scenario, state.services]);

  const affected = scenario.services.filter((s) => statuses[s.id]?.status !== "healthy");
  const selectedDef = scenario.services.find((s) => s.id === selected);
  const selectedRt = selected ? state.services[selected] : undefined;
  const upstream = selectedDef ? upstreamOf(scenario, selectedDef.id) : [];
  const downstream = selectedDef ? downstreamOf(scenario, selectedDef.id) : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dependency Map"
        description="Interactive service topology with live failure-propagation highlighting. Click a node for detail; edges show protocol and health."
        eyebrow={
          affected.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Affected:</span>
              {affected.slice(0, 6).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectNode(s.id)}
                  className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] text-warning transition-colors hover:bg-warning/20"
                >
                  <StatusDot status={statuses[s.id]!.status} />
                  {s.name}
                </button>
              ))}
              {affected.length > 6 ? (
                <span className="text-[11px] text-muted-foreground">+{affected.length - 6} more</span>
              ) : null}
            </div>
          ) : null
        }
        actions={
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-3 sm:flex">
              {LEGEND.map((l) => (
                <span key={l.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
                  {l.label}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2">
              <Switch
                id="propagation"
                checked={propagationMode}
                onCheckedChange={setPropagationMode}
                aria-label="Toggle propagation highlight"
              />
              <Label htmlFor="propagation" className="text-xs text-foreground cursor-pointer">
                Propagation focus
              </Label>
            </div>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          <div className="h-[calc(100vh-15rem)] min-h-[430px] w-full bg-terminal">
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <DependencyGraph
                scenario={scenario}
                statuses={statuses}
                propagationMode={propagationMode}
                selectedId={selected}
                onSelect={selectNode}
              />
            </Suspense>
          </div>
        </Card>

        <div className="space-y-4">
          {selectedDef ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="font-mono text-[13px]">{selectedDef.name}</CardTitle>
                  {selectedRt ? <HealthBadge status={selectedRt.status} /> : null}
                </div>
                <CardDescription>{selectedDef.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { k: "Team", v: selectedDef.team },
                    { k: "Runtime", v: selectedDef.runtime },
                    { k: "CPU", v: `${(selectedRt?.current.cpuPct ?? 0).toFixed(0)}%` },
                    { k: "Memory", v: `${(selectedRt?.current.memPct ?? 0).toFixed(0)}%` },
                    { k: "p95", v: formatMs(selectedRt?.current.latencyP95Ms ?? 0) },
                    { k: "Errors", v: formatPct(selectedRt?.current.errorRate ?? 0, 2) },
                    { k: "Traffic", v: formatRps(selectedRt?.current.rps ?? 0) },
                    { k: "Availability", v: formatPct(selectedRt?.availability ?? 1, 2) },
                  ].map((row) => (
                    <div key={row.k} className="rounded-md border border-border bg-panel-2 px-2 py-1.5">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{row.k}</p>
                      <p className="mt-0.5 tabular font-medium text-foreground">{row.v}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Upstream
                  </p>
                  <div className="space-y-1">
                    {upstream.length === 0 ? (
                      <p className="text-xs text-muted-foreground">—</p>
                    ) : (
                      upstream.map((u) => (
                        <NodeRow key={u.id} id={u.id} status={statuses[u.id]?.status ?? "healthy"} onSelect={selectNode} />
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Downstream
                  </p>
                  <div className="space-y-1">
                    {downstream.length === 0 ? (
                      <p className="text-xs text-muted-foreground">—</p>
                    ) : (
                      downstream.map((d) => (
                        <NodeRow key={d.id} id={d.id} status={statuses[d.id]?.status ?? "healthy"} onSelect={selectNode} />
                      ))
                    )}
                  </div>
                </div>

                <Button asChild size="sm" className="w-full">
                  <Link href={`/services/${selectedDef.id}`}>
                    Open in Service Monitor <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Network className="h-4 w-4 text-primary" /> Topology overview
                </CardTitle>
                <CardDescription>
                  {scenario.services.length} services · {scenario.edges.length} dependencies
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Healthy" value={scenario.services.length - affected.length} tone="text-success" />
                  <Stat
                    label="Affected"
                    value={affected.length}
                    tone={affected.length > 0 ? "text-warning" : "text-success"}
                  />
                </div>
                <p className="flex gap-2 rounded-md border border-info/30 bg-info/8 p-2.5 text-[11px] leading-relaxed text-info">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Click any node to inspect upstream/downstream relationships. Failing edges turn
                  amber/red and animate as the wave propagates.
                </p>
                {affected.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Blast radius
                    </p>
                    {affected.map((s) => (
                      <NodeRow
                        key={s.id}
                        id={s.id}
                        status={statuses[s.id]!.status}
                        onSelect={selectNode}
                      />
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border border-border bg-panel-2 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("kpi-value text-lg font-semibold", tone)}>{value}</p>
    </div>
  );
}

function NodeRow({
  id,
  status,
  onSelect,
}: {
  id: string;
  status: HealthStatus;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors hover:border-primary/50",
        status === "healthy" ? "border-border bg-panel-2" : "bg-warning/5",
      )}
    >
      <StatusDot status={status} />
      <span className="truncate font-medium text-foreground">{id}</span>
      <Badge variant="outline" className="ml-auto text-[9px] uppercase">
        {status}
      </Badge>
    </button>
  );
}

export default function DependencyMapPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <DependencyMapContent />
    </Suspense>
  );
}
