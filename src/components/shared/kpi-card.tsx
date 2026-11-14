import * as React from "react";
import { cn } from "@/lib/cn";
import { Card, CardContent } from "@/components/ui/card";

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

export function KpiCard({ label, value, sub, icon, trendTone, children, className }: KpiCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <div className="kpi-value mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-foreground">{value}</span>
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
