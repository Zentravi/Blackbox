"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  Menu,
  Pause,
  Play,
  RotateCcw,
  Siren,
  Zap,
} from "lucide-react";
import { NAV_ITEMS } from "@/lib/constants";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useSimulation } from "@/state/simulation-context";
import { useSettings } from "@/state/settings-context";
import { getScenario, SCENARIO_LIST } from "@/simulation/scenarios";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarContent } from "./sidebar";
import { activeIncidents } from "@/data/selectors";

function pageTitle(pathname: string): string {
  const match =
    NAV_ITEMS.find((n) => pathname === n.href) ??
    NAV_ITEMS.find((n) => pathname.startsWith(`${n.href}/`));
  return match?.label ?? "Dashboard";
}

function healthTone(health: number): string {
  if (health >= 90) return "text-success";
  if (health >= 70) return "text-warning";
  if (health >= 40) return "text-danger";
  return "text-destructive";
}

function SimControls() {
  const { running, setRunning, speed, setSpeed, tickOnce, reset, state } = useSimulation();
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <>
      <div className="panel-subtle flex h-9 items-center gap-0.5 px-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={running ? "Pause simulation" : "Play simulation"}
          title={running ? "Pause" : "Play"}
          onClick={() => setRunning(!running)}
          className="h-7 w-7"
        >
          {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Advance one tick"
          title="Step +1 tick"
          onClick={tickOnce}
          className="h-7 w-7"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
          <SelectTrigger
            className="h-7 w-14 border-0 bg-transparent px-1.5 text-xs focus:ring-0"
            aria-label="Simulation speed"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0.5">0.5×</SelectItem>
            <SelectItem value="1">1×</SelectItem>
            <SelectItem value="2">2×</SelectItem>
            <SelectItem value="4">4×</SelectItem>
          </SelectContent>
        </Select>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reset scenario"
          title="Reset scenario"
          onClick={() => setResetOpen(true)}
          className="h-7 w-7"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset {getScenario(state.scenarioId).name}?</DialogTitle>
            <DialogDescription>
              The scenario returns to its initial snapshot: applied recovery actions, incident
              progress and the current run&rsquo;s timeline entries are discarded. Deterministic
              history is rebuilt from the same seed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                reset();
                setResetOpen(false);
              }}
            >
              Reset scenario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScenarioSwitcher() {
  const { state, loadScenario } = useSimulation();
  const [pending, setPending] = useState<string | null>(null);
  const current = getScenario(state.scenarioId);

  const pendingScenario = pending ? getScenario(pending as never) : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="max-w-[15rem] gap-1.5">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="truncate">{current.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Switch scenario</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {SCENARIO_LIST.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onSelect={() => {
                if (s.id !== state.scenarioId) setPending(s.id);
              }}
              className={cn("flex flex-col items-start gap-0.5 py-2", s.id === state.scenarioId && "bg-accent/70")}
            >
              <span className="flex w-full items-center justify-between gap-2 text-xs font-medium text-foreground">
                {s.name}
                {s.id === state.scenarioId ? <span className="text-[10px] text-primary">ACTIVE</span> : null}
              </span>
              <span className="text-[11px] leading-snug text-muted-foreground">{s.tagline}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load {pendingScenario?.name}?</DialogTitle>
            <DialogDescription>
              This replaces the active simulation. Progress from the current scenario stays in
              Reports; the new scenario starts from its deterministic warm-up snapshot.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pending) loadScenario(pending as never);
                setPending(null);
              }}
            >
              Load scenario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Topbar() {
  const pathname = usePathname();
  const { state, running, phase } = useSimulation();
  const { settings } = useSettings();
  const [navOpen, setNavOpen] = useState(false);
  const open = activeIncidents(state, state.scenarioId);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-md sm:px-4">
      {/* Mobile nav */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation">
            <Menu className="h-4.5 w-4.5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="truncate text-sm font-semibold text-foreground">{pageTitle(pathname)}</h2>
        <span
          className={cn(
            "hidden items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:inline-flex",
            running
              ? "border-success/40 bg-success/10 text-success"
              : "border-warning/40 bg-warning/10 text-warning",
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", running ? "animate-pulse bg-success" : "bg-warning")} />
          {running ? "Live" : "Paused"}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-md border border-border bg-panel px-2.5 py-1.5 md:flex">
          <span className="font-mono text-xs tabular text-foreground">
            {formatClock(state.simTimeMs, settings.timezone, false)}
          </span>
          <span className="text-[10px] font-medium text-muted-foreground">T+{state.tick}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              phase.tone === "ok" && "bg-success/12 text-success",
              phase.tone === "warn" && "bg-warning/12 text-warning",
              phase.tone === "info" && "bg-info/12 text-info",
              phase.tone === "bad" && "bg-destructive/15 text-destructive",
            )}
          >
            {phase.label}
          </span>
        </div>

        <div
          className={cn(
            "hidden items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 sm:flex",
          )}
          title="System health score"
        >
          <span className={cn("text-xs font-bold tabular", healthTone(state.health))}>
            {state.health.toFixed(0)}%
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">health</span>
        </div>

        <Link
          href="/incidents"
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
            open.length > 0
              ? "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/15"
              : "border-border bg-panel text-muted-foreground hover:text-foreground",
          )}
          title="Active incidents"
        >
          <Siren className="h-3.5 w-3.5" />
          <span className="tabular">{open.length}</span>
        </Link>

        <div className="hidden xl:block">
          <ScenarioSwitcher />
        </div>
        <SimControls />
      </div>
    </header>
  );
}
