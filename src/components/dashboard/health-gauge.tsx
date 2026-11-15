"use client";

import { cn } from "@/lib/cn";

interface HealthGaugeProps {
  value: number;
  size?: number;
  className?: string;
}

function toneFor(value: number): { color: string; className: string } {
  if (value >= 90) return { color: "#22c55e", className: "text-success" };
  if (value >= 70) return { color: "#f59e0b", className: "text-warning" };
  if (value >= 40) return { color: "#f97316", className: "text-danger" };
  return { color: "#ef4444", className: "text-destructive" };
}

/** Semicircular health gauge rendered as a pure SVG arc (SSR-safe). */
export function HealthGauge({ value, size = 132, className }: HealthGaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const stroke = 9;
  const r = size / 2 - stroke;
  const cx = size / 2;
  const cy = size / 2 + 6;
  // Semicircle from 180° to 360° (top half).
  const arcLen = Math.PI * r;
  const dash = (clamped / 100) * arcLen;
  const tone = toneFor(clamped);

  return (
    <div className={cn("relative inline-flex flex-col items-center", className)} style={{ width: size }}>
      <svg width={size} height={size / 2 + 14} viewBox={`0 0 ${size} ${size / 2 + 14}`} aria-hidden>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="#17203a"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={tone.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${arcLen}`}
          style={{ transition: "stroke-dasharray 400ms ease" }}
        />
      </svg>
      <div className="-mt-9 flex flex-col items-center">
        <span className={cn("kpi-value text-3xl font-bold", tone.className)}>
          {clamped.toFixed(0)}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          health score
        </span>
      </div>
    </div>
  );
}
