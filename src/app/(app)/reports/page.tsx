"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChevronRight, CircleCheck, Clock, FileText, Siren, Target } from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { useSettings } from "@/state/settings-context";
import { SCENARIO_LIST } from "@/simulation/scenarios";
import { PageHeader } from "@/components/shared/page-header";
import { IncidentStatusBadge, SeverityBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatTickDuration } from "@/lib/format";
import { buildReport, type ReportModel } from "@/lib/report-format";

function Stats({ reports }: { reports: ReportModel[] }) {
  const resolved = reports.filter((r) => r.incident.status === "resolved");
  const verified = resolved.filter((r) => r.verified === true);
  const refuted = resolved.filter((r) => r.verified === false);
  const withRca = resolved.filter((r) => r.rootCauseTitle);
  const avgDur =
    resolved.length > 0
      ? resolved.reduce((a, r) => a + r.durationTicks, 0) / resolved.length
      : 0;

  const stats = [
    { label: "Total incidents", value: String(reports.length), tone: "text-foreground" },
    { label: "Resolved", value: String(resolved.length), tone: "text-success" },
    {
      label: "RCA recorded",
      value: withRca.length ? `${withRca.length}/${resolved.length}` : "—",
      tone: "text-primary",
    },
    {
      label: "Root cause verified",
      value: verified.length ? `${verified.length}✓${refuted.length ? ` / ${refuted.length}✗` : ""}` : "—",
      tone: verified.length ? "text-success" : "text-muted-foreground",
    },
    { label: "Avg. resolution", value: resolved.length ? formatTickDuration(Math.round(avgDur)) : "—", tone: "text-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {stats.map((s) => (
        <Card key={s.label} className="p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
          <p className={`kpi-value mt-1 text-lg font-semibold ${s.tone}`}>{s.value}</p>
        </Card>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const { state } = useSimulation();
  const { settings } = useSettings();

  const reports = useMemo(() => {
    return state.incidents
      .map((i) => buildReport(state, i.id))
      .filter((r): r is ReportModel => r !== null)
      .sort((a, b) => b.incident.openedTick - a.incident.openedTick);
  }, [state]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Incident summaries, root-cause analysis and recovery outcomes — exportable as Markdown or JSON."
        actions={
          <Badge variant="secondary" className="px-3 py-1.5">
            <FileText className="h-3.5 w-3.5" /> {reports.length} reports
          </Badge>
        }
      />

      <Stats reports={reports} />

      <Card>
        {reports.length === 0 ? (
          <EmptyState
            icon={<Siren className="h-5 w-5" />}
            title="No incident reports yet"
            description="Reports are generated automatically from incident records as scenarios unfold."
            className="m-4"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Incident</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Scenario</TableHead>
                <TableHead className="hidden lg:table-cell">Duration</TableHead>
                <TableHead className="hidden xl:table-cell">Root cause</TableHead>
                <TableHead className="hidden lg:table-cell">Resolved</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((r) => {
                const meta = SCENARIO_LIST.find((s) => s.name === r.scenarioName);
                return (
                  <TableRow key={r.incident.id} className="density-row">
                    <TableCell>
                      <Link href={`/reports/${r.incident.id}`} className="block">
                        <span className="font-mono text-[11px] text-muted-foreground">{r.incident.number}</span>
                        <span className="block max-w-md truncate text-[13px] font-medium text-foreground hover:text-primary">
                          {r.incident.title}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={r.incident.severity} />
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <IncidentStatusBadge status={r.incident.status} />
                        {r.verified === true ? (
                          <CircleCheck className="h-3.5 w-3.5 text-success" aria-label="verified" />
                        ) : r.verified === false ? (
                          <Target className="h-3.5 w-3.5 text-destructive" aria-label="refuted" />
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {meta?.name ?? r.scenarioName}
                    </TableCell>
                    <TableCell className="hidden text-xs tabular text-muted-foreground lg:table-cell">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTickDuration(r.durationTicks)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-[18rem] xl:table-cell">
                      {r.rootCauseTitle ? (
                        <span className="block truncate text-xs text-foreground/85">{r.rootCauseTitle}</span>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">not recorded</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-xs tabular text-muted-foreground lg:table-cell">
                      {r.incident.resolvedTs
                        ? formatDateTime(r.incident.resolvedTs, settings.timezone)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/reports/${r.incident.id}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label="Open report"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
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
