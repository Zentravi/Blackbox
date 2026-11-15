import type {
  ServiceDef,
  ImpactTarget,
  ScenarioDefinition,
  ScenarioEvent,
  DbExhaustionFault,
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
    description: "North-south traffic entry point — TLS termination and routing.",
    tier: 0,
    pos: { x: 0, y: 320 },
    baseline: { cpuPct: 38, memPct: 44, rps: 2400, latencyP95Ms: 45, errorRate: 0.002 },
    slo: 0.999,
  },
  {
    id: "api-gateway",
    name: "api-gateway",
    kind: "gateway",
    team: "Team Platform",
    runtime: "Go 1.24",
    description: "Core API gateway — auth enforcement, rate limiting, request fan-out.",
    tier: 1,
    pos: { x: 300, y: 320 },
    baseline: { cpuPct: 46, memPct: 57, rps: 2350, latencyP95Ms: 180, errorRate: 0.004 },
    slo: 0.995,
  },
  {
    id: "auth-service",
    name: "auth-service",
    kind: "service",
    team: "Team Identity",
    runtime: "Node 22",
    description: "Session issuing and token validation for all customer traffic.",
    tier: 2,
    pos: { x: 640, y: 40 },
    baseline: { cpuPct: 32, memPct: 49, rps: 900, latencyP95Ms: 60, errorRate: 0.001 },
    slo: 0.999,
  },
  {
    id: "orders-service",
    name: "orders-service",
    kind: "service",
    team: "Team Commerce",
    runtime: "Java 21",
    description: "Order creation, modification and history — the most DB-heavy service.",
    tier: 2,
    pos: { x: 640, y: 190 },
    baseline: { cpuPct: 41, memPct: 52, rps: 420, latencyP95Ms: 240, errorRate: 0.003 },
    slo: 0.995,
  },
  {
    id: "payments-service",
    name: "payments-service",
    kind: "service",
    team: "Team Payments",
    runtime: "Go 1.24",
    description: "Payment authorization and capture, coordinated with an external provider.",
    tier: 2,
    pos: { x: 640, y: 340 },
    baseline: { cpuPct: 28, memPct: 47, rps: 260, latencyP95Ms: 410, errorRate: 0.006 },
    slo: 0.999,
  },
  {
    id: "search-service",
    name: "search-service",
    kind: "service",
    team: "Team Discovery",
    runtime: "Rust 1.83",
    description: "Product search and ranking over the catalogue index.",
    tier: 2,
    pos: { x: 640, y: 490 },
    baseline: { cpuPct: 44, memPct: 55, rps: 780, latencyP95Ms: 190, errorRate: 0.002 },
    slo: 0.99,
  },
  {
    id: "notifications-service",
    name: "notifications-service",
    kind: "service",
    team: "Team Messaging",
    runtime: "Python 3.13",
    description: "Email, push and in-app notification delivery.",
    tier: 2,
    pos: { x: 640, y: 640 },
    baseline: { cpuPct: 22, memPct: 41, rps: 150, latencyP95Ms: 320, errorRate: 0.004 },
    slo: 0.99,
  },
  {
    id: "redis-cache",
    name: "redis-cache",
    kind: "cache",
    team: "Data Platform",
    runtime: "Redis 7.2",
    description: "Session store and read-through cache for hot records.",
    tier: 3,
    pos: { x: 980, y: 120 },
    baseline: { cpuPct: 35, memPct: 61, rps: 3100, latencyP95Ms: 4, errorRate: 0.0005 },
    slo: 0.999,
  },
  {
    id: "postgres-primary",
    name: "postgres-primary",
    kind: "data",
    team: "Data Platform",
    runtime: "PostgreSQL 16",
    description: "Primary transactional database — connection pool is finite (100 conns).",
    tier: 3,
    pos: { x: 980, y: 400 },
    baseline: { cpuPct: 52, memPct: 66, rps: 1850, latencyP95Ms: 12, errorRate: 0.001 },
    slo: 0.999,
  },
  {
    id: "payments-provider",
    name: "payments-provider",
    kind: "external",
    team: "Vendor Partner",
    runtime: "SaaS",
    description: "External card payment processor (third party, out of our control).",
    tier: 3,
    pos: { x: 980, y: 620 },
    baseline: { cpuPct: 30, memPct: 38, rps: 250, latencyP95Ms: 520, errorRate: 0.005 },
    slo: 0.99,
  },
];

const edges = [
  { id: "e-edge-api", source: "edge-gateway", target: "api-gateway", protocol: "HTTPS" as const },
  { id: "e-api-auth", source: "api-gateway", target: "auth-service", protocol: "gRPC" as const },
  { id: "e-api-orders", source: "api-gateway", target: "orders-service", protocol: "gRPC" as const },
  { id: "e-api-payments", source: "api-gateway", target: "payments-service", protocol: "gRPC" as const },
  { id: "e-api-search", source: "api-gateway", target: "search-service", protocol: "gRPC" as const },
  { id: "e-api-notif", source: "api-gateway", target: "notifications-service", protocol: "AMQP" as const },
  { id: "e-auth-redis", source: "auth-service", target: "redis-cache", protocol: "TCP" as const, label: "sessions" },
  { id: "e-auth-pg", source: "auth-service", target: "postgres-primary", protocol: "SQL" as const },
  { id: "e-orders-pg", source: "orders-service", target: "postgres-primary", protocol: "SQL" as const, label: "orders" },
  { id: "e-orders-redis", source: "orders-service", target: "redis-cache", protocol: "TCP" as const },
  { id: "e-payments-pg", source: "payments-service", target: "postgres-primary", protocol: "SQL" as const },
  { id: "e-payments-vendor", source: "payments-service", target: "payments-provider", protocol: "HTTPS" as const },
  { id: "e-search-pg", source: "search-service", target: "postgres-primary", protocol: "SQL" as const, label: "catalog" },
  { id: "e-search-redis", source: "search-service", target: "redis-cache", protocol: "TCP" as const },
  { id: "e-notif-pg", source: "notifications-service", target: "postgres-primary", protocol: "SQL" as const },
];

const tracePaths = [
  ["edge-gateway", "api-gateway", "orders-service", "postgres-primary"],
  ["edge-gateway", "api-gateway", "search-service", "postgres-primary"],
  ["edge-gateway", "api-gateway", "auth-service", "redis-cache"],
  ["edge-gateway", "api-gateway", "payments-service", "payments-provider"],
  ["edge-gateway", "api-gateway", "notifications-service", "postgres-primary"],
];

/* ------------------------------------------------------------------ */
/* Fault dynamics                                                       */
/* ------------------------------------------------------------------ */

/** How strongly each service feels the connection-pool pressure. */
const SENSITIVITY: Record<string, number> = {
  "edge-gateway": 0.75,
  "api-gateway": 1,
  "auth-service": 0.22,
  "orders-service": 0.9,
  "payments-service": 0.85,
  "search-service": 0.55,
  "notifications-service": 0.5,
  "redis-cache": 0.35,
  "postgres-primary": 1,
  "payments-provider": 0,
};

interface PressureState {
  intensity: number;
  pressure: number;
  dbLoad: number;
  timeoutFactor: number;
  errorFactor: number;
  breakerLatency: number;
  breakerErr: number;
}

function computePressure(f: DbExhaustionFault, tick: number): PressureState {
  const intensity = tick < f.onsetTick ? 0 : clamp01((tick - f.onsetTick) / 25);
  const replicaFactor = 1 - 0.55 * f.replicaShift;
  const rateFactor = f.rateLimitRps > 0 ? 0.62 : 1;
  const boost =
    f.restartTick !== null ? f.restartBoost * Math.max(0, 1 - (tick - f.restartTick) / 5) : 0;

  // Connection demand expressed as utilisation of the configured pool.
  // Queueing (and therefore errors/latency) only begins past the safe
  // operating point — resizing the pool or shedding load lowers utilisation.
  const util =
    ((intensity * 1.45 * replicaFactor * rateFactor * (1 - 0.65 * boost)) /
      (f.poolMax / 100)) /
    f.scaleOut;

  const pressure = clamp01(util - 0.45);
  const dbLoad = clamp01(
    intensity *
      1.45 *
      (1 + 0.18 * (f.scaleOut - 1)) *
      (1 - 0.5 * f.replicaShift) *
      (f.rateLimitRps > 0 ? 0.72 : 1),
  );

  return {
    intensity,
    pressure,
    dbLoad,
    timeoutFactor: f.poolTimeoutEnabled ? 0.45 : 1,
    errorFactor: f.poolTimeoutEnabled ? 1.3 : 1,
    breakerLatency: f.breakerEnabled ? 0.6 : 1,
    breakerErr: f.breakerEnabled ? 1.12 : 1,
  };
}

function advance(fault: DbExhaustionFault, tick: number) {
  const f: DbExhaustionFault = { ...fault };
  const p = computePressure(f, tick);
  f.intensity = p.intensity;

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

  const pr = p.pressure;

  svc("edge-gateway", {
    cpuPct: 38 + 26 * pr,
    memPct: 44 + 8 * pr,
    rps: 2400 * (1 - 0.35 * pr),
    latencyP95Ms: 45 * (1 + 3.0 * pr * p.timeoutFactor),
    errorRate: Math.min(0.7, 0.002 + 0.3 * pr * p.errorFactor),
    saturation: clamp01(0.2 + 0.8 * pr),
  });

  svc("api-gateway", {
    cpuPct: 46 + 30 * pr,
    memPct: 57 + 10 * pr,
    rps: 2350 * (1 - 0.4 * pr),
    latencyP95Ms: 180 * (1 + 3.4 * pr * p.timeoutFactor),
    errorRate: Math.min(0.75, 0.004 + 0.34 * pr * p.errorFactor),
    saturation: clamp01(0.25 + 0.75 * pr),
  });

  for (const id of [
    "auth-service",
    "orders-service",
    "payments-service",
    "search-service",
    "notifications-service",
  ]) {
    const def = byId.get(id)!;
    const s = SENSITIVITY[id] ?? 0.5;
    svc(id, {
      cpuPct: def.baseline.cpuPct + 24 * pr * s,
      memPct: def.baseline.memPct + 7 * pr * s,
      rps: def.baseline.rps * (1 - 0.4 * pr * s),
      latencyP95Ms:
        def.baseline.latencyP95Ms *
        (1 + 2.3 * pr * s * p.timeoutFactor * p.breakerLatency),
      errorRate: Math.min(
        0.7,
        def.baseline.errorRate + 0.3 * pr * s * p.errorFactor * p.breakerErr,
      ),
      saturation: clamp01(0.15 + 0.85 * pr * s),
    });
  }

  // Redis absorbs extra retries — mild pressure.
  svc("redis-cache", {
    cpuPct: 35 + 12 * pr * 0.4,
    memPct: 61 + 6 * pr,
    rps: 3100 * (1 + 0.15 * pr),
    latencyP95Ms: 4 * (1 + 2.5 * pr),
    errorRate: Math.min(0.1, 0.0005 + 0.02 * pr),
    saturation: clamp01(0.3 + 0.5 * pr * 0.5),
  });

  // PostgreSQL: contention grows nonlinearly with load.
  const db = p.dbLoad;
  svc("postgres-primary", {
    cpuPct: 52 + 40 * db,
    memPct: 66 + 12 * db,
    rps: 1850 * (1 - 0.3 * pr),
    latencyP95Ms: 12 * (1 + 6.5 * db * db),
    errorRate: Math.min(0.3, 0.001 + 0.12 * db),
    saturation: clamp01(0.5 + 0.5 * db),
  });

  // External provider stays healthy — it is a deliberate red herring.
  svc("payments-provider", {});

  /* ---------------- signature evidence logs ---------------- */
  const signatures = buildSignatures(f, p);

  return { fault: f, targets, signatures, events: [] as ScenarioEvent[] };
}

function buildSignatures(f: DbExhaustionFault, p: PressureState) {
  const pr = p.pressure;
  const out: import("../types").SignatureLog[] = [];
  if (pr < 0.12) return out;

  out.push({
    level: "error",
    serviceId: "api-gateway",
    message: `connection pool exhausted: waiting for available connection (waited 5000ms)`,
    fields: {
      pool_size: f.poolMax,
      active: Math.round(f.poolMax * Math.min(0.995, 0.6 + 0.4 * pr)),
      queued: Math.round(pr * 420),
      max_wait_ms: 5000,
      component: "pgxpool",
    },
    count: Math.round(3 + pr * 12),
  });

  out.push({
    level: "warn",
    serviceId: "api-gateway",
    message: "downstream query aborted: context deadline exceeded (postgres-primary)",
    fields: { upstream: "postgres-primary", timeout_ms: 2000, route: "/api/orders" },
    count: Math.round(2 + pr * 8),
  });

  if (f.poolTimeoutEnabled) {
    out.push({
      level: "warn",
      serviceId: "api-gateway",
      message: "pool wait timeout configured to 250ms — failing fast instead of queueing",
      fields: { fail_fast: true, wait_ms: 250, component: "pgxpool" },
      count: 3,
    });
  }

  if (f.breakerEnabled) {
    out.push({
      level: "warn",
      serviceId: "orders-service",
      message: "circuit breaker opened for postgres-primary — short-circuiting requests",
      fields: { breaker: "postgres-primary", state: "OPEN", failure_rate: 0.62 },
      count: 4,
    });
  }

  out.push({
    level: "error",
    serviceId: "orders-service",
    message: "db query failed: timeout acquiring connection from pool",
    fields: { operation: "CreateOrder", wait_ms: 5000, retries: 2 },
    count: Math.round(1 + pr * 6),
  });

  out.push({
    level: "warn",
    serviceId: "payments-service",
    message: "payment authorization slow — db pool wait 1.8s before statement",
    fields: { operation: "ReserveStock", wait_ms: 1800, currency: "USD" },
    count: Math.round(pr * 4),
  });

  out.push({
    level: "info",
    serviceId: "orders-service",
    message: "slow query detected: seq scan on order_items took 1420ms",
    fields: { table: "order_items", rows: 1_482_391, ms: 1420 },
    count: Math.round(dbLoadCount(pr)),
  });

  if (f.replicaShift > 0) {
    out.push({
      level: "info",
      serviceId: "orders-service",
      message: `read traffic shifted to postgres-replica (${Math.round(f.replicaShift * 100)}%)`,
      fields: { replica_shift: f.replicaShift, replica: "postgres-replica" },
      count: 1,
    });
  }

  if (f.rateLimitRps > 0) {
    out.push({
      level: "warn",
      serviceId: "edge-gateway",
      message: "rate limiter shedding excess requests (HTTP 429)",
      fields: { limit_rps: f.rateLimitRps, shed_rps: Math.round(f.rateLimitRps * 0.18) },
      count: Math.round(2 + pr * 5),
    });
  }

  if (f.deploymentRolledBack) {
    out.push({
      level: "info",
      serviceId: "api-gateway",
      message: "rolled back deployment api-gateway v2.14.3 → v2.14.2",
      fields: { from: "v2.14.3", to: "v2.14.2", strategy: "rollback" },
      count: 1,
    });
  }

  return out;
}

function dbLoadCount(pr: number): number {
  return 1 + pr * 4;
}

/* ------------------------------------------------------------------ */
/* Scenario definition                                                   */
/* ------------------------------------------------------------------ */

export const dbExhaustionScenario: ScenarioDefinition<DbExhaustionFault> = {
  id: "db-exhaustion",
  name: "Database connection exhaustion",
  tagline: "The primary connection pool hits capacity and the request path buckles.",
  description:
    "A steady increase in database-heavy traffic pushes the shared PostgreSQL connection pool to 100%. Requests begin waiting for connections, API latency climbs, timeouts appear in logs and traces, and every service that touches the primary database degrades. Investigate the evidence, form a hypothesis, and experiment with recovery actions.",
  difficulty: "intermediate",
  onsetTick: 100,
  startTick: 112,
  seed: 0x8db0a5,
  entryRoute: "POST /api/orders",
  services,
  edges,
  tracePaths,

  initialFault(): DbExhaustionFault {
    return {
      kind: "db-exhaustion",
      onsetTick: 100,
      intensity: 0,
      poolMax: 100,
      poolTimeoutEnabled: false,
      breakerEnabled: false,
      rateLimitRps: 0,
      scaleOut: 1,
      replicaShift: 0,
      restartBoost: 0,
      restartTick: null,
      deploymentRolledBack: false,
    };
  },

  advance,

  faultSummary(f) {
    const items = [
      { label: "Fault", value: "PostgreSQL connection pool saturation" },
      { label: "Pool size (max conns)", value: `${f.poolMax}` },
      { label: "Demand intensity", value: `${Math.round(f.intensity * 100)}%` },
      { label: "Pool wait timeout", value: f.poolTimeoutEnabled ? "250 ms (fail-fast)" : "5000 ms (queue)" },
      { label: "Circuit breakers", value: f.breakerEnabled ? "OPEN on db call sites" : "Closed" },
      { label: "Edge rate limit", value: f.rateLimitRps > 0 ? `${f.rateLimitRps} rps` : "Off" },
      { label: "API replicas", value: `${f.scaleOut}` },
      { label: "Read replica shift", value: `${Math.round(f.replicaShift * 100)}%` },
      { label: "Last API restart", value: f.restartTick !== null ? `tick ${f.restartTick}` : "—" },
      { label: "Release rollback", value: f.deploymentRolledBack ? "v2.14.2 active" : "v2.14.3 active" },
    ];
    if (f.restartTick !== null) items.push({ label: "Restart relief", value: "decaying (5 ticks)" });
    return items;
  },

  actions: [
    {
      id: "resize-pool",
      name: "Increase connection pool size",
      category: "fix",
      risk: "medium",
      description:
        "Raise api-gateway max_connections from 100 to 400 so concurrent requests stop queueing on the pool.",
      expected: "Pool wait timeouts drop sharply; API p95 should recover within 2–3 ticks.",
      sideEffects: "PostgreSQL takes ~4× more connections — watch primary CPU and memory.",
      apply(f) {
        const before = f.poolMax;
        return {
          fault: { ...f, poolMax: 400 },
          notes: [`Increased api-gateway connection pool ${before} → 400 max connections.`],
        };
      },
    },
    {
      id: "pool-timeout",
      name: "Enable pool wait timeout (fail fast)",
      category: "mitigation",
      risk: "low",
      description:
        "Stop requests from queueing for 5s: cap pool wait at 250ms and return a fast 503 when no connection is free.",
      expected: "p95 latency collapses quickly; error rate rises slightly because requests fail fast instead of waiting.",
      sideEffects: "More visible 503s — customers see errors sooner rather than slow responses.",
      apply(f) {
        if (f.poolTimeoutEnabled) {
          return { fault: f, notes: ["Pool wait timeout was already enabled — no change."] };
        }
        return {
          fault: { ...f, poolTimeoutEnabled: true },
          notes: ["Enabled 250ms pool wait timeout with fast-fail responses."],
        };
      },
    },
    {
      id: "circuit-breaker",
      name: "Open circuit breakers on DB call sites",
      category: "mitigation",
      risk: "medium",
      description:
        "Short-circuit database calls when failure rate exceeds 60% so dependent services stop accumulating waiters.",
      expected: "Latency on orders/payments improves; some requests fail immediately with 503.",
      sideEffects: "Reads and writes against the primary are temporarily unavailable through breakers.",
      apply(f) {
        if (f.breakerEnabled) {
          return { fault: f, notes: ["Circuit breakers were already open — no change."] };
        }
        return {
          fault: { ...f, breakerEnabled: true },
          notes: ["Opened circuit breakers on postgres-primary call sites (failure rate 62%)."],
        };
      },
    },
    {
      id: "rate-limit",
      name: "Shed load at the edge",
      category: "mitigation",
      risk: "low",
      description:
        "Cap incoming traffic at 1800 rps at edge-gateway so the pool demand falls below capacity.",
      expected: "Downstream pressure and queue depth drop; a small share of requests get HTTP 429.",
      sideEffects: "Legitimate peak traffic is rejected until the limit is lifted.",
      apply(f) {
        if (f.rateLimitRps > 0) {
          return { fault: f, notes: [`Rate limit already active at ${f.rateLimitRps} rps.`] };
        }
        return {
          fault: { ...f, rateLimitRps: 1800 },
          notes: ["Set edge rate limit to 1800 rps (sheds ~18% of peak demand)."],
        };
      },
    },
    {
      id: "scale-api",
      name: "Scale api-gateway horizontally",
      category: "mitigation",
      risk: "low",
      description:
        "Add an api-gateway replica so each instance holds a smaller slice of total demand.",
      expected: "Per-instance pool pressure drops; total DB connections rise slightly.",
      sideEffects: "More instances = more aggregate pools competing for the same primary.",
      apply(f) {
        if (f.scaleOut >= 3) {
          return { fault: f, notes: ["api-gateway already at 3 replicas — no change."] };
        }
        const next = f.scaleOut + 1;
        return {
          fault: { ...f, scaleOut: next },
          notes: [`Scaled api-gateway ${f.scaleOut} → ${next} replicas.`],
        };
      },
    },
    {
      id: "read-replica",
      name: "Shift reads to the replica",
      category: "mitigation",
      risk: "medium",
      description:
        "Route 55% of read queries (search, order history, catalogue) to postgres-replica.",
      expected: "Primary connection demand and CPU fall noticeably; read p95 may rise slightly.",
      sideEffects: "Replica lag can serve stale reads for a few hundred milliseconds.",
      apply(f) {
        if (f.replicaShift > 0) {
          return { fault: f, notes: ["Read replica shift already active — no change."] };
        }
        return {
          fault: { ...f, replicaShift: 0.55 },
          notes: ["Shifted 55% of read queries to postgres-replica."],
        };
      },
    },
    {
      id: "restart-api",
      name: "Restart api-gateway pods",
      category: "experiment",
      risk: "medium",
      description:
        "Cycle api-gateway pods to flush stuck waiters and reset in-memory pool state.",
      expected: "Latency drops immediately — but relief decays over ~5 ticks if pool pressure persists.",
      sideEffects: "In-flight requests are dropped during the rolling restart.",
      apply(f, tick) {
        return {
          fault: { ...f, restartBoost: 1, restartTick: tick },
          notes: [
            "Restarted api-gateway pods — stuck waiters flushed.",
            "Watch p95: this relief is temporary unless pool pressure is reduced.",
          ],
        };
      },
    },
    {
      id: "rollback-release",
      name: "Rollback api-gateway release",
      category: "experiment",
      risk: "low",
      description:
        "Roll back api-gateway v2.14.3 → v2.14.2 in case the recent release introduced a leak.",
      expected: "If the release is unrelated, metrics will show no measurable change — that is a valid finding.",
      sideEffects: "Any genuine fixes shipped in v2.14.3 are lost.",
      apply(f) {
        if (f.deploymentRolledBack) {
          return { fault: f, notes: ["Release already rolled back to v2.14.2 — no change."] };
        }
        return {
          fault: { ...f, deploymentRolledBack: true },
          notes: [
            "Rolled back api-gateway to v2.14.2.",
            "No change in pool utilisation observed — the release was unrelated.",
          ],
        };
      },
    },
  ],

  triggers: [
    {
      id: "api-latency-slo",
      number: 1042,
      title: "Elevated API latency and database timeouts",
      description:
        "Customer-facing API p95 breached the 800ms SLO while database connection wait timeouts increased across the request path.",
      severity: "sev2",
      serviceIds: ["api-gateway", "postgres-primary", "orders-service"],
      when: ({ state, fault, targets }) =>
        state.tick >= (fault as DbExhaustionFault).onsetTick + 4 &&
        (targets["api-gateway"]?.errorRate ?? 0) > 0.02,
      escalateTo: {
        severity: "sev1",
        message: "API error rate exceeded 9% — customer-facing impact confirmed.",
        when: ({ targets }) => (targets["api-gateway"]?.errorRate ?? 0) > 0.09,
      },
      resolveWhen: ({ kpi }) => kpi.health >= 88 && kpi.errorRate < 0.025,
    },
    {
      id: "pg-saturation",
      number: 1046,
      title: "PostgreSQL primary saturation above target",
      description:
        "postgres-primary connection saturation and CPU are outside the operating envelope for the primary database.",
      severity: "sev3",
      serviceIds: ["postgres-primary"],
      when: ({ state, fault, targets }) =>
        state.tick >= (fault as DbExhaustionFault).onsetTick + 8 &&
        (targets["postgres-primary"]?.saturation ?? 0) > 0.85,
      resolveWhen: ({ targets }) => (targets["postgres-primary"]?.saturation ?? 1) < 0.7,
    },
  ],

  hypotheses: [
    {
      id: "db-pool-exhaustion",
      title: "Database connection pool exhaustion",
      category: "Resource exhaustion",
      summary:
        "The shared PostgreSQL pool (100 connections) is saturated — requests wait up to 5s for a connection, inflating p95 and producing timeouts.",
      whyRelevant:
        "Pool wait timeouts in the gateway, primary saturation, and db-span timeouts in traces are the classic signature of connection exhaustion rather than slow queries.",
      baseConfidence: 0.12,
      actual: true,
      slots: [
        {
          id: "pool-wait-logs",
          weight: 3,
          collect: (ctx) => {
            const n = ctx.countLogs({
              serviceId: "api-gateway",
              levels: ["warn", "error"],
              contains: "pool",
              sinceTick: ctx.state.tick - 15,
            });
            if (n < 3) return null;
            return {
              kind: "log",
              title: `${n} pool-related warnings/errors in api-gateway`,
              detail:
                "Gateway logs show connections waiting 5000ms for a free pool slot — the pool itself is the bottleneck.",
              href: "/logs?service=api-gateway&level=error&q=pool",
            };
          },
        },
        {
          id: "primary-saturation",
          weight: 2.5,
          collect: (ctx) => {
            const sat = ctx.avg("postgres-primary", "saturation", 5);
            if (sat < 0.75) return null;
            return {
              kind: "metric",
              title: `postgres-primary saturation at ${Math.round(sat * 100)}%`,
              detail:
                "Primary saturation above 80% means connections/queries are contending — consistent with pool exhaustion upstream.",
              href: "/services/postgres-primary",
            };
          },
        },
        {
          id: "db-span-timeouts",
          weight: 2.5,
          collect: (ctx) => {
            const s = ctx.traceStats({ serviceId: "orders-service", sinceTick: ctx.state.tick - 20 });
            if (s.total < 4 || s.errorPct < 0.2) return null;
            return {
              kind: "trace",
              title: `${Math.round(s.errorPct * 100)}% of sampled orders traces failing`,
              detail:
                "Failed spans cluster around db.query — the request path dies at the database, not at upstream callers.",
              href: "/traces?status=error&service=orders-service",
            };
          },
        },
        {
          id: "dependency-degraded",
          weight: 2,
          collect: (ctx) => {
            const st = ctx.status("postgres-primary");
            if (st !== "critical" && st !== "down") return null;
            return {
              kind: "dependency",
              title: `postgres-primary is ${st}`,
              detail:
                "Every DB-backed service depends on the primary — its degradation explains the wide blast radius.",
              href: "/dependencies?focus=postgres-primary",
            };
          },
        },
        {
          id: "latency-ratio",
          weight: 1.5,
          collect: (ctx) => {
            const ratio = ctx.ratioVsBaseline("api-gateway", "latencyP95Ms", 5);
            if (ratio < 1.6) return null;
            return {
              kind: "metric",
              title: `api-gateway p95 is ${ratio.toFixed(1)}× baseline`,
              detail:
                "Latency scaling with pool pressure (not with traffic) points to queueing inside the gateway.",
              href: "/services/api-gateway",
            };
          },
        },
      ],
    },
    {
      id: "n1-queries",
      title: "Runaway N+1 queries in orders-service",
      category: "Query performance",
      summary:
        "A recent orders flow may issue per-item queries, multiplying database load until statements slow down.",
      whyRelevant:
        "Slow-query logs and elevated primary CPU would also produce latency — but they would not explain gateway pool wait timeouts as directly.",
      baseConfidence: 0.1,
      slots: [
        {
          id: "slow-queries",
          weight: 3,
          collect: (ctx) => {
            const n = ctx.countLogs({ serviceId: "orders-service", contains: "slow query" });
            // Distractor: a genuine N+1 storm would produce far more events
            // than the handful emitted under pool pressure.
            if (n < 10) return null;
            return {
              kind: "log",
              title: `${n} slow-query events in orders-service`,
              detail: "Seq scans on large tables inflate per-request query time.",
              href: "/logs?service=orders-service&q=slow%20query",
            };
          },
        },
        {
          id: "orders-latency",
          weight: 2,
          collect: (ctx) => {
            const ratio = ctx.ratioVsBaseline("orders-service", "latencyP95Ms", 5);
            if (ratio < 1.6) return null;
            return {
              kind: "metric",
              title: `orders-service p95 ${ratio.toFixed(1)}× baseline`,
              detail: "Order creation is slowing down beyond gateway-level effects.",
              href: "/services/orders-service",
            };
          },
        },
        {
          id: "pg-cpu",
          weight: 1.5,
          collect: (ctx) => {
            const ratio = ctx.ratioVsBaseline("postgres-primary", "cpuPct", 5);
            // Distractor: N+1 workloads push DB CPU far beyond contention levels.
            if (ratio < 2.5) return null;
            return {
              kind: "metric",
              title: `postgres-primary CPU ${Math.round(ctx.avg("postgres-primary", "cpuPct", 5))}%`,
              detail: "High DB CPU is typical of excessive per-row query work.",
              href: "/services/postgres-primary",
            };
          },
        },
      ],
    },
    {
      id: "memory-leak",
      title: "Memory leak in api-gateway",
      category: "Resource exhaustion",
      summary:
        "A leak in gateway buffers could grow latency and eventually cause request failures.",
      whyRelevant:
        "Worth checking because gateway memory appears in dashboards — but leaks produce monotonic memory growth, not pool waits.",
      baseConfidence: 0.06,
      slots: [
        {
          id: "mem-growth",
          weight: 2.5,
          collect: (ctx) => {
            const ratio = ctx.ratioVsBaseline("api-gateway", "memPct", 20);
            if (ratio < 1.25) return null;
            return {
              kind: "metric",
              title: `api-gateway memory ${Math.round(ratio * 100)}% of baseline`,
              detail: "Sustained memory growth would support a leak hypothesis.",
              href: "/services/api-gateway",
            };
          },
        },
        {
          id: "heap-logs",
          weight: 2.5,
          collect: (ctx) => {
            const n = ctx.countLogs({ contains: "heap" });
            if (n < 2) return null;
            return {
              kind: "log",
              title: `${n} heap/GC warnings`,
              detail: "GC pressure logs would corroborate a memory leak.",
              href: "/logs?q=heap",
            };
          },
        },
      ],
    },
    {
      id: "traffic-spike",
      title: "Upstream traffic spike",
      category: "Demand",
      summary:
        "A sudden jump in request volume could overwhelm capacity and explain rising latency.",
      whyRelevant:
        "Traffic spikes are the most common cause of sudden saturation — easy to rule out by checking RPS and edge CPU.",
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
              detail: "A demand surge would push every downstream metric up together.",
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
              title: `edge-gateway CPU at ${Math.round(cpu)}%`,
              detail: "Sustained CPU saturation supports a demand-driven incident.",
              href: "/services/edge-gateway",
            };
          },
        },
      ],
    },
    {
      id: "network-partition",
      title: "Network partition between API and database",
      category: "Network",
      summary:
        "Packet loss or a routing fault between the app tier and postgres-primary would produce timeouts.",
      whyRelevant:
        "I/O timeout logs look similar to pool waits — distinguishing them tells you whether to page neteng or the DBA.",
      baseConfidence: 0.07,
      slots: [
        {
          id: "dial-timeouts",
          weight: 3,
          collect: (ctx) => {
            const n = ctx.countLogs({ levels: ["warn", "error"], contains: "i/o timeout" });
            if (n < 2) return null;
            return {
              kind: "log",
              title: `${n} dial/IO timeout errors`,
              detail: "Raw TCP timeouts suggest network-level trouble.",
              href: "/logs?level=error&q=i%2Fo%20timeout",
            };
          },
        },
        {
          id: "trace-timeouts",
          weight: 2,
          collect: (ctx) => {
            const s = ctx.traceStats({ status: "timeout", sinceTick: ctx.state.tick - 15 });
            if (s.total < 3) return null;
            return {
              kind: "trace",
              title: `${s.total} timed-out traces in the last 15 ticks`,
              detail: "Timeouts at the db span are consistent with unreachable DB endpoints.",
              href: "/traces?status=timeout",
            };
          },
        },
      ],
    },
  ],
};
