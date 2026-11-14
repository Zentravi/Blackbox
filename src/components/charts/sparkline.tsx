"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { useMounted } from "@/lib/hooks";
import { cn } from "@/lib/cn";

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  className?: string;
}

export function Sparkline({ data, color = "#3d7dff", height = 32, className }: SparklineProps) {
  const mounted = useMounted();
  if (!mounted || data.length < 2) {
    return <div className={cn("w-full", className)} style={{ height }} aria-hidden />;
  }
  const points = data.map((v, i) => ({ i, v }));
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={color}
            fillOpacity={0.1}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
