"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMounted } from "@/lib/hooks";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";

export interface SeriesDef {
  key: string;
  name: string;
  color: string;
  axis?: "left" | "right";
  type?: "line" | "area";
  dash?: boolean;
}

function TooltipPanel({
  active,
  payload,
  label,
  valueFormatters,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; color?: string; value?: number; dataKey?: string | number }>;
  label?: string | number;
  valueFormatters?: Record<string, (v: number) => string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 shadow-xl">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {typeof label === "number" ? formatClock(label, "utc", false) : label}
      </p>
      {payload.map((row, i) => {
        const fmt = valueFormatters?.[String(row.dataKey)];
        return (
          <p key={i} className="flex items-center gap-2 text-xs tabular">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} />
            <span className="text-muted-foreground">{row.name}</span>
            <span className="ml-auto font-medium text-foreground">
              {fmt && typeof row.value === "number" ? fmt(row.value) : row.value}
            </span>
          </p>
        );
      })}
    </div>
  );
}

export interface SeriesChartProps {
  data: Array<Record<string, number>>;
  series: SeriesDef[];
  height?: number;
  xKey?: string;
  /** Format values per dataKey inside the tooltip. */
  valueFormatters?: Record<string, (v: number) => string>;
  yFormatter?: (v: number) => string;
  rightFormatter?: (v: number) => string;
  showLegend?: boolean;
  /** Optional horizontal reference line on the left axis. */
  reference?: { y: number; label?: string; color?: string };
  /** Scatter markers (e.g. applied recovery actions) at data timestamps. */
  markers?: Array<{ x: number; y: number; color?: string; label?: string }>;
  className?: string;
}

export function SeriesChart({
  data,
  series,
  height = 220,
  xKey = "ts",
  valueFormatters,
  yFormatter,
  rightFormatter,
  showLegend = false,
  reference,
  markers,
  className,
}: SeriesChartProps) {
  const mounted = useMounted();
  if (!mounted) return <Skeleton className={cn("w-full", className)} style={{ height }} />;
  if (data.length === 0) return <Skeleton className={cn("w-full", className)} style={{ height }} />;

  const right = series.filter((s) => s.axis === "right");
  const hasRight = right.length > 0;
  const hasArea = series.some((s) => s.type === "area");
  const Chart = hasArea ? AreaChart : LineChart;

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 8, right: hasRight ? 8 : 12, bottom: 0, left: -14 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#17203a" vertical={false} />
          <XAxis
            dataKey={xKey}
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) => formatClock(v, "utc", false)}
            tickLine={false}
            axisLine={{ stroke: "#1c2740" }}
            minTickGap={48}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={yFormatter}
            tickLine={false}
            axisLine={false}
            width={46}
            tick={{ fill: "#6b7c9e", fontSize: 11 }}
          />
          {hasRight ? (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={rightFormatter}
              tickLine={false}
              axisLine={false}
              width={46}
              tick={{ fill: "#6b7c9e", fontSize: 11 }}
            />
          ) : null}
          <Tooltip
            content={<TooltipPanel valueFormatters={valueFormatters} />}
            cursor={{ stroke: "#2c3c60", strokeDasharray: "3 3" }}
          />
          {showLegend ? (
            <Legend
              iconType="circle"
              iconSize={7}
              wrapperStyle={{ fontSize: 11, color: "#8494b3", paddingTop: 6 }}
            />
          ) : null}
          {reference ? (
            <ReferenceLine
              yAxisId="left"
              y={reference.y}
              stroke={reference.color ?? "#f59e0b"}
              strokeDasharray="4 4"
              label={
                reference.label
                  ? { value: reference.label, position: "insideTopRight", fill: "#f59e0b", fontSize: 10 }
                  : undefined
              }
            />
          ) : null}
          {markers?.map((m, i) => (
            <ReferenceDot
              key={`marker-${i}`}
              yAxisId="left"
              x={m.x}
              y={m.y}
              r={4}
              fill={m.color ?? "#3d7dff"}
              stroke="#0c1322"
              strokeWidth={1.5}
              label={
                m.label
                  ? { value: m.label, position: "top", fill: m.color ?? "#3d7dff", fontSize: 9 }
                  : undefined
              }
            />
          ))}
          {series.map((s) => {
            const yAxisId = (s.axis ?? "left") === "right" ? "right" : "left";
            if (s.type === "area") {
              return (
                <Area
                  key={s.key}
                  yAxisId={yAxisId}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.08}
                  dot={false}
                  strokeDasharray={s.dash ? "5 4" : undefined}
                  isAnimationActive={false}
                />
              );
            }
            return (
              <Line
                key={s.key}
                yAxisId={yAxisId}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                strokeDasharray={s.dash ? "5 4" : undefined}
                activeDot={{ r: 3, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            );
          })}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}
