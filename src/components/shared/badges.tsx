import type { HealthStatus, IncidentStatus, Severity } from "@/simulation/types";
import { SEVERITY_COLORS, SEVERITY_LABELS, STATUS_COLORS, STATUS_LABELS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";

export function StatusDot({ status, pulse = false }: { status: HealthStatus; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
      <span
        className={cn(
          "inline-flex h-2.5 w-2.5 rounded-full transition-colors duration-200",
          pulse && status !== "healthy" && "animate-pulse",
        )}
        style={{ backgroundColor: STATUS_COLORS[status] }}
      />
    </span>
  );
}

export function HealthBadge({ status, className }: { status: HealthStatus; className?: string }) {
  const variant =
    status === "healthy"
      ? "success"
      : status === "degraded"
        ? "warning"
        : status === "critical"
          ? "destructive"
          : "destructive";
  return (
    <Badge variant={variant} className={cn("uppercase tracking-wide", className)}>
      <span className="h-1.5 w-1.5 rounded-full transition-colors duration-200" style={{ backgroundColor: STATUS_COLORS[status] }} />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider"
      style={{
        color: SEVERITY_COLORS[severity],
        borderColor: `${SEVERITY_COLORS[severity]}55`,
        backgroundColor: `${SEVERITY_COLORS[severity]}18`,
      }}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  triggered: "Triggered",
  acknowledged: "Acknowledged",
  investigating: "Investigating",
  resolved: "Resolved",
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const variant =
    status === "triggered"
      ? "destructive"
      : status === "acknowledged"
        ? "warning"
        : status === "investigating"
          ? "info"
          : "success";
  return <Badge variant={variant}>{INCIDENT_STATUS_LABEL[status]}</Badge>;
}
