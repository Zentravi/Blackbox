"use client";

import { memo, useMemo } from "react";
import Link from "next/link";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { HealthStatus, ScenarioDefinition, ServiceDef } from "@/simulation/types";
import { STATUS_COLORS } from "@/lib/constants";
import { formatMs, formatPct } from "@/lib/format";
import { cn } from "@/lib/cn";

export interface ServiceNodeData extends Record<string, unknown> {
  def: ServiceDef;
  status: HealthStatus;
  cpu: number;
  p95: number;
  err: number;
  affected: boolean;
}

type AppNode = Node<ServiceNodeData, "service">;

function statusBorder(status: HealthStatus): string {
  return status === "healthy" ? "#1c2740" : STATUS_COLORS[status];
}

const ServiceNode = memo(function ServiceNode({ data, selected }: NodeProps<AppNode>) {
  const { def, status, cpu, p95, err, affected } = data;
  return (
    <div
      className={cn(
        "w-[190px] rounded-lg border bg-panel px-3 py-2.5 shadow-lg transition-all",
        selected ? "ring-2 ring-primary" : "",
      )}
      style={{
        borderColor: statusBorder(status),
        boxShadow:
          status === "down"
            ? "0 0 22px -6px rgba(239,68,68,0.55)"
            : status === "critical"
              ? "0 0 22px -6px rgba(249,115,22,0.5)"
              : status === "degraded"
                ? "0 0 18px -8px rgba(245,158,11,0.5)"
                : undefined,
        opacity: affected ? 1 : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-[#3d7dff]" />
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            status !== "healthy" && "animate-pulse",
          )}
          style={{ backgroundColor: STATUS_COLORS[status] }}
        />
        <span className="truncate text-[12px] font-semibold text-foreground">{def.name}</span>
      </div>
      <p className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
        {def.kind} · {def.team}
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] tabular text-muted-foreground">
        <span className={cn(cpu > 85 && "text-danger")}>{cpu.toFixed(0)}% cpu</span>
        <span className={cn(p95 > def.baseline.latencyP95Ms * 2 && "text-warning")}>
          {formatMs(p95)}
        </span>
        <span className={cn(err > 0.05 && "text-destructive")}>{formatPct(err, 1)}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-[#3d7dff]" />
    </div>
  );
});

const nodeTypes = { service: ServiceNode };

interface DependencyGraphProps {
  scenario: ScenarioDefinition;
  statuses: Record<string, { status: HealthStatus; cpu: number; p95: number; err: number }>;
  propagationMode: boolean;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
}

function edgeTone(statuses: DependencyGraphProps["statuses"], source: string, target: string): {
  color: string;
  animated: boolean;
} {
  const s = statuses[target]?.status ?? "healthy";
  const src = statuses[source]?.status ?? "healthy";
  if (s === "down" || s === "critical" || src === "down" || src === "critical") {
    return { color: "#ef4444", animated: true };
  }
  if (s === "degraded" || src === "degraded") return { color: "#f59e0b", animated: true };
  return { color: "#2e4066", animated: false };
}

export function DependencyGraph({
  scenario,
  statuses,
  propagationMode,
  selectedId,
  onSelect,
}: DependencyGraphProps) {
  const nodes = useMemo<AppNode[]>(
    () =>
      scenario.services.map((def) => {
        const info = statuses[def.id];
        const status = info?.status ?? "healthy";
        return {
          id: def.id,
          type: "service",
          position: def.pos,
          data: {
            def,
            status,
            cpu: info?.cpu ?? def.baseline.cpuPct,
            p95: info?.p95 ?? def.baseline.latencyP95Ms,
            err: info?.err ?? def.baseline.errorRate,
            affected: status !== "healthy",
          },
          selected: selectedId === def.id,
        };
      }),
    [scenario, statuses, selectedId],
  );

  const edges = useMemo<Edge[]>(
    () =>
      scenario.edges.map((e) => {
        const tone = edgeTone(statuses, e.source, e.target);
        const dimmed = propagationMode && tone.animated === false;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.protocol,
          animated: tone.animated,
          style: { stroke: tone.color, strokeWidth: 1.6, opacity: dimmed ? 0.25 : 1 },
          labelStyle: { fill: "#6b7c9e", fontSize: 9, fontWeight: 600 },
          labelBgStyle: { fill: "#0c1322", fillOpacity: 0.85 },
          labelBgPadding: [4, 2],
          markerEnd: { type: MarkerType.ArrowClosed, color: tone.color, width: 14, height: 14 },
        };
      }),
    [scenario, statuses, propagationMode],
  );

  const miniMapColor = (node: { id: string }) =>
    STATUS_COLORS[statuses[node.id]?.status ?? "healthy"];

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
      minZoom={0.15}
      maxZoom={1.6}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      proOptions={{ hideAttribution: false }}
      defaultEdgeOptions={{ type: "smoothstep" }}
      colorMode="dark"
      aria-label="Service dependency graph"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#141d33" />
      <Controls showInteractive={false} position="bottom-right" />
      <MiniMap
        pannable
        zoomable
        nodeColor={miniMapColor}
        maskColor="rgba(6,9,15,0.75)"
        style={{ backgroundColor: "#0a0f1c" }}
      />
    </ReactFlow>
  );
}

export function ServiceQuickLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Link href={`/services/${id}`} className="text-primary hover:underline">
      {children}
    </Link>
  );
}
