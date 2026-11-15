"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Server } from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { getScenario } from "@/simulation/scenarios";
import { serviceRows, statusCounts } from "@/data/selectors";
import type { HealthStatus } from "@/simulation/types";
import { PageHeader } from "@/components/shared/page-header";
import { HealthBadge, StatusDot } from "@/components/shared/badges";
import { Sparkline } from "@/components/charts/sparkline";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { formatMs, formatPct, formatRps } from "@/lib/format";
import { STATUS_COLORS } from "@/lib/constants";
import { cn } from "@/lib/cn";

const STATUS_FILTERS: Array<{ value: HealthStatus | "all"; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "healthy", label: "Healthy" },
  { value: "degraded", label: "Degraded" },
  { value: "critical", label: "Critical" },
  { value: "down", label: "Down" },
];

export default function ServiceMonitorPage() {
  const { state } = useSimulation();
  const scenario = getScenario(state.scenarioId);
  const rows = useMemo(() => serviceRows(state, scenario), [state, scenario]);
  const counts = statusCounts(rows);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<HealthStatus | "all">("all");

  const filtered = rows.filter((r) => {
    if (status !== "all" && r.runtime.status !== status) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        r.def.name.toLowerCase().includes(q) ||
        r.def.team.toLowerCase().includes(q) ||
        r.def.kind.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service Monitor"
        description="Inventory, live health and historical metrics for every service in the active topology."
        actions={
          <div className="flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2">
            <Server className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {rows.length} services · {scenario.name}
            </span>
          </div>
        }
      />

      {/* Status strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["healthy", "degraded", "critical", "down"] as const).map((s) => (
          <Card key={s} className="p-3">
            <div className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[s] }}
              />
              <span className="text-xs capitalize text-muted-foreground">{s}</span>
              <span className="kpi-value ml-auto text-lg font-semibold">{counts[s]}</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search services…"
            className="pl-8"
            aria-label="Search services"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as HealthStatus | "all")}>
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(query || status !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setStatus("all");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            title="No services match your filters"
            description="Try clearing the search or status filter."
            className="m-4"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Service</TableHead>
                <TableHead className="hidden md:table-cell">Team</TableHead>
                <TableHead className="text-right">CPU</TableHead>
                <TableHead className="text-right">Mem</TableHead>
                <TableHead className="text-right">p95</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Traffic</TableHead>
                <TableHead className="hidden w-28 xl:table-cell">Latency trend</TableHead>
                <TableHead className="text-right">Availability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.def.id} className="density-row cursor-pointer">
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <StatusDot status={r.runtime.status} pulse />
                      <span className="hidden text-xs capitalize sm:inline">{r.runtime.status}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link href={`/services/${r.def.id}`} className="block">
                      <span className="text-[13px] font-medium text-foreground hover:text-primary">
                        {r.def.name}
                      </span>
                      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                        {r.def.kind} · {r.def.runtime}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {r.def.team}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular">
                    <span
                      className={cn(r.runtime.current.cpuPct > 85 && "font-semibold text-danger")}
                    >
                      {r.runtime.current.cpuPct.toFixed(0)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular">
                    {r.runtime.current.memPct.toFixed(0)}%
                  </TableCell>
                  <TableCell className="text-right text-xs tabular">
                    <span
                      className={cn(
                        r.runtime.current.latencyP95Ms > r.def.baseline.latencyP95Ms * 2 &&
                          "font-semibold text-warning",
                      )}
                    >
                      {formatMs(r.runtime.current.latencyP95Ms)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular">
                    <span
                      className={cn(
                        r.runtime.current.errorRate > 0.05 && "font-semibold text-destructive",
                      )}
                    >
                      {formatPct(r.runtime.current.errorRate, 2)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right text-xs tabular lg:table-cell">
                    {formatRps(r.runtime.current.rps)}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <Sparkline
                      data={r.spark}
                      color={STATUS_COLORS[r.runtime.status]}
                      height={22}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="flex items-center justify-end gap-2">
                      <span className="text-xs tabular text-muted-foreground">
                        {formatPct(r.runtime.availability, 2)}
                      </span>
                      <HealthBadge status={r.runtime.status} />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
