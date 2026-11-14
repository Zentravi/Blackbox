"use client";

import { useId } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { APP_NAME, APP_VERSION, NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { NAV_ICONS } from "./nav-icons";
import { useSimulation } from "@/state/simulation-context";

function NavGroups({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  // Instance-scoped so the desktop sidebar and mobile sheet copies never
  // register the same layoutId simultaneously.
  const indicatorId = useId();
  const groups = [...new Set(NAV_ITEMS.map((i) => i.group))];

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {groups.map((group) => {
        const items = NAV_ITEMS.filter((i) => i.group === group);
        return (
          <div key={group}>
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              {group}
            </p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = NAV_ICONS[item.icon];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                        active
                          ? "text-foreground"
                          : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId={`sidebar-active-${indicatorId}`}
                          aria-hidden
                          className="absolute inset-0 rounded-md bg-primary/12 shadow-[inset_2px_0_0_0_var(--primary)]"
                          transition={{ type: "spring", stiffness: 420, damping: 36 }}
                        />
                      ) : null}
                      <span className="relative flex min-w-0 items-center gap-2.5">
                        {Icon ? (
                          <Icon
                            className={cn(
                              "h-4 w-4 shrink-0 transition-colors",
                              active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                            )}
                          />
                        ) : null}
                        <span className="truncate">{item.label}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function SidebarFooter() {
  const { phase } = useSimulation();
  return (
    <div className="border-t border-sidebar-border px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full"
            style={{
              backgroundColor:
                phase.tone === "ok"
                  ? "#22c55e"
                  : phase.tone === "warn"
                    ? "#f59e0b"
                    : phase.tone === "info"
                      ? "#38bdf8"
                      : "#ef4444",
            }}
          />
          <span>
            Engine · <span className="text-foreground/80">{phase.label}</span>
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/70">v{APP_VERSION}</span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground/60">
        {APP_NAME} · deterministic simulation
      </p>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-4 py-4">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-[0_0_18px_-4px_rgba(61,125,255,0.7)]">
        <svg viewBox="0 0 16 16" className="h-4.5 w-4.5" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-sm font-bold tracking-[0.22em] text-foreground">BLACKBOX</span>
        <span className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Incident simulator
        </span>
      </span>
    </Link>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <Brand />
      <div className="px-3">
        <div className="h-px bg-sidebar-border" />
      </div>
      <NavGroups onNavigate={onNavigate} />
      <SidebarFooter />
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <SidebarContent />
    </aside>
  );
}
