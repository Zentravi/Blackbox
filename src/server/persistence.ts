import type { Prisma } from "@/generated/prisma/client";
import { getDb, isDatabaseConfigured } from "./db";
import { isValidSimState } from "@/lib/snapshot";
import { getScenario } from "@/simulation/scenarios";
import type { SimState } from "@/simulation/types";

/**
 * PostgreSQL persistence for the simulation (Prisma + node-postgres driver).
 *
 * Two write modes:
 *  - `snapshot`: upsert the full SimState into SimulationState.payload (fast,
 *    exact restore — this is what powers reload/cross-device resume).
 *  - `full`: snapshot + transactional upsert of the normalised tables
 *    (services, dependencies, incidents, timeline, metrics, logs, traces,
 *    spans, recovery actions) so the data is queryable with plain SQL.
 */

const WORKSPACE_ID = "default";
/** Telemetry older than this many ticks behind the live tick is pruned. */
const TELEMETRY_RETENTION_TICKS = 1200;

export interface PersistenceStatus {
  configured: boolean;
  connected: boolean;
  tick?: number;
  scenarioId?: string;
  updatedAt?: string;
  error?: string;
}

export async function getStatus(): Promise<PersistenceStatus> {
  if (!isDatabaseConfigured()) return { configured: false, connected: false };
  const db = getDb();
  if (!db) return { configured: false, connected: false };
  try {
    const row = await db.simulationState.findUnique({ where: { id: WORKSPACE_ID } });
    return {
      configured: true,
      connected: true,
      tick: row?.tick,
      scenarioId: row?.scenarioId,
      updatedAt: row?.updatedAt.toISOString(),
    };
  } catch (err) {
    // Raw driver messages can expose hosts/ports — log, don't echo.
    console.error("[persistence/status] failed", err);
    return {
      configured: true,
      connected: false,
      error: "connection failed",
    };
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export type SaveMode = "snapshot" | "full";

export async function saveState(state: SimState, mode: SaveMode = "full"): Promise<{
  savedAt: string;
  tick: number;
  scenarioId: string;
  mode: SaveMode;
  skipped?: boolean;
}> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");

  if (mode === "snapshot") {
    // Snapshot saves are background telemetry (autosave / unload beacons) and
    // may arrive out of order — e.g. a pagehide beacon from a page that was
    // navigated away from can land after a newer manual "Save now". Reject
    // anything older than what is stored so it cannot roll the row back.
    // Full saves stay authoritative (they carry deliberate rewinds like
    // scenario resets and loads).
    const existing = await db.simulationState.findUnique({
      where: { id: WORKSPACE_ID },
      select: { tick: true },
    });
    if (existing && state.tick < existing.tick) {
      return {
        savedAt: new Date().toISOString(),
        tick: existing.tick,
        scenarioId: state.scenarioId,
        mode,
        skipped: true,
      };
    }
  }

  const payload = json(state);
  // PrismaPromises are lazy until awaited, so this op can either run alone
  // (snapshot mode) or join the normalised-write batch transaction (full
  // mode) — keeping snapshot + telemetry rows atomic in both cases.
  const snapshotOp = db.simulationState.upsert({
    where: { id: WORKSPACE_ID },
    create: {
      id: WORKSPACE_ID,
      tick: state.tick,
      scenarioId: state.scenarioId,
      health: state.health,
      payload,
    },
    update: {
      tick: state.tick,
      scenarioId: state.scenarioId,
      health: state.health,
      payload,
      updatedAt: new Date(),
    },
  });

  if (mode === "full") {
    await syncNormalized(db, state, snapshotOp);
  } else {
    await snapshotOp;
  }

  return {
    savedAt: new Date().toISOString(),
    tick: state.tick,
    scenarioId: state.scenarioId,
    mode,
  };
}

async function syncNormalized(
  db: NonNullable<ReturnType<typeof getDb>>,
  state: SimState,
  snapshotOp: ReturnType<NonNullable<ReturnType<typeof getDb>>["simulationState"]["upsert"]>,
) {
  const scenario = getScenario(state.scenarioId);
  const cutoff = state.tick - TELEMETRY_RETENTION_TICKS;

  const incidentOps = state.incidents.map((inc) =>
    db.incident.upsert({
      where: { id: inc.id },
      create: {
        id: inc.id,
        workspaceId: WORKSPACE_ID,
        scenarioId: inc.scenarioId,
        number: inc.number,
        triggerId: inc.triggerId,
        title: inc.title,
        description: inc.description,
        severity: inc.severity.toUpperCase() as "SEV1" | "SEV2" | "SEV3",
        status: inc.status.toUpperCase() as "TRIGGERED" | "ACKNOWLEDGED" | "INVESTIGATING" | "RESOLVED",
        openedTick: inc.openedTick,
        openedAt: new Date(inc.openedTs),
        resolvedTick: inc.resolvedTick ?? null,
        resolvedAt: inc.resolvedTs != null ? new Date(inc.resolvedTs) : null,
        resolution: inc.resolution ?? null,
        rootCauseHypothesisId: inc.rootCause?.hypothesisId ?? null,
        rootCauseTitle: inc.rootCause?.title ?? null,
        rootCauseConfidence: inc.rootCause?.confidence ?? null,
      },
      update: {
        title: inc.title,
        severity: inc.severity.toUpperCase() as "SEV1" | "SEV2" | "SEV3",
        status: inc.status.toUpperCase() as "TRIGGERED" | "ACKNOWLEDGED" | "INVESTIGATING" | "RESOLVED",
        resolvedTick: inc.resolvedTick ?? null,
        resolvedAt: inc.resolvedTs != null ? new Date(inc.resolvedTs) : null,
        resolution: inc.resolution ?? null,
        rootCauseHypothesisId: inc.rootCause?.hypothesisId ?? null,
        rootCauseTitle: inc.rootCause?.title ?? null,
        rootCauseConfidence: inc.rootCause?.confidence ?? null,
      },
    }),
  );

  const timelineOps = state.incidents.flatMap((inc) =>
    inc.timeline.map((ev) =>
      db.timelineEvent.upsert({
        where: { id: ev.id },
        create: {
          id: ev.id,
          incidentId: inc.id,
          tick: ev.tick,
          ts: new Date(ev.ts),
          kind: ev.kind,
          actor: ev.actor,
          message: ev.message,
        },
        update: { message: ev.message, tick: ev.tick, ts: new Date(ev.ts) },
      }),
    ),
  );

  const incidentServiceOps = state.incidents.flatMap((inc) =>
    inc.serviceIds.map((serviceId) =>
      db.incidentService.upsert({
        where: { incidentId_serviceId: { incidentId: inc.id, serviceId } },
        create: { incidentId: inc.id, serviceId },
        update: {},
      }),
    ),
  );

  const actionOps = state.actions.map((a) =>
    db.recoveryAction.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        incidentId: null,
        actionId: a.actionId,
        name: a.name,
        tick: a.tick,
        appliedAt: new Date(a.ts),
        notes: a.notes,
        rolledBack: a.rolledBack,
        rolledBackTick: a.rolledBackTick ?? null,
        faultBefore: json(a.faultBefore),
        kpiBefore: json(a.kpiBefore),
        kpiAfter: json(a.kpiAfter),
      },
      update: {
        notes: a.notes,
        rolledBack: a.rolledBack,
        rolledBackTick: a.rolledBackTick ?? null,
        kpiAfter: json(a.kpiAfter),
      },
    }),
  );

  const serviceOps = scenario.services.map((def) => {
    const rt = state.services[def.id];
    return db.service.upsert({
      where: { id: def.id },
      create: {
        id: def.id,
        workspaceId: WORKSPACE_ID,
        name: def.name,
        kind: def.kind,
        team: def.team,
        runtime: def.runtime,
        description: def.description,
        tier: def.tier,
        posX: def.pos.x,
        posY: def.pos.y,
        baselineCpu: def.baseline.cpuPct,
        baselineMem: def.baseline.memPct,
        baselineRps: def.baseline.rps,
        baselineP95: def.baseline.latencyP95Ms,
        baselineErr: def.baseline.errorRate,
        slo: def.slo,
        status: (rt?.status ?? "healthy").toUpperCase() as "HEALTHY" | "DEGRADED" | "CRITICAL" | "DOWN",
      },
      update: {
        status: (rt?.status ?? "healthy").toUpperCase() as "HEALTHY" | "DEGRADED" | "CRITICAL" | "DOWN",
      },
    });
  });

  const dependencyOps = scenario.edges.map((e) =>
    db.dependency.upsert({
      where: {
        workspaceId_sourceId_targetId: {
          workspaceId: WORKSPACE_ID,
          sourceId: e.source,
          targetId: e.target,
        },
      },
      create: {
        id: e.id,
        workspaceId: WORKSPACE_ID,
        sourceId: e.source,
        targetId: e.target,
        protocol: e.protocol,
        label: e.label ?? null,
      },
      update: {},
    }),
  );

  const metricOps: Prisma.PrismaPromise<unknown>[] = [];
  for (const [serviceId, samples] of Object.entries(state.metrics)) {
    for (const s of samples) {
      if (s.t < cutoff) continue;
      metricOps.push(
        db.metricSample.upsert({
          where: { serviceId_tick: { serviceId, tick: s.t } },
          create: {
            id: `${serviceId}:${s.t}`,
            serviceId,
            tick: s.t,
            ts: new Date(s.ts),
            cpuPct: s.cpuPct,
            memPct: s.memPct,
            rps: s.rps,
            latencyP95Ms: s.latencyP95Ms,
            errorRate: s.errorRate,
            saturation: s.saturation,
          },
          update: {
            cpuPct: s.cpuPct,
            memPct: s.memPct,
            rps: s.rps,
            latencyP95Ms: s.latencyP95Ms,
            errorRate: s.errorRate,
            saturation: s.saturation,
          },
        }),
      );
    }
  }

  const logOps = state.logs
    .filter((l) => l.tick >= cutoff)
    .map((l) =>
      db.logEntry.upsert({
        where: { id: l.id },
        create: {
          id: l.id,
          tick: l.tick,
          ts: new Date(l.ts),
          level: l.level.toUpperCase() as "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL",
          serviceId: l.serviceId,
          message: l.message,
          traceId: l.traceId ?? null,
          fields: json(l.fields),
        },
        update: { message: l.message, fields: json(l.fields) },
      }),
    );

  const traceAndSpanOps: Prisma.PrismaPromise<unknown>[] = [];
  for (const t of state.traces) {
    if (t.tick < cutoff) continue;
    traceAndSpanOps.push(
      db.trace.upsert({
        where: { id: t.id },
        create: {
          id: t.id,
          tick: t.tick,
          ts: new Date(t.ts),
          route: t.rootName,
          entryServiceId: t.entryServiceId,
          durationMs: t.durationMs,
          status: t.status,
        },
        update: { durationMs: t.durationMs, status: t.status },
      }),
    );
    for (const sp of t.spans) {
      traceAndSpanOps.push(
        db.span.upsert({
          where: { id: sp.id },
          create: {
            id: sp.id,
            traceId: t.id,
            serviceId: sp.serviceId,
            parentId: sp.parentId ?? null,
            name: sp.name,
            kind: sp.kind,
            startMs: sp.startMs,
            durationMs: sp.durationMs,
            status: sp.status,
            attributes: json(sp.attributes ?? {}),
          },
          update: { durationMs: sp.durationMs, status: sp.status },
        }),
      );
    }
  }

  const pruneOps = [
    db.metricSample.deleteMany({ where: { tick: { lt: cutoff } } }),
    db.logEntry.deleteMany({ where: { tick: { lt: cutoff } } }),
    // Child spans must go before their traces (Span_trace_id_fkey) — deleting
    // traces first aborts the whole batch with a foreign-key violation.
    db.span.deleteMany({ where: { trace: { tick: { lt: cutoff } } } }),
    db.trace.deleteMany({ where: { tick: { lt: cutoff } } }),
  ];

  await db.$transaction(
    [
      snapshotOp,
      ...serviceOps,
      ...dependencyOps,
      ...incidentOps,
      ...timelineOps,
      ...incidentServiceOps,
      ...actionOps,
      ...metricOps,
      ...logOps,
      ...traceAndSpanOps,
      ...pruneOps,
    ],
    // Full saves batch thousands of telemetry upserts; the default 5 s
    // interactive-transaction timeout aborts on slower hosts right when the
    // write is about to succeed. 30 s keeps the atomicity guarantee intact.
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/** Load the persisted snapshot; returns null when absent or invalid. */
export async function loadState(): Promise<SimState | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const row = await db.simulationState.findUnique({ where: { id: WORKSPACE_ID } });
    if (!row) return null;
    const parsed: unknown = JSON.parse(JSON.stringify(row.payload));
    return isValidSimState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Remove the persisted snapshot (and its normalised rows). */
export async function clearState(): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.$transaction(
    [
      db.simulationState.deleteMany({ where: { id: WORKSPACE_ID } }),
      db.span.deleteMany({}),
      db.trace.deleteMany({}),
      db.logEntry.deleteMany({}),
      db.metricSample.deleteMany({}),
      db.timelineEvent.deleteMany({}),
      db.incidentService.deleteMany({}),
      db.incident.deleteMany({ where: { workspaceId: WORKSPACE_ID } }),
      db.recoveryAction.deleteMany({}),
    ],
    // Unfiltered telemetry deletes can take a while on a full workspace.
    { maxWait: 10_000, timeout: 30_000 },
  );
}
