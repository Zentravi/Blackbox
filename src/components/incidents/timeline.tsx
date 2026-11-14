"use client";

import {
  Activity,
  CircleCheck,
  MessageSquare,
  RotateCcw,
  Search,
  Siren,
  TrendingUp,
  Wrench,
  Check,
} from "lucide-react";
import type { TimelineEvent, TimelineEventKind } from "@/simulation/types";
import { cn } from "@/lib/cn";
import { useSettings } from "@/state/settings-context";
import { formatClock } from "@/lib/format";

const KIND_STYLE: Record<
  TimelineEventKind,
  { icon: React.ComponentType<{ className?: string }>; color: string; label: string }
> = {
  triggered: { icon: Siren, color: "#ef4444", label: "Triggered" },
  escalated: { icon: TrendingUp, color: "#f97316", label: "Escalated" },
  acknowledged: { icon: Check, color: "#f59e0b", label: "Acknowledged" },
  investigating: { icon: Search, color: "#38bdf8", label: "Investigating" },
  note: { icon: MessageSquare, color: "#8494b3", label: "Note" },
  action: { icon: Wrench, color: "#22d3ee", label: "Action" },
  resolved: { icon: CircleCheck, color: "#22c55e", label: "Resolved" },
  auto_resolved: { icon: CircleCheck, color: "#22c55e", label: "Auto-resolved" },
  detected: { icon: Activity, color: "#a78bfa", label: "Detected" },
  relapsed: { icon: RotateCcw, color: "#ef4444", label: "Relapsed" },
};

interface TimelineProps {
  events: TimelineEvent[];
  className?: string;
}

export function IncidentTimeline({ events, className }: TimelineProps) {
  const { settings } = useSettings();
  return (
    <ol className={cn("relative space-y-0", className)}>
      {events.map((e, i) => {
        const style = KIND_STYLE[e.kind] ?? KIND_STYLE.note;
        const Icon = style.icon;
        const last = i === events.length - 1;
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!last ? <span className="absolute left-[11px] top-6 h-full w-px bg-border" /> : null}
            <span
              className="relative z-10 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border"
              style={{ borderColor: `${style.color}55`, backgroundColor: `${style.color}16` }}
            >
              <Icon className="h-3 w-3" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: style.color }}
                >
                  {style.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  T+{e.tick} · {formatClock(e.ts, settings.timezone)}
                </span>
                <span
                  className={cn(
                    "rounded px-1 py-px text-[9px] font-medium uppercase",
                    e.actor === "user"
                      ? "bg-primary/12 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {e.actor}
                </span>
              </div>
              <p className="mt-1 break-words text-xs leading-relaxed text-foreground/90">{e.message}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
