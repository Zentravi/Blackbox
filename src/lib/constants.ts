import type { HealthStatus, ScenarioId, Severity } from "@/simulation/types";

export const APP_NAME = "BLACKBOX";
export const APP_VERSION = "1.0.0";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  group: string;
}

/** Sidebar navigation — every entry maps to a real route. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", group: "Overview" },
  { href: "/dependencies", label: "Dependency Map", icon: "Network", group: "Overview" },
  { href: "/services", label: "Service Monitor", icon: "Server", group: "Observe" },
  { href: "/incidents", label: "Incident Center", icon: "Siren", group: "Observe" },
  { href: "/logs", label: "Log Explorer", icon: "ScrollText", group: "Observe" },
  { href: "/traces", label: "Trace Explorer", icon: "Route", group: "Observe" },
  { href: "/investigate", label: "Investigation Engine", icon: "Brain", group: "Respond" },
  { href: "/recovery", label: "Recovery Simulator", icon: "Wrench", group: "Respond" },
  { href: "/reports", label: "Reports", icon: "FileText", group: "Respond" },
  { href: "/settings", label: "Settings", icon: "Settings", group: "System" },
];

export const STATUS_COLORS: Record<HealthStatus, string> = {
  healthy: "#22c55e",
  degraded: "#f59e0b",
  critical: "#f97316",
  down: "#ef4444",
};

export const STATUS_LABELS: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
  down: "Down",
};

export const SEVERITY_COLORS: Record<Severity, string> = {
  sev1: "#ef4444",
  sev2: "#f59e0b",
  sev3: "#38bdf8",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  sev1: "SEV1",
  sev2: "SEV2",
  sev3: "SEV3",
};

/** Distinct, accessible series colors for charts & trace spans. */
export const SERIES_COLORS = [
  "#3d7dff",
  "#22d3ee",
  "#a78bfa",
  "#f59e0b",
  "#22c55e",
  "#f472b6",
  "#38bdf8",
  "#fb923c",
  "#4ade80",
  "#e879f9",
];

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export interface ScenarioMeta {
  id: ScenarioId;
  name: string;
  short: string;
  tagline: string;
  difficulty: string;
}

export const SPEED_OPTIONS = [
  { value: 0.5, label: "0.5×" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 4, label: "4×" },
] as const;

export function severityRank(s: Severity): number {
  return s === "sev1" ? 1 : s === "sev2" ? 2 : 3;
}
