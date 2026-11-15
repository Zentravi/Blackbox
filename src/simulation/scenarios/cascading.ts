import type {
  ServiceDef,
  ImpactTarget,
  ScenarioDefinition,
  ScenarioEvent,
  CascadingFault,
} from "../types";
import { clamp01 } from "../rng";

/* ------------------------------------------------------------------ */
/* Topology                                                             */
/* ------------------------------------------------------------------ */

const services: ServiceDef[] = [
  {
    id: "edge-gateway",
    name: "edge-gateway",
    kind: "edge",
    team: "Team Platform",
    runtime: "Envoy 1.31",
    description: "Public entry point — surfaces any upstream outage to clients.",
    tier: 0,
    pos: { x: 0, y: 340 },
    baseline: { cpuPct: 37, memPct: 43, rps: 1900, latencyP95Ms: 48, errorRate: 0.002 },
    slo: 0.999,
  },
  {
    id: "api-gateway",
    name: "api-gateway",
    kind: "gateway",
    team: "Team Platform",
    runtime: "Go 1.24",
    description: "Sessions are verified against auth-service on every request.",
    tier: 1,
    pos: { x: 300, y: 340 },
    baseline: { cpuPct: 45, memPct: 55, rps: 1880, latencyP95Ms: 200, errorRate: 0.004 },
    slo: 0.995,
  },
  {
    id: "auth-service",
    name: "auth-service",
    kind: "service",
    team: "Team Identity",
    runtime: "Node 22",
    description: "Session issuing & token validation — every core service calls it per request.",
    tier: 2,
    pos: { x: 640, y: 340 },
    baseline: { cpuPct: 32, memPct: 49, rps: 1200, latencyP95Ms: 55, errorRate: 0.001 },
    slo: 0.999,
  },
  {
    id: "orders-service",
    name: "orders-service",
    kind: "service",
    team: "Team Commerce",
    runtime: "Java 21",
    description: "Order flows — validates session tokens with auth-service.",
    tier: 2,
    pos: { x: 640, y: 60 },
    baseline: { cpuPct: 40, memPct: 52, rps: 380, latencyP95Ms: 230, errorRate: 0.003 },
    slo: 0.995,
  },
  {
    id: "payments-service",
    name: "payments-service",
    kind: "service",
    team: "Team Payments",
    runtime: "Go 1.24",
    description: "Payment authorization — requires a validated auth context.",
    tier: 2,
    pos: { x: 640, y: 190 },
    baseline: { cpuPct: 29, memPct: 47, rps: 240, latencyP95Ms: 390, errorRate: 0.006 },
    slo: 0.999,
  },
  {
    id: "search-service",
    name: "search-service",
    kind: "service",
    team: "Team Discovery",
    runtime: "Rust 1.83",
    description: "Product search — token-checked before serving results.",
    tier: 2,
    pos: { x: 640, y: 500 },
    baseline: { cpuPct: 43, memPct: 54, rps: 620, latencyP95Ms: 180, errorRate: 0.002 },
    slo: 0.99,
  },
  {
    id: "notifications-service",
    name: "notifications-service",
    kind: "service",
    team: "Team Messaging",
    runtime: "Python 3.13",
    description: "Push/email delivery — token-checked on enqueue.",
    tier: 2,
    pos: { x: 640, y: 640 },
    baseline: { cpuPct: 24, memPct: 42, rps: 130, latencyP95Ms: 300, errorRate: 0.004 },
    slo: 0.99,
  },
  {
    id: "redis-cache",
    name: "redis-cache",
    kind: "cache",
    team: "Data Platform",
    runtime: "Redis 7.2",
    description: "Session store for auth-service (stays up — auth stops reading it).",
    tier: 3,
    pos: { x: 980, y: 240 },
    baseline: { cpuPct: 34, memPct: 60, rps: 2600, latencyP95Ms: 4, errorRate: 0.0005 },
    slo: 0.999,
  },
  {
    id: "postgres-primary",
    name: "postgres-primary",
    kind: "data",
    team: "Data Platform",
    runtime: "PostgreSQL 16",
    description: "Primary database — remains healthy during the compute-tier outage.",
    tier: 3,
    pos: { x: 980, y: 450 },
    baseline: { cpuPct: 47, memPct: 63, rps: 1500, latencyP95Ms: 13, errorRate: 0.001 },
    slo: 0.999,
  },
];

const edges = [
  { id: "e-edge-api", source: "edge-gateway", target: "api-gateway", protocol: "HTTPS" as const },
  { id: "e-api-auth", source: "api-gateway", target: "auth-service", protocol: "gRPC" as const, label: "sessions" },
  { id: "e-api-orders", source: "api-gateway", target: "orders-service", protocol: "gRPC" as const },
  { id: "e-api-payments", source: "api-gateway", target: "payments-service", protocol: "gRPC" as const },
  { id: "e-api-search", source: "api-gateway", target: "search-service", protocol: "gRPC" as const },
  { id: "e-api-notif", source: "api-gateway", target: "notifications-service", protocol: "AMQP" as const },
  { id: "e-orders-auth", source: "orders-service", target: "auth-service", protocol: "gRPC" as const, label: "token check" },
  { id: "e-payments-auth", source: "payments-service", target: "auth-service", protocol: "gRPC" as const, label: "token check" },
  { id: "e-search-auth", source: "search-service", target: "auth-service", protocol: "gRPC" as const, label: "token check" },
  { id: "e-notif-auth", source: "notifications-service", target: "auth-service", protocol: "gRPC" as const, label: "token check" },
  { id: "e-auth-redis", source: "auth-service", target: "redis-cache", protocol: "TCP" as const, label: "sessions" },
  { id: "e-auth-pg", source: "auth-service", target: "postgres-primary", protocol: "SQL" as const },
  { id: "e-orders-pg", source: "orders-service", target: "postgres-primary", protocol: "SQL" as const },
  { id: "e-payments-pg", source: "payments-service", target: "postgres-primary", protocol: "SQL" as const },
  { id: "e-search-pg", source: "search-service", target: "postgres-primary", protocol: "SQL" as const },
  { id: "e-notif-redis", source: "notifications-service", target: "redis-cache", protocol: "TCP" as const },
];

const tracePaths = [
  ["edge-gateway", "api-gateway", "auth-service", "redis-cache"],
  ["edge-gateway", "api-gateway", "orders-service", "auth-service"],
  ["edge-gateway", "api-gateway", "payments-service", "auth-service"],
  ["edge-gateway", "api-gateway", "search-service", "postgres-primary"],
  ["edge-gateway", "api-gateway", "notifications-service", "redis-cache"],
];

/* ------------------------------------------------------------------ */
/* Propagation model                                                     */
/* ------------------------------------------------------------------ */

/**
 * Distance of every service from the failure origin measured along the
 * "depends on auth" direction: dist0 = auth itself, dist 1 = direct
 * callers (they fail token checks), dist 2 = the edge. Data stores are
 * dependencies of auth, not dependents, so they are never impacted.
 */
const dependentDist: Record<string, number> = (() => {
  const dependents = new Map<string, string[]>();
  for (const e of edges) {
    const list = dependents.get(e.target) ?? [];
    list.push(e.source);
    dependents.set(e.target, list);
  }
  const dist: Record<string, number> = { "auth-service": 0 };
  const queue = ["auth-service"];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const src of dependents.get(cur) ?? []) {
      if (dist[src] === undefined) {
        dist[src] = dist[cur] + 1;
        queue.push(src);
      }
    }
  }
  return dist;
})();

interface AuthState {
  authDown: boolean;
  /** Auth's own impact ratio (1 = fully down, 0 = healthy). */
  authR: number;
  /** True on the tick the (re)crash happened. */
  justCrashed: boolean;
  justRelapsed: boolean;
}

function resolveAuth(f: CascadingFault, tick: number): AuthState {
  if (f.downSinceTick === null) {
    return { authDown: false, authR: 0, justCrashed: false, justRelapsed: false };
  }
  const justCrashed = f.downSinceTick === tick;
  if (f.upAtTick !== null) {
    // Process restarted — it is up immediately, metrics settle over one tick.
    return {
      authDown: false,
      authR: tick <= f.upAtTick ? 0.2 : 0,
      justCrashed: false,
      justRelapsed: false,
    };
  }
  return { authDown: true, authR: 1, justCrashed, justRelapsed: false };
}

/**
 * Impact ratio for a service at the given hop distance from the origin.
 * While auth is down the wave ramps outward; after a restart downstream
 * services recover over the following 3 ticks.
 */
function impactFor(dist: number, tick: number, f: CascadingFault): number {
  if (f.downSinceTick === null) return 0;
  const start = f.downSinceTick + dist * 2;
  const ramp = clamp01((tick - start) / 6);
  if (f.upAtTick === null) return ramp;
  const rampAtRecovery = clamp01((f.upAtTick - start) / 6);
  const decay = Math.max(0, 1 - (tick - f.upAtTick) / 3);
  return clamp01(rampAtRecovery * decay);
}

function advance(fault: CascadingFault, tick: number): {
  fault: CascadingFault;
  targets: Record<string, ImpactTarget>;
  signatures: ReturnType<typeof buildSignatures>;
  events: ScenarioEvent[];
} {
  const f: CascadingFault = { ...fault };
  const events: ScenarioEvent[] = [];

  // First crash.
  if (f.downSinceTick === null && tick >= f.onsetTick) {
    f.downSinceTick = tick;
    events.push({
      kind: "fault_started",
      message: "auth-service crashed — container exited (OOMKilled)",
      serviceIds: ["auth-service"],
    });
  }

  // Scheduled relapse when the cache was never capped.
  if (
    f.upAtTick !== null &&
    f.relapseAtTick !== null &&
    tick >= f.relapseAtTick &&
    !f.stable
  ) {
    f.downSinceTick = tick;
    f.upAtTick = null;
    f.relapseAtTick = null;
    events.push({
      kind: "relapse",
      message: "auth-service crashed again — session cache re-exhausted memory",
      serviceIds: ["auth-service"],
    });
  }

  const auth = resolveAuth(f, tick);
  const byId = new Map(services.map((s) => [s.id, s]));
  const targets: Record<string, ImpactTarget> = {};

  const svc = (id: string, over: Partial<ImpactTarget>) => {
    const def = byId.get(id)!;
    targets[id] = {
      cpuPct: def.baseline.cpuPct,
      memPct: def.baseline.memPct,
      rps: def.baseline.rps,
      latencyP95Ms: def.baseline.latencyP95Ms,
      errorRate: def.baseline.errorRate,
      saturation: 0.3,
      ...over,
    };
  };

  const failOpen = f.gatewayFailOpen;

  for (const def of services) {
    const dist = dependentDist[def.id];

    // Data stores (and any service not downstream of auth) stay healthy.
    if (dist === undefined) {
      svc(def.id, {});
      continue;
    }

    // Drained services are parked in maintenance mode — healthy but idle.
    if (f.drained.includes(def.id)) {
      svc(def.id, { rps: def.baseline.rps * 0.05, saturation: 0.05 });
      continue;
    }

    // Fail-open bypasses the auth dependency for everything except auth itself.
    const r =
      def.id === "auth-service"
        ? auth.authR
        : failOpen
          ? 0
          : impactFor(dist, tick, f);

    if (def.id === "auth-service") {
      svc(def.id, {
        cpuPct: Math.max(4, def.baseline.cpuPct - 18 * r),
        memPct: def.baseline.memPct + 44 * r,
        rps: def.baseline.rps * (1 - r),
        latencyP95Ms: def.baseline.latencyP95Ms * (1 - r) + 8 * r,
        errorRate: def.baseline.errorRate + 0.95 * r,
        saturation: clamp01(0.3 + 0.65 * r),
        status: r > 0.55 ? "down" : r > 0.25 ? "critical" : r > 0.05 ? "degraded" : undefined,
      });
      continue;
    }

    const errAmp = dist === 1 ? 0.8 : 0.7;
    const rpsDrop = dist === 1 ? 0.85 : 0.3;
    const err = Math.min(0.95, def.baseline.errorRate + errAmp * r);
    const rps = def.baseline.rps * (1 - rpsDrop * r);

    if (dist === 1) {
      // Direct auth callers stop receiving traffic and fail probes.
      svc(def.id, {
        cpuPct: def.baseline.cpuPct * (1 - 0.5 * r),
        memPct: def.baseline.memPct + 3 * r,
        rps,
        latencyP95Ms: def.baseline.latencyP95Ms * (1 - 0.3 * r),
        errorRate: err,
        saturation: clamp01(0.3 - 0.1 * r),
        status: r > 0.6 ? "down" : r > 0.2 ? "critical" : r > 0.03 ? "degraded" : undefined,
      });
    } else {
      // The gateway/edge still receive requests but answer with 503s.
      svc(def.id, {
        cpuPct: def.baseline.cpuPct * (1 - 0.3 * r),
        memPct: def.baseline.memPct + 4 * r,
        rps: def.baseline.rps * (1 - 0.3 * r),
        latencyP95Ms: def.baseline.latencyP95Ms * (1 + 2.2 * r * (1 - r)),
        errorRate: Math.min(0.95, def.baseline.errorRate + errAmp * r),
        saturation: clamp01(0.3 + 0.4 * r),
        status: r > 0.6 ? "down" : r > 0.2 ? "critical" : r > 0.03 ? "degraded" : undefined,
      });
    }
  }

  const signatures = buildSignatures(f, auth);
  return { fault: f, targets, signatures, events };
}

function buildSignatures(f: CascadingFault, auth: AuthState) {
  const out: import("../types").SignatureLog[] = [];
  const r = auth.authR;

  if (r > 0.15) {
    out.push({
      level: "fatal",
      serviceId: "auth-service",
      message: "process terminated — exit code 137 (OOMKilled)",
      fields: {
        reason: "OOMKilled",
        rss_mb: Math.round(1200 + 848 * r),
        limit_mb: 2048,
        restart_count: f.upAtTick !== null ? 15 : 14,
      },
      count: r > 0.5 ? 2 : 1,
    });
    out.push({
      level: "error",
      serviceId: "auth-service",
      message: "session cache unbounded — 1,942,318 entries consuming 2.0 GB",
      fields: { entries: Math.round(1_400_000 + 542_318 * r), rss_mb: Math.round(1600 + 380 * r), limit_mb: 2048 },
      count: 2,
    });
    out.push({
      level: "error",
      serviceId: "api-gateway",
      message: "authentication unavailable — returning 503 for /api/* routes",
      fields: { upstream: "auth-service", status: 503, routes_affected: 47 },
      count: Math.round(4 + 8 * r),
    });
    out.push({
      level: "warn",
      serviceId: "edge-gateway",
      message: "upstream api-gateway unhealthy (503) — shedding to error page",
      fields: { upstream: "api-gateway", status: 503 },
      count: Math.round(3 + 6 * r),
    });
    for (const id of ["orders-service", "payments-service", "search-service", "notifications-service"]) {
      out.push({
        level: "error",
        serviceId: id,
        message: "readiness probe failed: auth context unavailable",
        fields: { probe: "readiness", reason: "auth-context", threshold_ms: 1000 },
        count: Math.round(1 + 4 * r),
      });
    }
    out.push({
      level: "error",
      serviceId: "payments-service",
      message: "token validation failed — auth-service unreachable (connection refused)",
      fields: { upstream: "auth-service", errno: "ECONNREFUSED" },
      count: Math.round(2 + 5 * r),
    });
  }

  if (f.gatewayFailOpen) {
    out.push({
      level: "warn",
      serviceId: "api-gateway",
      message: "AUTH FAIL-OFF ACTIVE — forwarding unauthenticated requests",
      fields: { security_bypass: true, verified_requests: 0 },
      count: 4,
    });
  }

  if (f.cacheCapped && !auth.authDown) {
    out.push({
      level: "info",
      serviceId: "auth-service",
      message: "session cache bounded — LRU cap 50,000 entries, memory stable",
      fields: { max_entries: 50_000, evictions: 128, rss_mb: 640 },
      count: 1,
    });
  }

  if (f.drained.length > 0) {
    out.push({
      level: "info",
      serviceId: "notifications-service",
      message: "service drained to maintenance mode — traffic shifted to standby",
      fields: { drained: true, mode: "maintenance" },
      count: 1,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Scenario definition                                                   */
/* ------------------------------------------------------------------ */

export const cascadingScenario: ScenarioDefinition<CascadingFault> = {
  id: "cascading",
  name: "Cascading service failure",
  tagline: "One service dies and the failure wave spreads across the graph.",
  description:
    "auth-service begins crash-looping after its session cache grows without bound. Because every core service validates tokens against it, failures propagate hop by hop: first the direct callers, then the gateway, then the edge. The data tier stays healthy — the dependency map shows exactly where the wave is travelling. Restart, patch, or fail open — and watch what happens next.",
  difficulty: "advanced",
  onsetTick: 100,
  startTick: 111,
  seed: 0xc45cade,
  entryRoute: "GET /api/me",
  services,
  edges,
  tracePaths,

  initialFault(): CascadingFault {
    return {
      kind: "cascading",
      onsetTick: 100,
      downSinceTick: null,
      upAtTick: null,
      stable: false,
      relapseAtTick: null,
      cacheCapped: false,
      deployRolledBack: false,
      gatewayFailOpen: false,
      drained: [],
    };
  },

  advance,

  faultSummary(f) {
    const relapse =
      f.relapseAtTick !== null ? `scheduled for tick ${f.relapseAtTick}` : "not scheduled";
    return [
      { label: "Fault", value: "auth-service OOM crash-loop" },
      { label: "auth-service", value: f.upAtTick !== null && (f.relapseAtTick === null || f.stable) ? "Up (restarted)" : f.downSinceTick !== null ? `Down since tick ${f.downSinceTick}` : "Healthy" },
      { label: "Session cache cap", value: f.cacheCapped ? "50k entries (LRU)" : "Unbounded" },
      { label: "Relapse", value: f.stable ? "None (stabilised)" : relapse },
      { label: "Auth release", value: f.deployRolledBack ? "v3.1.6 (rolled back)" : "v3.2.0 (crash-looping)" },
      { label: "Gateway auth mode", value: f.gatewayFailOpen ? "FAIL-OPEN (security risk)" : "Enforced" },
      { label: "Drained services", value: f.drained.length > 0 ? f.drained.join(", ") : "None" },
    ];
  },

  actions: [
    {
      id: "restart-auth",
      name: "Restart auth-service",
      category: "experiment",
      risk: "medium",
      description:
        "Cycle the auth-service container so it comes back up and stops returning 503s.",
      expected: "Error rate drops within 1–2 ticks as traffic resumes.",
      sideEffects:
        "Without capping the session cache the process will OOM again in ~6 ticks — expect a relapse.",
      apply(f, tick) {
        const stable = f.cacheCapped || f.deployRolledBack;
        return {
          fault: {
            ...f,
            upAtTick: tick,
            relapseAtTick: stable ? null : tick + 6,
            stable: f.stable || f.cacheCapped,
          },
          notes: [
            "Restarted auth-service — process is up and serving sessions.",
            stable
              ? "Session cache is bounded — no relapse scheduled."
              : "Session cache still unbounded — expect another OOM in ~6 ticks.",
          ],
        };
      },
    },
    {
      id: "cap-cache",
      name: "Cap the session cache (LRU)",
      category: "fix",
      risk: "low",
      description:
        "Bound the in-memory session cache at 50k entries with LRU eviction so RSS cannot reach the container limit.",
      expected: "Prevents the OOM from recurring after the next restart.",
      sideEffects: "Cold sessions are evicted under load — users may re-authenticate more often.",
      apply(f) {
        const notes = ["Capped session cache at 50,000 entries with LRU eviction."];
        const next: CascadingFault = { ...f, cacheCapped: true };
        if (f.upAtTick !== null && f.relapseAtTick !== null && !f.stable) {
          next.relapseAtTick = null;
          notes.push("Scheduled relapse cleared — cache growth is now bounded.");
        }
        if (f.cacheCapped) return { fault: f, notes: ["Session cache already capped — no change."] };
        return { fault: next, notes };
      },
    },
    {
      id: "patch-auth",
      name: "Patch & restart auth-service",
      category: "fix",
      risk: "medium",
      description:
        "Roll out the hotfix (LRU-bounded cache) and restart in one action — the complete fix.",
      expected: "Auth stays up; downstream services recover over ~3 ticks and the incident auto-resolves.",
      sideEffects: "Deploy takes one tick to complete.",
      apply(f, tick) {
        return {
          fault: {
            ...f,
            cacheCapped: true,
            upAtTick: tick,
            relapseAtTick: null,
            stable: true,
          },
          notes: [
            "Deployed session-cache hotfix (LRU cap) and restarted auth-service.",
            "Root cause addressed — no relapse scheduled.",
          ],
        };
      },
    },
    {
      id: "rollback-deploy",
      name: "Rollback auth-service release",
      category: "fix",
      risk: "medium",
      description:
        "Roll auth-service back from v3.2.0 to v3.1.6 — the last version without unbounded cache growth.",
      expected: "Auth comes back on the previous version and stays up.",
      sideEffects: "Session invalidation fixes shipped in v3.2.0 are lost.",
      apply(f, tick) {
        if (f.deployRolledBack && f.upAtTick !== null) {
          return { fault: f, notes: ["Release already rolled back — no change."] };
        }
        return {
          fault: {
            ...f,
            deployRolledBack: true,
            upAtTick: tick,
            relapseAtTick: null,
            stable: true,
          },
          notes: [
            "Rolled back auth-service v3.2.0 → v3.1.6.",
            "Previous session-cache implementation is active — no relapse scheduled.",
          ],
        };
      },
    },
    {
      id: "fail-open",
      name: "Set gateway auth to fail-open",
      category: "experiment",
      risk: "high",
      description:
        "Configure api-gateway to forward requests without token verification while auth is down.",
      expected: "Error rates collapse immediately and traffic flows again.",
      sideEffects:
        "SECURITY REGRESSION — requests are processed unauthenticated. The root cause is still present.",
      apply(f) {
        if (f.gatewayFailOpen) {
          return { fault: f, notes: ["Gateway already in fail-open mode — no change."] };
        }
        return {
          fault: { ...f, gatewayFailOpen: true },
          notes: [
            "api-gateway auth middleware set to FAIL-OPEN.",
            "Traffic is flowing again — but nothing is being verified. Treat as a stopgap.",
          ],
        };
      },
    },
    {
      id: "drain-notifications",
      name: "Drain notifications-service",
      category: "mitigation",
      risk: "low",
      description:
        "Park notifications in maintenance mode to remove one failing service from the blast radius.",
      expected: "Notifications stops reporting errors; core customer paths are unaffected.",
      sideEffects: "Notification delivery is paused until the service is restored.",
      apply(f) {
        if (f.drained.includes("notifications-service")) {
          return { fault: f, notes: ["notifications-service already drained — no change."] };
        }
        return {
          fault: { ...f, drained: [...f.drained, "notifications-service"] },
          notes: ["Drained notifications-service to maintenance mode."],
        };
      },
    },
    {
      id: "scale-gateway",
      name: "Scale api-gateway replicas",
      category: "experiment",
      risk: "low",
      description: "Add two api-gateway replicas in case the gateway itself is the bottleneck.",
      expected: "No improvement — auth-service is still unreachable from every replica.",
      sideEffects: "None; this is a control experiment.",
      apply(f) {
        return {
          fault: f,
          notes: [
            "Scaled api-gateway 2 → 4 replicas.",
            "No change in error rate — the gateway is not the origin of the failure.",
          ],
        };
      },
    },
  ],

  triggers: [
    {
      id: "auth-outage",
      number: 1077,
      title: "Authentication outage — global request failures",
      description:
        "auth-service is crash-looping (OOMKilled). Every core service that validates tokens against it is failing, and the gateway is returning 503 across all /api routes.",
      severity: "sev1",
      serviceIds: ["auth-service", "api-gateway", "edge-gateway"],
      when: ({ state, fault }) =>
        (fault as CascadingFault).downSinceTick !== null &&
        state.tick >= (fault as CascadingFault).downSinceTick! + 1,
      resolveWhen: ({ kpi, fault }) =>
        kpi.health >= 85 && (fault as CascadingFault).stable === true,
    },
    {
      id: "downstream-wave",
      number: 1081,
      title: "Core services failing across the dependency graph",
      description:
        "Orders, payments and search are failing token validation — the failure wave has propagated beyond the origin service.",
      severity: "sev2",
      serviceIds: ["orders-service", "payments-service", "search-service"],
      when: ({ targets }) => (targets["orders-service"]?.errorRate ?? 0) > 0.3,
      resolveWhen: ({ kpi, fault }) =>
        kpi.health >= 88 && (fault as CascadingFault).stable === true,
    },
  ],

  hypotheses: [
    {
      id: "auth-oom-cache",
      title: "auth-service OOM from unbounded session cache",
      category: "Resource exhaustion",
      summary:
        "The session cache in auth-service v3.2.0 grows without bound until RSS hits the 2 GB container limit; the kernel OOM-kills the process and it crash-loops, taking every token check with it.",
      whyRelevant:
        "OOMKilled exits, multi-GB RSS readings and repeated restarts are direct evidence — and they explain why every dependent service fails simultaneously.",
      baseConfidence: 0.15,
      actual: true,
      slots: [
        {
          id: "oomkilled",
          weight: 3.5,
          collect: (ctx) => {
            const n = ctx.countLogs({ serviceId: "auth-service", levels: ["fatal", "error"], contains: "OOMKilled" });
            if (n < 1) return null;
            return {
              kind: "log",
              title: `${n} OOMKilled exit events`,
              detail: "The container is being killed by the kernel at its memory limit — a hard crash, not a slow degradation.",
              href: "/logs?service=auth-service&level=error&q=OOMKilled",
            };
          },
        },
        {
          id: "auth-memory",
          weight: 2,
          collect: (ctx) => {
            const ratio = ctx.ratioVsBaseline("auth-service", "memPct", 3);
            if (ratio < 1.3) return null;
            return {
              kind: "metric",
              title: `auth-service memory at ${Math.round(ctx.avg("auth-service", "memPct", 3))}% (baseline ${Math.round(ctx.state.services["auth-service"] ? 49 : 49)}%)`,
              detail: "Memory pinned at the container limit corroborates the cache-growth theory.",
              href: "/services/auth-service",
            };
          },
        },
        {
          id: "auth-down",
          weight: 2,
          collect: (ctx) => {
            if (ctx.status("auth-service") !== "down") return null;
            return {
              kind: "metric",
              title: "auth-service is down",
              detail: "The origin service is hard-down — the rest of the graph is a consequence, not a cause.",
              href: "/services/auth-service",
            };
          },
        },
        {
          id: "gateway-503",
          weight: 1.5,
          collect: (ctx) => {
            const n = ctx.countLogs({ serviceId: "api-gateway", levels: ["error"], contains: "503" });
            if (n < 4) return null;
            return {
              kind: "log",
              title: `${n} gateway 503 errors`,
              detail: "The gateway fails because it cannot reach auth — consistent with an auth-origin outage.",
              href: "/logs?service=api-gateway&level=error&q=503",
            };
          },
        },
        {
          id: "data-tier-healthy",
          weight: 1,
          collect: (ctx) => {
            if (ctx.status("postgres-primary") !== "healthy" || ctx.status("redis-cache") !== "healthy") {
              return null;
            }
            return {
              kind: "dependency",
              title: "Data tier healthy (postgres + redis)",
              detail: "The stores auth depends on are fine — this rules out a database-origin cascade.",
              href: "/dependencies?focus=postgres-primary",
            };
          },
        },
      ],
    },
    {
      id: "tls-expiry",
      title: "Expired TLS certificate on auth-service",
      category: "Configuration",
      summary:
        "An expired certificate would make auth refuse connections and take dependent services down with it.",
      whyRelevant:
        "Certificate expiry produces the same downstream symptom (auth unreachable) — check for x509 errors before assuming a crash.",
      baseConfidence: 0.1,
      slots: [
        {
          id: "cert-logs",
          weight: 3,
          collect: (ctx) => {
            const n = ctx.countLogs({ contains: "certificate" });
            if (n < 1) return null;
            return {
              kind: "log",
              title: `${n} certificate errors`,
              detail: "x509 validity errors would confirm a TLS problem.",
              href: "/logs?q=certificate",
            };
          },
        },
        {
          id: "auth-down-2",
          weight: 2,
          collect: (ctx) => {
            if (ctx.status("auth-service") !== "down") return null;
            return {
              kind: "metric",
              title: "auth-service is down",
              detail: "Symptom matches — but a TLS failure would not OOM-kill the process.",
              href: "/services/auth-service",
            };
          },
        },
        {
          id: "gateway-503-2",
          weight: 1.5,
          collect: (ctx) => {
            const n = ctx.countLogs({ serviceId: "api-gateway", contains: "503" });
            if (n < 4) return null;
            return {
              kind: "log",
              title: `${n} gateway 503 errors`,
              detail: "Downstream effect is the same regardless of the auth-side cause.",
              href: "/logs?service=api-gateway&level=error&q=503",
            };
          },
        },
      ],
    },
    {
      id: "network-partition",
      title: "Network partition between services and auth",
      category: "Network",
      summary:
        "A switch or route fault could isolate auth-service from its callers.",
      whyRelevant:
        "Connection-refused errors look like an unreachable auth box — distinguish refused (service down) from timeouts (network).",
      baseConfidence: 0.09,
      slots: [
        {
          id: "conn-refused",
          weight: 3,
          collect: (ctx) => {
            const n = ctx.countLogs({ levels: ["warn", "error"], contains: "ECONNREFUSED" });
            if (n < 2) return null;
            return {
              kind: "log",
              title: `${n} connection-refused errors`,
              detail: "Refused connections mean nothing is listening — consistent with auth being down.",
              href: "/logs?level=error&q=ECONNREFUSED",
            };
          },
        },
        {
          id: "auth-down-3",
          weight: 2,
          collect: (ctx) => {
            if (ctx.status("auth-service") !== "down") return null;
            return {
              kind: "metric",
              title: "auth-service is down",
              detail: "Whether the process died or the path is blocked, auth is unreachable.",
              href: "/services/auth-service",
            };
          },
        },
        {
          id: "db-not-healthy",
          weight: 1.5,
          collect: (ctx) => {
            const st = ctx.status("postgres-primary");
            if (st === "healthy") return null;
            return {
              kind: "dependency",
              title: `postgres-primary is ${st}`,
              detail: "A wide network partition would also affect the data tier.",
              href: "/dependencies?focus=postgres-primary",
            };
          },
        },
      ],
    },
    {
      id: "bot-flood",
      title: "Credential-stuffing flood overwhelming auth",
      category: "Demand",
      summary:
        "A burst of login attempts could exhaust auth capacity and cascade outward.",
      whyRelevant:
        "Auth incidents are often traffic-driven — check whether edge RPS actually rose before chasing a flood.",
      baseConfidence: 0.08,
      slots: [
        {
          id: "rps-jump",
          weight: 3,
          collect: (ctx) => {
            const ratio = ctx.ratioVsBaseline("edge-gateway", "rps", 5);
            if (ratio < 1.3) return null;
            return {
              kind: "metric",
              title: `Edge traffic ${ratio.toFixed(2)}× baseline`,
              detail: "A flood would show clearly elevated RPS at the edge.",
              href: "/services/edge-gateway",
            };
          },
        },
        {
          id: "edge-cpu",
          weight: 2,
          collect: (ctx) => {
            const cpu = ctx.avg("edge-gateway", "cpuPct", 5);
            if (cpu < 75) return null;
            return {
              kind: "metric",
              title: `edge-gateway CPU ${Math.round(cpu)}%`,
              detail: "Sustained edge CPU would support a traffic-driven cause.",
              href: "/services/edge-gateway",
            };
          },
        },
        {
          id: "login-logs",
          weight: 1.5,
          collect: (ctx) => {
            const n = ctx.countLogs({ contains: "login attempt" });
            if (n < 5) return null;
            return {
              kind: "log",
              title: `${n} login-flood log events`,
              detail: "Direct evidence of credential-stuffing volume.",
              href: "/logs?q=login%20attempt",
            };
          },
        },
      ],
    },
    {
      id: "database-outage",
      title: "Primary database outage",
      category: "Data tier",
      summary:
        "If postgres-primary were down, auth could not load sessions and would fail along with everything else.",
      whyRelevant:
        "The classic cascade shape — verify the data tier first so you don't chase symptoms.",
      baseConfidence: 0.08,
      slots: [
        {
          id: "pg-down",
          weight: 3,
          collect: (ctx) => {
            const st = ctx.status("postgres-primary");
            if (st === "healthy") return null;
            return {
              kind: "dependency",
              title: `postgres-primary is ${st}`,
              detail: "A primary outage would explain broad failures.",
              href: "/dependencies?focus=postgres-primary",
            };
          },
        },
        {
          id: "pg-logs",
          weight: 2,
          collect: (ctx) => {
            const n = ctx.countLogs({ serviceId: "postgres-primary", levels: ["error", "fatal"] });
            if (n < 2) return null;
            return {
              kind: "log",
              title: `${n} database errors`,
              detail: "Database-side errors would corroborate a data-tier origin.",
              href: "/logs?service=postgres-primary&level=error",
            };
          },
        },
        {
          id: "broad-degradation",
          weight: 1,
          collect: (ctx) => {
            const degraded = ctx.state.incidents.length > 0 && ctx.status("redis-cache") !== "healthy";
            if (!degraded) return null;
            return {
              kind: "dependency",
              title: "Shared cache also degraded",
              detail: "Both stores failing would fit a data-tier outage.",
              href: "/dependencies",
            };
          },
        },
      ],
    },
  ],
};
