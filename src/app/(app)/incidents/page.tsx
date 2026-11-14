"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Plus, Search, Siren } from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { getScenario, SCENARIO_LIST } from "@/simulation/scenarios";
import type { Severity } from "@/simulation/types";
import { activeIncidents, scenarioIncidents } from "@/data/selectors";
import { PageHeader } from "@/components/shared/page-header";
import { IncidentStatusBadge, SeverityBadge, StatusDot } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { formatDateTime, formatTickDuration } from "@/lib/format";
import { useSettings } from "@/state/settings-context";

type StatusFilter = "active" | "resolved" | "all";

export default function IncidentCenterPage() {
  const { state } = useSimulation();
  const { settings } = useSettings();
  const scenario = getScenario(state.scenarioId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [scope, setScope] = useState<"current" | "all">("current");
  const [query, setQuery] = useState("");

  const active = activeIncidents(state, scenario.id);

  // Filtered/sorted incident list (computed directly — lists are small).
  const list = (() => {
    let base = scenarioIncidents(state, scope === "all" ? "" : scenario.id);
    if (scope === "all") base = [...state.incidents];
    if (statusFilter === "active") base = base.filter((i) => i.status !== "resolved");
    if (statusFilter === "resolved") base = base.filter((i) => i.status === "resolved");
    if (severity !== "all") base = base.filter((i) => i.severity === severity);
    if (query) {
      const q = query.toLowerCase();
      base = base.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.number.toLowerCase().includes(q) ||
          i.serviceIds.some((s) => s.toLowerCase().includes(q)),
      );
    }
    return [...base].sort((a, b) => b.openedTick - a.openedTick);
  })();

  const sev1 = active.filter((i) => i.severity === "sev1").length;
  const open = active.length;
  const totalResolved = state.incidents.filter((i) => i.status === "resolved").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Incident Center"
        description="Declare, acknowledge, investigate and resolve incidents across the simulation lifecycle."
        actions={
          <div className="flex items-center gap-3 rounded-lg border border-border bg-panel px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 text-destructive">
              <Siren className="h-3.5 w-3.5" /> {open} active
            </span>
            <span className="text-muted-foreground">{sev1} SEV1</span>
            <span className="text-success">{totalResolved} resolved</span>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative w-full max-w-[14rem]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search incidents…"
            className="pl-8"
            aria-label="Search incidents"
          />
        </div>

        <Select value={severity} onValueChange={(v) => setSeverity(v as Severity | "all")}>
          <SelectTrigger className="w-32" aria-label="Filter by severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All SEV</SelectItem>
            <SelectItem value="sev1">SEV1</SelectItem>
            <SelectItem value="sev2">SEV2</SelectItem>
            <SelectItem value="sev3">SEV3</SelectItem>
          </SelectContent>
        </Select>

        <Select value={scope} onValueChange={(v) => setScope(v as "current" | "all")}>
          <SelectTrigger className="w-44" aria-label="Incident scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current">Current scenario</SelectItem>
            <SelectItem value="all">All scenarios ({SCENARIO_LIST.length})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        {list.length === 0 ? (
          <EmptyState
            icon={<Plus className="h-5 w-5" />}
            title="No incidents match"
            description="Incidents are created automatically when scenario thresholds are breached. Keep the simulation running, or adjust the filters."
            className="m-4"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Incident</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Services</TableHead>
                <TableHead className="hidden lg:table-cell">Opened</TableHead>
                <TableHead className="hidden lg:table-cell">Duration</TableHead>
                <TableHead className="hidden xl:table-cell">Scenario</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((inc) => {
                const scenarioMeta = SCENARIO_LIST.find((s) => s.id === inc.scenarioId);
                const dur =
                  (inc.resolvedTick ?? state.tick) - inc.openedTick;
                const origin = state.services[inc.serviceIds[0]];
                return (
                  <TableRow key={inc.id} className="density-row">
                    <TableCell>
                      <SeverityBadge severity={inc.severity} />
                    </TableCell>
                    <TableCell>
                      <Link href={`/incidents/${inc.id}`} className="block">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-muted-foreground">{inc.number}</span>
                          {inc.status !== "resolved" && origin ? (
                            <StatusDot status={origin.status} pulse />
                          ) : null}
                        </span>
                        <span className="block max-w-md truncate text-[13px] font-medium text-foreground hover:text-primary">
                          {inc.title}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <IncidentStatusBadge status={inc.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="flex flex-wrap gap-1">
                        {inc.serviceIds.slice(0, 3).map((s) => (
                          <Badge key={s} variant="secondary" className="font-mono text-[10px]">
                            {s}
                          </Badge>
                        ))}
                        {inc.serviceIds.length > 3 ? (
                          <span className="text-[10px] text-muted-foreground">
                            +{inc.serviceIds.length - 3}
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-xs tabular text-muted-foreground lg:table-cell">
                      {formatDateTime(inc.openedTs, settings.timezone)}
                    </TableCell>
                    <TableCell className="hidden text-xs tabular text-muted-foreground lg:table-cell">
                      {formatTickDuration(dur)}
                      {inc.status !== "resolved" ? <span className="text-destructive"> (open)</span> : null}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                      {scenarioMeta?.name ?? inc.scenarioId}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="icon-sm" aria-label="Open incident">
                        <Link href={`/incidents/${inc.id}`}>
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
