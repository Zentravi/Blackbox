import type {
  ServiceDef,
  ImpactTarget,
  ScenarioDefinition,
  ScenarioEvent,
  ApiLatencyFault,
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
    description: "North-south entry point where client requests are received.",
    tier: 0,
    pos: { x: 0, y: 300 },
    baseline: { cpuPct: 40, memPct: 44, rps: 3100, latencyP95Ms: 55, errorRate: 0.002 },
    slo: 0.999,
  },
  {
    id: "api-gateway",
    name: "api-gateway",
    kind: "gateway",
    team: "Team Platform",
    runtime: "Go 1.24",
    description: "Request fan-out to domain services — aggregates search latency into overall p95.",
    tier: 1,
    pos: { x: 300, y: 300 },
    baseline: { cpuPct: 48, memPct: 56, rps: 3000, latencyP95Ms: 220, errorRate: 0.004 },
    slo: 0.995,
  },
  {
    id: "search-service",
    name: "search-service",
    kind: "service",
    team: "Team Discovery",
    runtime: "Rust 1.83",
    description: "Product search — bounded worker pool (32 threads) serving ranking queries.",
    tier: 2,
    pos: { x: 640, y: 60 },
    baseline: { cpuPct: 44, memPct: 55, rps: 1600, latencyP95Ms: 140, errorRate: 0.003 },
    slo: 0.99,
  },
  {
    id: "catalog-service",
    name: "catalog-service",
    kind: "service",
    team: "Team Discovery",
    runtime: "Go 1.24",
    description: "Product detail and category browsing.",
    tier: 2,
    pos: { x: 640, y: 220 },
    baseline: { cpuPct: 36, memPct: 50, rps: 700, latencyP95Ms: 160, errorRate: 0.002 },
    slo: 0.995,
  },
  {
    id: "cart-service",
    name: "cart-service",
    kind: "service",
    team: "Team Commerce",
    runtime: "Node 22",
    description: "Shopping cart reads and writes.",
    tier: 2,
    pos: { x: 640, y: 380 },
    baseline: { cpuPct: 33, memPct: 48, rps: 480, latencyP95Ms: 130, errorRate: 0.003 },
    slo: 0.995,
  },
  {
    id: "checkout-service",
    name: "checkout-service",
    kind: "service",
    team: "Team Commerce",
    runtime: "Java 21",
    description: "Checkout orchestration — calls search for recommendations before payment.",
    tier: 2,
    pos: { x: 640, y: 540 },
    baseline: { cpuPct: 42, memPct: 54, rps: 390, latencyP95Ms: 480, errorRate: 0.006 },
    slo: 0.999,
  },
  {
    id: "redis-cache",
    name: "redis-cache",
    kind: "cache",
    team: "Data Platform",
    runtime: "Redis 7.2",
    description: "Read-through cache for product and cart records.",
    tier: 3,
    pos: { x: 980, y: 140 },
    baseline: { cpuPct: 38, memPct: 62, rps: 4200, latencyP95Ms: 4, errorRate: 0.0005 },
    slo: 0.999,
  },
  {
    id: "postgres-primary",
    name: "postgres-primary",
    kind: "data",
    team: "Data Platform",
    runtime: "PostgreSQL 16",
    description: "Catalogue and order store — serves ranking queries from search-service.",
    tier: 3,
    pos: { x: 980, y: 380 },
    baseline: { cpuPct: 48, memPct: 64, rps: 2400, latencyP95Ms: 14, errorRate: 0.001 },
    slo: 0.999,
  },
  {
    id: "payments-provider",
    name: "payments-provider",
    kind: "external",
    team: "Vendor Partner",
    runtime: "SaaS",
    description: "External payment processor (healthy throughout this incident).",
    tier: 3,
    pos: { x: 980, y: 580 },
    baseline: { cpuPct: 30, memPct: 38, rps: 380, latencyP95Ms: 480, errorRate: 0.005 },
    slo: 0.99,
  },
];

const edges = [
  { id: "e-edge-api", source: "edge-gateway", target: "api-gateway", protocol: "HTTPS" as const },
  { id: "e-api-search", source: "api-gateway", target: "search-service", protocol: "gRPC" as const },
  { id: "e-api-catalog", source: "api-gateway", target: "catalog-service", protocol: "gRPC" as const },
  { id: "e-api-cart", source: "api-gateway", target: "cart-service", protocol: "gRPC" as const },
  { id: "e-api-checkout", source: "api-gateway", target: "checkout-service", protocol: "gRPC" as const },
  { id: "e-checkout-search", source: "checkout-service", target: "search-service", protocol: "gRPC" as const, label: "recommendations" },
  { id: "e-search-redis", source: "search-service", target: "redis-cache", protocol: "TCP" as const },
  { id: "e-search-pg", source: "search-service", target: "postgres-primary", protocol: "SQL" as const, label: "ranking" },
  { id: "e-catalog-pg", source: "catalog-service", target: "postgres-primary", protocol: "SQL" as const },
  { id: "e-cart-redis", source: "cart-service", target: "redis-cache", protocol: "TCP" as const },
  { id: "e-checkout-pg", source: "checkout-service", target: "postgres-primary", protocol: "SQL" as const },
  { id: "e-checkout-vendor", source: "checkout-service", target: "payments-provider", protocol: "HTTPS" as const },
];

const tracePaths = [
  ["edge-gateway", "api-gateway", "search-service", "postgres-primary"],
  ["edge-gateway", "api-gateway", "search-service", "redis-cache"],
  ["edge-gateway", "api-gateway", "catalog-service", "postgres-primary"],
  ["edge-gateway", "api-gateway", "checkout-service", "search-service", "postgres-primary"],
  ["edge-gateway", "api-gateway", "cart-service", "redis-cache"],
  ["edge-gateway", "api-gateway", "checkout-service", "payments-provider"],
];

/* ------------------------------------------------------------------ */
/* Fault dynamics                                                       */
/* ------------------------------------------------------------------ */

interface QueueState {
  intensity: number;
  queue: number;
  boost: number;
}

function computeQueue(f: ApiLatencyFault, tick: number): QueueState {
  const intensity = tick < f.onsetTick ? 0 : clamp01((tick - f.onsetTick) / 25);
  const badQueryFactor = f.rankingRollback ? 0.08 : 1;
  const cacheFactor = f.cacheEnabled ? 0.55 : 1;
  const throttleFactor = f.queryThrottle ? 0.65 : 1;
  const boost =
    f.restartTick !== null ? f.restartBoost * Math.max(0, 1 - (tick - f.restartTick) / 5) : 0;
  const capacity = (f.threadPoolSize / 32) * f.replicaCount;
  const queue = clamp01(
    (intensity * badQueryFactor * cacheFactor * throttleFactor * (1 - 0.5 * boost)) / capacity,
  );
  return { intensity, queue, boost };
}

function advance(fault: ApiLatencyFault, tick: number): {
  fault: ApiLatencyFault;
  targets: Record<string, ImpactTarget>;
  signatures: ReturnType<typeof buildSignatures>;
  events: ScenarioEvent[];
} {
  const f: ApiLatencyFault = { ...fault };
  const q = computeQueue(f, tick);
  f.intensity = q.intensity;

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

  const k = q.queue;
  const searchLatency = 140 * (1 + 6.5 * k);

  svc("search-service", {
    cpuPct: 44 + 45 * k,
    memPct: 55 + 15 * k,
    rps: 1600 * (1 - 0.35 * k),
    latencyP95Ms: searchLatency,
    errorRate: Math.min(0.5, 0.003 + 0.26 * k),
    saturation: clamp01(0.15 + 0.85 * k),
  });

  // Gateway aggregates the slow search path into overall p95.
  svc("edge-gateway", {
    cpuPct: 40 + 22 * k,
    memPct: 44 + 8 * k,
    rps: 3100 * (1 - 0.3 * k),
    latencyP95Ms: 55 + (searchLatency - 55) * 0.5 * k,
    errorRate: Math.min(0.5, 0.002 + 0.17 * k),
    saturation: clamp01(0.25 + 0.6 * k),
  });

  svc("api-gateway", {
    cpuPct: 48 + 24 * k,
    memPct: 56 + 9 * k,
    rps: 3000 * (1 - 0.32 * k),
    latencyP95Ms: 220 + (searchLatency - 140) * 0.55 * k,
    errorRate: Math.min(0.5, 0.004 + 0.19 * k),
    saturation: clamp01(0.3 + 0.65 * k),
  });

  svc("checkout-service", {
    cpuPct: 42 + 16 * k,
    memPct: 54 + 6 * k,
    rps: 390 * (1 - 0.3 * k),
    latencyP95Ms: 480 * (1 + 1.4 * k),
    errorRate: Math.min(0.4, 0.006 + 0.12 * k),
    saturation: clamp01(0.25 + 0.6 * k),
  });

  svc("catalog-service", {
    cpuPct: 36 + 10 * k * 0.4,
    memPct: 50 + 4 * k,
    rps: 700 * (1 - 0.1 * k),
    latencyP95Ms: 160 * (1 + 0.55 * k),
    errorRate: Math.min(0.2, 0.002 + 0.04 * k),
    saturation: clamp01(0.25 + 0.35 * k),
  });

  svc("cart-service", {
    cpuPct: 33 + 8 * k * 0.4,
    memPct: 48 + 4 * k,
    rps: 480 * (1 - 0.08 * k),
    latencyP95Ms: 130 * (1 + 0.45 * k),
    errorRate: Math.min(0.15, 0.003 + 0.03 * k),
    saturation: clamp01(0.25 + 0.3 * k),
  });

  // Redis sees extra misses while search is slow.
  svc("redis-cache", {
    cpuPct: 38 + 18 * k,
    memPct: 62 + 5 * k,
    rps: 4200 * (1 + 0.2 * k),
    latencyP95Ms: 4 * (1 + 1.6 * k),
    errorRate: Math.min(0.05, 0.0005 + 0.01 * k),
    saturation: clamp01(0.35 + 0.45 * k),
  });

  // Primary works harder on ranking scans.
  svc("postgres-primary", {
    cpuPct: 48 + 30 * k,
    memPct: 64 + 8 * k,
    rps: 2400 * (1 + 0.1 * k),
    latencyP95Ms: 14 * (1 + 2.2 * k),
    errorRate: Math.min(0.15, 0.001 + 0.04 * k),
    saturation: clamp01(0.4 + 0.5 * k),
  });

  // External provider stays healthy — red herring.
  svc("payments-provider", {});

  const signatures = buildSignatures(f, q);
  return { fault: f, targets, signatures, events: [] };
}

function buildSignatures(f: ApiLatencyFault, q: QueueState) {
  const k = q.queue;
  const out: import("../types").SignatureLog[] = [];
  if (k < 0.1) return out;

  out.push({
    level: "warn",
    serviceId: "search-service",
    message: `worker pool saturated: ${f.threadPoolSize}/${f.threadPoolSize} threads busy`,
    fields: {
      pool_size: f.threadPoolSize,
      busy: f.threadPoolSize,
      queue_depth: Math.round(k * 620),
      oldest_wait_ms: Math.round(k * 2400),
    },
    count: Math.round(2 + k * 10),
  });

  out.push({
    level: "error",
    serviceId: "search-service",
    message: "search request aborted: queue wait exceeded 2000ms",
    fields: { limit_ms: 2000, waited_ms: Math.round(2000 + k * 1500), route: "/api/search" },
    count: Math.round(1 + k * 7),
  });

  out.push({
    level: "warn",
    serviceId: "api-gateway",
    message: "upstream timeout waiting for search-service (2000ms)",
    fields: { upstream: "search-service", timeout_ms: 2000, route: "/api/search" },
    count: Math.round(2 + k * 8),
  });

  out.push({
    level: "info",
    serviceId: "postgres-primary",
    message: "slow query: SELECT id, ts_rank_cd(doc, q) FROM products ORDER BY rank took 1840ms",
    fields: { table: "products", ms: 1840, plan: "Bitmap Scan" },
    count: Math.round(1 + k * 5),
  });

  out.push({
    level: "error",
    serviceId: "checkout-service",
    message: "recommendation lookup degraded — falling back to static list",
    fields: { upstream: "search-service", fallback: true },
    count: Math.round(k * 4),
  });

  if (f.cacheEnabled) {
    out.push({
      level: "info",
      serviceId: "search-service",
      message: "result cache enabled — hit ratio 54%",
      fields: { hit_ratio: 0.54, ttl_s: 30 },
      count: 2,
    });
  }
  if (f.queryThrottle) {
    out.push({
      level: "info",
      serviceId: "search-service",
      message: "expensive ranking queries throttled (max 40 concurrent)",
      fields: { max_concurrent: 40, throttled: Math.round(k * 120) },
      count: 2,
    });
  }
  if (f.rankingRollback) {
    out.push({
      level: "info",
      serviceId: "search-service",
      message: "rolled back search-ranking v1.9.0 → v1.8.4 — ts_rank full-scan removed",
      fields: { from: "v1.9.0", to: "v1.8.4", query_removed: "ts_rank_cd full scan" },
      count: 1,
    });
  }
  if (q.boost > 0) {
    out.push({
      level: "info",
      serviceId: "api-gateway",
      message: "gateway upstream connections recycled after restart",
      fields: { recycled: true, boost_remaining: Number(q.boost.toFixed(2)) },
      count: 1,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Scenario definition                                                   */
/* ------------------------------------------------------------------ */

export const apiLatencyScenario: ScenarioDefinition<ApiLatencyFault> = {
  id: "api-latency",
  name: "API latency degradation",
  tagline: "Response times creep up, requests pile up, and errors follow.",
  description:
    "A regression shipped in the search ranking path is saturating the bounded worker pool. Requests queue behind slow ranking queries, p95 latency climbs across the gateway, and timeout errors start appearing at the edge. Find the bottleneck and decide which corrective actions actually move the needle.",
  difficulty: "intermediate",
  onsetTick: 100,
  startTick: 118,
  seed: 0x1a7e11,
  entryRoute: "GET /api/search",
  services,
  edges,
  tracePaths,

  initialFault(): ApiLatencyFault {
    return {
      kind: "api-latency",
      onsetTick: 100,
      intensity: 0,
      threadPoolSize: 32,
      cacheEnabled: false,
      replicaCount: 1,
      queryThrottle: false,
      rankingRollback: false,
      restartBoost: 0,
      restartTick: null,
    };
  },

  advance,

  faultSummary(f) {
    const capacity = (f.threadPoolSize / 32) * f.replicaCount;
    return [
      { label: "Fault", value: "search-service worker pool saturation" },
      { label: "Worker pool", value: `${f.threadPoolSize} threads × ${f.replicaCount} replica(s)` },
      { label: "Effective capacity", value: `${capacity.toFixed(1)}× baseline` },
      { label: "Result cache", value: f.cacheEnabled ? "Enabled (TTL 30s)" : "Disabled" },
      { label: "Query throttle", value: f.queryThrottle ? "40 concurrent" : "Off" },
      { label: "Ranking release", value: f.rankingRollback ? "v1.8.4 (rolled back)" : "v1.9.0 (regressed)" },
      { label: "Demand intensity", value: `${Math.round(f.intensity * 100)}%` },
      {
        label: "Gateway restart",
        value: f.restartTick !== null ? `tick ${f.restartTick} (decaying)` : "—",
      },
    ];
  },

  actions: [
    {
      id: "enable-cache",
      name: "Enable search result cache",
      category: "mitigation",
      risk: "low",
      description:
        "Cache ranking results for 30s so repeated queries skip the worker pool entirely.",
      expected: "Queue depth should drop immediately as ~45% of query volume is absorbed.",
      sideEffects: "Freshness lag of up to 30s on search results.",
      apply(f) {
        if (f.cacheEnabled) {
          return { fault: f, notes: ["Result cache already enabled — no change."] };
        }
        return {
          fault: { ...f, cacheEnabled: true },
          notes: ["Enabled search result cache (TTL 30s, expected ~45% hit rate)."],
        };
      },
    },
    {
      id: "disable-cache",
      name: "Disable result cache",
      category: "experiment",
      risk: "high",
      description: "Turn caching off to observe how much load it was actually absorbing.",
      expected: "Queue pressure returns to pre-cache levels — a useful controlled experiment.",
      sideEffects: "Will worsen the incident if the cache was helping.",
      apply(f) {
        if (!f.cacheEnabled) {
          return { fault: f, notes: ["Result cache already disabled — no change."] };
        }
        return {
          fault: { ...f, cacheEnabled: false },
          notes: ["Disabled result cache — expect queue pressure to return within a tick."],
        };
      },
    },
    {
      id: "grow-threads",
      name: "Increase search worker pool",
      category: "mitigation",
      risk: "medium",
      description: "Double the search worker pool from 32 to 64 threads per replica.",
      expected: "Queue wait drops proportionally; CPU per request stays the same.",
      sideEffects: "More concurrent ranking scans raise primary DB CPU.",
      apply(f) {
        if (f.threadPoolSize >= 128) {
          return { fault: f, notes: ["Worker pool already at 128 threads — no change."] };
        }
        const next = Math.min(128, f.threadPoolSize * 2);
        return {
          fault: { ...f, threadPoolSize: next },
          notes: [`Increased search worker pool ${f.threadPoolSize} → ${next} threads.`],
        };
      },
    },
    {
      id: "scale-search",
      name: "Scale search-service replicas",
      category: "mitigation",
      risk: "low",
      description: "Add a search-service replica so the queue is split across two pools.",
      expected: "Effective capacity doubles; per-replica queue depth falls.",
      sideEffects: "Index warm-up on the new replica for the first few minutes.",
      apply(f) {
        if (f.replicaCount >= 4) {
          return { fault: f, notes: ["search-service already at 4 replicas — no change."] };
        }
        const next = f.replicaCount + 1;
        return {
          fault: { ...f, replicaCount: next },
          notes: [`Scaled search-service ${f.replicaCount} → ${next} replicas.`],
        };
      },
    },
    {
      id: "throttle-queries",
      name: "Throttle expensive ranking queries",
      category: "mitigation",
      risk: "low",
      description: "Limit ts_rank queries to 40 concurrent executions so the pool stops being monopolised.",
      expected: "Queue depth declines; a minority of queries are shed with 429.",
      sideEffects: "Some deep-ranking queries are rejected under load.",
      apply(f) {
        if (f.queryThrottle) {
          return { fault: f, notes: ["Ranking query throttle already active — no change."] };
        }
        return {
          fault: { ...f, queryThrottle: true },
          notes: ["Throttled expensive ranking queries to 40 concurrent."],
        };
      },
    },
    {
      id: "rollback-ranking",
      name: "Rollback search-ranking release",
      category: "fix",
      risk: "medium",
      description:
        "Roll back search-ranking v1.9.0 → v1.8.4 to remove the ts_rank full-scan regression shipped this morning.",
      expected: "The heavy query disappears — queue pressure should collapse over a few ticks.",
      sideEffects: "Ranking improvements from v1.9.0 are lost until a fixed version ships.",
      apply(f) {
        if (f.rankingRollback) {
          return { fault: f, notes: ["Ranking release already rolled back — no change."] };
        }
        return {
          fault: { ...f, rankingRollback: true },
          notes: [
            "Rolled back search-ranking to v1.8.4.",
            "The ts_rank full-scan query is gone — queue pressure should collapse.",
          ],
        };
      },
    },
    {
      id: "restart-gateway",
      name: "Recycle gateway connections",
      category: "experiment",
      risk: "low",
      description:
        "Restart api-gateway to drop accumulated upstream connections and give a clean baseline reading.",
      expected: "A brief dip in latency, then the queue re-forms — confirming the bottleneck is downstream.",
      sideEffects: "In-flight requests are dropped during the restart.",
      apply(f, tick) {
        return {
          fault: { ...f, restartBoost: 1, restartTick: tick },
          notes: [
            "Recycled api-gateway upstream connections.",
            "If latency rebounds within a few ticks, the bottleneck is search-service, not the gateway.",
          ],
        };
      },
    },
  ],

  triggers: [
    {
      id: "search-latency-slo",
      number: 1051,
      title: "API latency degradation — search path above SLO",
      description:
        "Gateway p95 has breached 800ms and search-service queue depth is climbing. Requests are accumulating ahead of the ranking worker pool.",
      severity: "sev2",
      serviceIds: ["search-service", "api-gateway", "edge-gateway"],
      when: ({ state, fault, targets }) =>
        state.tick >= (fault as ApiLatencyFault).onsetTick + 5 &&
        (targets["api-gateway"]?.latencyP95Ms ?? 0) > 340,
      escalateTo: {
        severity: "sev1",
        message: "Error rate climbing past 8% — queued requests are timing out at the edge.",
        when: ({ kpi }) => kpi.errorRate > 0.08,
      },
      resolveWhen: ({ kpi }) => kpi.health >= 88 && kpi.errorRate < 0.025,
    },
  ],

  hypotheses: [
    {
      id: "worker-pool-saturation",
      title: "search-service worker pool saturation from ranking regression",
      category: "Resource exhaustion",
      summary:
        "The v1.9.0 ranking query (ts_rank full scan) holds all 32 worker threads; every other search request queues behind it, and the gateway aggregates that wait into overall p95.",
      whyRelevant:
        "Worker-pool saturation logs, a deep queue, and timeouts clustered on search spans line up exactly with a bounded pool being monopolised by one slow query.",
      baseConfidence: 0.12,
      actual: true,
      slots: [
        {
          id: "pool-saturated-logs",
          weight: 3,
          collect: (ctx) => {
            const n = ctx.countLogs({
              serviceId: "search-service",
              levels: ["warn", "error"],
              contains: "worker pool",
            });
            if (n < 2) return null;
            return {
              kind: "log",
              title: `${n} worker-pool saturation events`,
              detail: "All threads busy with queue depth climbing — the pool itself is the ceiling.",
              href: "/logs?service=search-service&level=warn&q=worker%20pool",
            };
          },
        },
        {
          id: "search-saturation",
          weight: 2.5,
          collect: (ctx) => {
            const sat = ctx.avg("search-service", "saturation", 5);
            if (sat < 0.7) return null;
            return {
              kind: "metric",
              title: `search-service saturation at ${Math.round(sat * 100)}%`,
              detail: "Saturation near 100% means demand exceeds the bounded pool capacity.",
              href: "/services/search-service",
            };
          },
        },
        {
          id: "gateway-upstream-timeouts",
          weight: 2,
          collect: (ctx) => {
            const n = ctx.countLogs({
              serviceId: "api-gateway",
              levels: ["warn", "error"],
              contains: "search-service",
            });
            if (n < 3) return null;
            return {
              kind: "log",
              title: `${n} gateway timeouts waiting on search-service`,
              detail: "The gateway is the messenger — the wait happens downstream in search.",
              href: "/logs?service=api-gateway&level=warn&q=search",
            };
          },
        },
        {
          id: "search-trace-errors",
          weight: 2,
          collect: (ctx) => {
            const s = ctx.traceStats({ serviceId: "search-service", sinceTick: ctx.state.tick - 15 });
            if (s.total < 4 || s.errorPct < 0.15) return null;
            return {
              kind: "trace",
              title: `${Math.round(s.errorPct * 100)}% of search traces failing`,
              detail: "Failed spans sit on the search hop with long queue waits before execution.",
              href: "/traces?service=search-service&status=error",
            };
          },
        },
        {
          id: "search-latency-ratio",
          weight: 1.5,
          collect: (ctx) => {
            const ratio = ctx.ratioVsBaseline("search-service", "latencyP95Ms", 5);
            if (ratio < 2.5) return null;
            return {
              kind: "metric",
              title: `search p95 ${ratio.toFixed(1)}× baseline`,
              detail: "Latency growing while RPS falls rules out a pure traffic surge.",
              href: "/services/search-service",
            };
          },
        },
      ],
    },
    {
      id: "unindexed-query",
      title: "Missing index on products table",
      category: "Query performance",
      summary:
        "A schema change could have dropped an index, forcing sequential scans that slow every ranking query.",
      whyRelevant:
        "Slow-query logs and elevated primary CPU are real signals here — but they are a symptom of the same regressed query.",
      baseConfidence: 0.1,
      slots: [
        {
          id: "slow-query-logs",
          weight: 3,
          collect: (ctx) => {
            const n = ctx.countLogs({ serviceId: "postgres-primary", contains: "slow query" });
            // Distractor: an unindexed-query incident would flood the logs —
            // the modest counts seen during pool pressure don't qualify.
            if (n < 60) return null;
            return {
              kind: "log",
              title: `${n} slow ranking queries on primary`,
              detail: "Long-running ranking statements push DB CPU up.",
              href: "/logs?service=postgres-primary&q=slow%20query",
            };
          },
        },
        {
          id: "pg-cpu",
          weight: 2,
          collect: (ctx) => {
            const ratio = ctx.ratioVsBaseline("postgres-primary", "cpuPct", 5);
            if (ratio < 1.25) return null;
            return {
              kind: "metric",
              title: `postgres-primary CPU ${Math.round(ctx.avg("postgres-primary", "cpuPct", 5))}%`,
              detail: "Elevated CPU is consistent with full-table ranking scans.",
              href: "/services/postgres-primary",
            };
          },
        },
        {
          id: "search-cpu",
          weight: 1.5,
          collect: (ctx) => {
            const cpu = ctx.avg("search-service", "cpuPct", 5);
            if (cpu < 75) return null;
            return {
              kind: "metric",
              title: `search-service CPU at ${Math.round(cpu)}%`,
              detail: "High CPU on search corroborates expensive per-request work.",
              href: "/services/search-service",
            };
          },
        },
      ],
    },
    {
      id: "cache-stampede",
      title: "Cache stampede after Redis flush",
      category: "Cache",
      summary:
        "A Redis flush would send every read straight to the database, inflating latency across services.",
      whyRelevant:
        "Cache misses show up as Redis CPU spikes — check whether redis metrics moved before blaming the search pool.",
      baseConfidence: 0.08,
      slots: [
        {
          id: "redis-cpu",
          weight: 2.5,
          collect: (ctx) => {
            const ratio = ctx.ratioVsBaseline("redis-cache", "cpuPct", 5);
            if (ratio < 1.4) return null;
            return {
              kind: "metric",
              title: `redis CPU ${Math.round(ctx.avg("redis-cache", "cpuPct", 5))}%`,
              detail: "A stampede typically drives Redis CPU and evictions sharply higher.",
              href: "/services/redis-cache",
            };
          },
        },
        {
          id: "cache-miss-logs",
          weight: 2.5,
          collect: (ctx) => {
            const n = ctx.countLogs({ contains: "cache miss" });
            if (n < 3) return null;
            return {
              kind: "log",
              title: `${n} cache-miss events`,
              detail: "Mass misses would explain sudden database load.",
              href: "/logs?q=cache%20miss",
            };
          },
        },
        {
          id: "broad-latency",
          weight: 1.5,
          collect: (ctx) => {
            const ratio = ctx.ratioVsBaseline("catalog-service", "latencyP95Ms", 5);
            if (ratio < 1.4) return null;
            return {
              kind: "metric",
              title: `catalog latency ${ratio.toFixed(1)}× baseline`,
              detail: "Broad latency across services fits a shared cache problem.",
              href: "/services/catalog-service",
            };
          },
        },
      ],
    },
    {
      id: "payments-provider-slow",
      title: "External payments provider slowdown",
      category: "External dependency",
      summary:
        "Checkout latency could be dragged up by a slow third-party payment processor.",
      whyRelevant:
        "Vendor latency often looks like our own regression — verify the provider's spans before acting on it.",
      baseConfidence: 0.07,
      slots: [
        {
          id: "provider-latency",
          weight: 3,
          collect: (ctx) => {
            const ratio = ctx.ratioVsBaseline("payments-provider", "latencyP95Ms", 5);
            if (ratio < 1.4) return null;
            return {
              kind: "metric",
              title: `payments-provider p95 ${ratio.toFixed(1)}× baseline`,
              detail: "Vendor-side latency would push checkout spans up directly.",
              href: "/services/payments-provider",
            };
          },
        },
        {
          id: "checkout-errors",
          weight: 2,
          collect: (ctx) => {
            const err = ctx.avg("checkout-service", "errorRate", 5);
            if (err < 0.04) return null;
            return {
              kind: "metric",
              title: `checkout error rate ${Math.round(err * 100)}%`,
              detail: "Checkout failures rising points toward the payment hop.",
              href: "/services/checkout-service",
            };
          },
        },
        {
          id: "provider-logs",
          weight: 2,
          collect: (ctx) => {
            const n = ctx.countLogs({ serviceId: "payments-provider", levels: ["error", "fatal"] });
            if (n < 2) return null;
            return {
              kind: "log",
              title: `${n} provider error logs`,
              detail: "Direct vendor errors would confirm an external outage.",
              href: "/logs?service=payments-provider&level=error",
            };
          },
        },
      ],
    },
    {
      id: "traffic-spike",
      title: "Global traffic surge",
      category: "Demand",
      summary:
        "A marketing campaign or bot burst could simply be exceeding capacity.",
      whyRelevant:
        "The most common innocent explanation — check RPS and edge CPU first; if flat, move on quickly.",
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
              detail: "A demand surge raises RPS and CPU together.",
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
              detail: "Sustained edge CPU saturation supports a demand-driven incident.",
              href: "/services/edge-gateway",
            };
          },
        },
      ],
    },
  ],
};
