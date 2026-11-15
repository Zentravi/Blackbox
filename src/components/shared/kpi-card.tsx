"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { Card, CardContent } from "@/components/ui/card";
import { EASE_STANDARD, MOTION } from "@/lib/motion";

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  trend?: "up" | "down" | "flat";
  trendTone?: "good" | "bad" | "neutral";
  children?: React.ReactNode;
  className?: string;
}

/**
 * Animated KPI card: primitive values swap through an AnimatePresence
 * (popLayout) so metric updates read as motion without ever shifting the
 * grid — non-primitive values render statically.
 */
export function KpiCard({ label, value, sub, icon, trendTone, children, className }: KpiCardProps) {
  const primitiveValue =
    typeof value === "string" || typeof value === "number" ? String(value) : null;

  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <div className="kpi-value mt-1.5 flex items-baseline gap-2">
              {primitiveValue === null ? (
                <span className="text-2xl font-semibold text-foreground">{value}</span>
              ) : (
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={primitiveValue}
                    className="text-2xl font-semibold text-foreground"
                    initial={{ opacity: 0, y: 9 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -9 }}
                    transition={{ duration: MOTION.instant, ease: EASE_STANDARD }}
                  >
                    {value}
                  </motion.span>
                </AnimatePresence>
              )}
              {sub ? (
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    trendTone === "good" && "text-success",
                    trendTone === "bad" && "text-destructive",
                    (!trendTone || trendTone === "neutral") && "text-muted-foreground",
                  )}
                >
                  {sub}
                </span>
              ) : null}
            </div>
          </div>
          {icon ? (
            <div className="rounded-md border border-border bg-panel-2 p-2 text-muted-foreground">{icon}</div>
          ) : null}
        </div>
        {children ? <div className="mt-3">{children}</div> : null}
      </CardContent>
    </Card>
  );
}
