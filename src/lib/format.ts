/** Formatting helpers shared across the UI. */

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** Format a 0..1 ratio as a percentage. */
export function formatPct(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

export function formatRps(n: number): string {
  return `${formatNumber(n)} rps`;
}

export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

type Timezone = "utc" | "local";

const dtFormatters = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: Timezone, withSeconds: boolean): Intl.DateTimeFormat {
  const key = `${timezone}:${withSeconds}`;
  let f = dtFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
      hour12: false,
      timeZone: timezone === "utc" ? "UTC" : undefined,
    });
    dtFormatters.set(key, f);
  }
  return f;
}

export function formatClock(ts: number, timezone: Timezone = "utc", withSeconds = true): string {
  return getFormatter(timezone, withSeconds).format(new Date(ts));
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(timezone: Timezone): Intl.DateTimeFormat {
  let f = dateFormatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone === "utc" ? "UTC" : undefined,
    });
    dateFormatters.set(timezone, f);
  }
  return f;
}

export function formatDateTime(ts: number, timezone: Timezone = "utc"): string {
  return getDateFormatter(timezone).format(new Date(ts));
}

/** Duration expressed in ticks (1 tick = 1 minute). */
export function formatTickDuration(ticks: number): string {
  if (ticks < 1) return "0m";
  if (ticks < 60) return `${ticks}m`;
  const h = Math.floor(ticks / 60);
  const m = ticks % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatDurationMs(ms: number): string {
  return formatTickDuration(Math.round(ms / 60_000));
}

export function shortId(id: string, len = 8): string {
  return id.length <= len ? id : id.slice(0, len);
}

export function deltaLabel(before: number, after: number, opts?: { invert?: boolean; unit?: string; digits?: number }): string {
  const digits = opts?.digits ?? 1;
  const diff = after - before;
  const sign = diff > 0 ? "+" : "";
  const unit = opts?.unit ?? "";
  return `${sign}${diff.toFixed(digits)}${unit}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
