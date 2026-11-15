import { z } from "zod";

/**
 * Zod schemas for the BLACKBOX data layer.
 *
 * These mirror the PostgreSQL tables in `prisma/schema.prisma` and define the
 * contract every repository implementation must satisfy (see
 * `src/data/repository.ts` and `docs/database.md`). The shipped runtime uses
 * the in-memory implementation fed by the simulation engine; the same schemas
 * validate exported workspace snapshots.
 */

export const HealthStatusSchema = z.enum(["healthy", "degraded", "critical", "down"]);
export const SeveritySchema = z.enum(["sev1", "sev2", "sev3"]);
export const IncidentStatusSchema = z.enum(["triggered", "acknowledged", "investigating", "resolved"]);
export const LogLevelSchema = z.enum(["debug", "info", "warn", "error", "fatal"]);

export const ServiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["edge", "gateway", "service", "data", "cache", "external"]),
  team: z.string(),
  runtime: z.string(),
  tier: z.number().int().nonnegative(),
  slo: z.number().min(0).max(1),
  status: HealthStatusSchema,
});

export const MetricSampleSchema = z.object({
  t: z.number().int(),
  ts: z.number().int(),
  cpuPct: z.number().min(0).max(100),
  memPct: z.number().min(0).max(100),
  rps: z.number().min(0),
  latencyP95Ms: z.number().min(0),
  errorRate: z.number().min(0).max(1),
  saturation: z.number().min(0).max(1),
});

export const LogEntrySchema = z.object({
  id: z.string(),
  tick: z.number().int(),
  ts: z.number().int(),
  level: LogLevelSchema,
  serviceId: z.string(),
  message: z.string(),
  traceId: z.string().optional(),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export const TimelineEventSchema = z.object({
  id: z.string(),
  tick: z.number().int(),
  ts: z.number().int(),
  kind: z.enum([
    "triggered",
    "escalated",
    "acknowledged",
    "investigating",
    "note",
    "action",
    "resolved",
    "auto_resolved",
    "detected",
    "relapsed",
  ]),
  actor: z.enum(["system", "user"]),
  message: z.string(),
});

export const IncidentSchema = z.object({
  id: z.string(),
  scenarioId: z.string(),
  number: z.string().regex(/^INC-\d+$/),
  title: z.string().min(1),
  severity: SeveritySchema,
  status: IncidentStatusSchema,
  serviceIds: z.array(z.string()),
  openedTick: z.number().int(),
  openedTs: z.number().int(),
  resolvedTick: z.number().int().optional(),
  resolvedTs: z.number().int().optional(),
  timeline: z.array(TimelineEventSchema),
  resolution: z.string().optional(),
});

export const KpiSnapshotSchema = z.object({
  tick: z.number().int(),
  health: z.number().min(0).max(100),
  errorRate: z.number().min(0).max(1),
  latencyP95Ms: z.number().min(0),
  availability: z.number().min(0).max(1),
  downServices: z.number().int().nonnegative(),
  degradedServices: z.number().int().nonnegative(),
});

/** Shape written by the workspace exporter (Settings → Data & reset). */
export const WorkspaceSnapshotSchema = z.object({
  app: z.literal("BLACKBOX"),
  version: z.string(),
  exportedAtTick: z.number().int(),
  settings: z.object({
    workspaceName: z.string(),
    environment: z.enum(["production", "staging", "development"]),
    timezone: z.enum(["utc", "local"]),
    density: z.enum(["comfortable", "compact"]),
    defaultSpeed: z.number(),
    autoStart: z.boolean(),
    historyWindow: z.number().int(),
    logCap: z.number().int(),
  }),
  simulation: z.object({
    scenarioId: z.string(),
    seed: z.number().int(),
    health: z.number(),
    tick: z.number().int(),
    incidents: z.array(IncidentSchema),
    healthSeries: z.array(
      z.object({ t: z.number().int(), ts: z.number().int(), health: z.number() }),
    ),
  }),
});

export type ServiceRecord = z.infer<typeof ServiceSchema>;
export type MetricSampleRecord = z.infer<typeof MetricSampleSchema>;
export type LogEntryRecord = z.infer<typeof LogEntrySchema>;
export type IncidentRecord = z.infer<typeof IncidentSchema>;
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;

/** Parse an exported workspace snapshot; returns null when invalid. */
export function parseWorkspaceSnapshot(json: string): WorkspaceSnapshot | null {
  try {
    const parsed = WorkspaceSnapshotSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
