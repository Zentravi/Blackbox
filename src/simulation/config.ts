/** Simulation-wide configuration constants. */

/** 1 simulated tick = 1 minute of wall-clock system time. */
export const TICK_MS = 60_000;

/** Fixed simulation epoch so timestamps are reproducible (2026-11-14 09:00 UTC). */
export const SIM_EPOCH_MS = Date.UTC(2026, 10, 14, 9, 0, 0);

/** Default rolling metric window (samples kept per service). */
export const DEFAULT_HISTORY_LIMIT = 120;

/** Default telemetry caps. */
export const DEFAULT_LOG_LIMIT = 1200;
export const DEFAULT_TRACE_LIMIT = 300;

/** Health score weights. */
export const HEALTH = {
  errorWeight: 140,
  latencyWeight: 12,
  downPenalty: 15,
  degradedPenalty: 5,
  saturationThreshold: 0.8,
  saturationPenalty: 50,
} as const;
