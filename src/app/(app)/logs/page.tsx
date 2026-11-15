"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Download,
  ListFilter,
  Pause,
  Play,
  ScrollText,
  Search,
  X,
} from "lucide-react";
import { useSimulation } from "@/state/simulation-context";
import { useSettings } from "@/state/settings-context";
import { getScenario } from "@/simulation/scenarios";
import type { LogEntry, LogLevel } from "@/simulation/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadTextFile, toCsv } from "@/lib/export";
import { formatDateTime } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { cn } from "@/lib/cn";

const LEVELS: Array<LogLevel | "all"> = ["all", "debug", "info", "warn", "error", "fatal"];

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: "border-border bg-panel text-muted-foreground",
  info: "border-cyan/40 bg-cyan/10 text-cyan",
  warn: "border-warning/40 bg-warning/10 text-warning",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  fatal: "border-destructive bg-destructive/20 text-destructive",
};

function levelBadge(level: LogLevel) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[52px] justify-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
        LEVEL_STYLE[level],
      )}
    >
      {level}
    </span>
  );
}

function LogFieldsDialog({
  entry,
  onClose,
}: {
  entry: LogEntry | null;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {entry ? levelBadge(entry.level) : null}
            <span className="font-mono text-sm">{entry?.id}</span>
          </DialogTitle>
        </DialogHeader>
        {entry ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-foreground">{entry.message}</p>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Service</dt>
              <dd className="font-mono">{entry.serviceId}</dd>
              <dt className="text-muted-foreground">Tick</dt>
              <dd className="font-mono">{entry.tick}</dd>
              <dt className="text-muted-foreground">Time</dt>
              <dd className="font-mono">{formatDateTime(entry.ts, "utc")}</dd>
              {entry.traceId ? (
                <>
                  <dt className="text-muted-foreground">Trace</dt>
                  <dd>
                    <button
                      type="button"
                      className="font-mono text-cyan underline-offset-2 hover:underline"
                      onClick={() => {
                        onClose();
                        router.push(`/traces/${entry.traceId}`);
                      }}
                    >
                      {entry.traceId}
                    </button>
                  </dd>
                </>
              ) : null}
            </dl>
            {Object.keys(entry.fields).length > 0 ? (
              <div className="rounded-md border border-border bg-terminal p-3">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Structured fields
                </p>
                <pre className="max-h-48 overflow-auto font-mono text-[11px] leading-relaxed text-foreground/90">
                  {JSON.stringify(entry.fields, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No structured fields on this entry.</p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LogExplorerContent() {
  const { state } = useSimulation();
  const { settings } = useSettings();
  const scenario = getScenario(state.scenarioId);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [service, setService] = useState(searchParams.get("service") ?? "all");
  const [level, setLevel] = useState(searchParams.get("level") ?? "all");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [liveTail, setLiveTail] = useState(true);
  const [selected, setSelected] = useState<LogEntry | null>(null);

  const debouncedQuery = useDebouncedValue(query, 200);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    let rows = state.logs;
    if (service !== "all") rows = rows.filter((l) => l.serviceId === service);
    if (level !== "all") rows = rows.filter((l) => l.level === level);
    if (q) {
      rows = rows.filter(
        (l) =>
          l.message.toLowerCase().includes(q) ||
          JSON.stringify(l.fields).toLowerCase().includes(q),
      );
    }
    const sorted = [...rows].sort((a, b) => b.tick - a.tick || b.ts - a.ts);
    // Live tail keeps the newest window; browsing shows the full filtered set.
    return liveTail ? sorted.slice(0, 150) : sorted.slice(0, 800);
  }, [state.logs, service, level, debouncedQuery, liveTail]);

  const counts = useMemo(() => {
    const base = state.logs.filter((l) => {
      if (service !== "all" && l.serviceId !== service) return false;
      const q = debouncedQuery.trim().toLowerCase();
      if (q && !l.message.toLowerCase().includes(q) && !JSON.stringify(l.fields).toLowerCase().includes(q))
        return false;
      return true;
    });
    const out: Record<string, number> = { all: base.length, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
    for (const l of base) out[l.level] = (out[l.level] ?? 0) + 1;
    return out;
  }, [state.logs, service, debouncedQuery]);

  const exportCsv = () => {
    const rows: Array<Array<string | number>> = [
      ["id", "tick", "timestamp_utc", "level", "service", "message", "trace_id", "fields"],
      ...filtered.map((l) => [
        l.id,
        l.tick,
        new Date(l.ts).toISOString(),
        l.level,
        l.serviceId,
        l.message,
        l.traceId ?? "",
        JSON.stringify(l.fields),
      ]),
    ];
    downloadTextFile(`blackbox-logs-${state.tick}.csv`, toCsv(rows), "text/csv");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Log Explorer"
        description="Search structured logs across every service — filter by level, service and full-text query, inspect fields, jump to traces, or export the current view as CSV."
        eyebrow={
          <Badge variant="secondary">
            <ScrollText className="h-3 w-3" /> {state.logs.length} in buffer
          </Badge>
        }
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-1.5">
              <Switch
                id="live-tail"
                checked={liveTail}
                onCheckedChange={setLiveTail}
                aria-label="Toggle live tail"
              />
              <Label htmlFor="live-tail" className="cursor-pointer text-xs text-foreground">
                {liveTail ? (
                  <span className="flex items-center gap-1 text-success">
                    <Play className="h-3 w-3" /> Live tail
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Pause className="h-3 w-3" /> Paused
                  </span>
                )}
              </Label>
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setParam("q", e.target.value);
            }}
            placeholder="Search message or fields…"
            className="pl-8 pr-8"
            aria-label="Search logs"
          />
          {query ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setQuery("");
                setParam("q", "");
              }}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <Select
          value={service}
          onValueChange={(v) => {
            setService(v);
            setParam("service", v);
          }}
        >
          <SelectTrigger className="w-48" aria-label="Filter by service">
            <SelectValue placeholder="All services" />
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

        <div className="flex flex-wrap items-center gap-1.5">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                setLevel(l);
                setParam("level", l);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                level === l
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border bg-panel text-muted-foreground hover:text-foreground",
              )}
            >
              {l}
              <span className="tabular opacity-70">{counts[l] ?? 0}</span>
            </button>
          ))}
        </div>

        {(service !== "all" || level !== "all" || query) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setService("all");
              setLevel("all");
              setQuery("");
              router.replace(pathname, { scroll: false });
            }}
          >
            <ListFilter className="h-3.5 w-3.5" /> Reset
          </Button>
        )}
      </div>

      {/* Results */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<ScrollText className="h-5 w-5" />}
                title="No logs match the current filters"
                description="Try a different level, service, or search term. New logs appear while the simulation runs."
              />
            </div>
          ) : (
            <div className="max-h-[calc(100vh-22rem)] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-panel">
                  <TableRow>
                    <TableHead className="w-40">Time (UTC)</TableHead>
                    <TableHead className="w-20">Level</TableHead>
                    <TableHead className="w-40">Service</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="w-16 text-right">Tick</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((l) => (
                    <TableRow
                      key={l.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(l)}
                      data-testid="log-row"
                    >
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {formatDateTime(l.ts, settings.timezone)}
                      </TableCell>
                      <TableCell>{levelBadge(l.level)}</TableCell>
                      <TableCell className="font-mono text-[11px]">{l.serviceId}</TableCell>
                      <TableCell className="max-w-0 truncate font-mono text-xs" title={l.message}>
                        {l.message}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
                        {l.tick}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Showing {filtered.length} of {counts.all} matching entries
        {liveTail ? " — live tail follows the newest 150" : ""}. Click a row to inspect fields.
      </p>

      <LogFieldsDialog entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export default function LogsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      }
    >
      <LogExplorerContent />
    </Suspense>
  );
}
