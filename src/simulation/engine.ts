import type {
  SimState,
  ScenarioDefinition,
  ScenarioId,
  ServiceDef,
  ServiceRuntime,
  MetricSample,
  LogEntry,
  Trace,
  TraceSpan,
  Incident,
  TimelineEvent,
  ActivityEvent,
  KpiSnapshot,
  AppliedAction,
  HealthStatus,
  ImpactTarget,
  SignatureLog,
  LogLevel,
} from "./types";
import { rand, noise, wave, clamp, clamp01, pick } from "./rng";
import {
  TICK_MS,
  SIM_EPOCH_MS,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_LOG_LIMIT,
  DEFAULT_TRACE_LIMIT,
  HEALTH,
} from "./config";
import { getScenario } from "./scenarios";

/* ------------------------------------------------------------------ */
/* Time helpers                                                         */
/* ------------------------------------------------------------------ */

export function simTimeAt(tick: number): number {
  return SIM_EPOCH_MS + tick * TICK_MS;
}

/* ------------------------------------------------------------------ */
/* Status & sample construction                                         */
/* ------------------------------------------------------------------ */

export function deriveStatus(
  sample: MetricSample,
  def: ServiceDef,
  forced?: HealthStatus,
): HealthStatus {
  if (forced) return forced;
  const latRatio = sample.latencyP95Ms / Math.max(1, def.baseline.latencyP95Ms);
  if (sample.errorRate >= 0.2 || latRatio >= 3 || sample.saturation >= 0.9) return "critical";
  if (sample.errorRate >= 0.04 || latRatio >= 1.6 || sample.saturation >= 0.72) return "degraded";
  return "healthy";
}

function buildSample(
  def: ServiceDef,
  target: ImpactTarget,
  seed: number,
  tick: number,
): MetricSample {
  const j = (amp: number, stream: string) => noise(seed, amp, tick, def.id, stream);
  // A subtle deterministic demand rhythm keeps healthy metrics organic.
  const rhythm = 1 + 0.05 * wave(tick, 24, rand(seed, def.id, "phase") * Math.PI * 2);
  const latRhythm = 1 + 0.04 * wave(tick, 17, rand(seed, def.id, "lphase") * Math.PI * 2);

  return {
    t: tick,
    ts: simTimeAt(tick),
    cpuPct: clamp(target.cpuPct + j(3.5, "cpu"), 0, 100),
    memPct: clamp(target.memPct + j(2, "mem"), 0, 100),
    rps: Math.max(0, target.rps * (1 + j(0.05, "rps")) * rhythm),
    latencyP95Ms: Math.max(2, target.latencyP95Ms * (1 + j(0.07, "lat")) * latRhythm),
    errorRate: clamp(target.errorRate * (1 + j(0.18, "err")), 0, 1),
    saturation: clamp(target.saturation + j(0.03, "sat"), 0, 1),
  };
}

/* ------------------------------------------------------------------ */
/* KPIs                                                                 */
/* ------------------------------------------------------------------ */

export function computeKpi(
  services: Record<string, ServiceRuntime>,
  defs: ServiceDef[],
): KpiSnapshot {
  let weightSum = 0;
  let errSum = 0;
  let latSum = 0;
  let latPenaltySum = 0;
  let satSum = 0;
  let down = 0;
  let degraded = 0;

  for (const def of defs) {
    const rt = services[def.id];
    if (!rt) continue;
    const w = def.baseline.rps;
    weightSum += w;
    errSum += w * rt.current.errorRate;
    latSum += w * rt.current.latencyP95Ms;
    latPenaltySum += w * Math.max(0, rt.current.latencyP95Ms / Math.max(1, def.baseline.latencyP95Ms) - 1);
    satSum += w * rt.current.saturation;
    if (rt.status === "down") down += 1;
    else if (rt.status === "critical" || rt.status === "degraded") degraded += 1;
  }

  const total = Math.max(1, weightSum);
  const avgErr = errSum / total;
  const avgLat = latSum / total;
  const latPenalty = latPenaltySum / total;
  const avgSat = satSum / total;

  let health =
    100 -
    avgErr * HEALTH.errorWeight -
    latPenalty * HEALTH.latencyWeight -
    down * HEALTH.downPenalty -
    degraded * HEALTH.degradedPenalty -
    Math.max(0, avgSat - HEALTH.saturationThreshold) * HEALTH.saturationPenalty;
  health = clamp(Math.round(health * 10) / 10, 0, 100);

  return {
    tick: 0,
    health,
    errorRate: clamp01(avgErr),
    latencyP95Ms: Math.round(avgLat),
    availability: clamp01((defs.length - down) / Math.max(1, defs.length)),
    downServices: down,
    degradedServices: degraded,
  };
}

/* ------------------------------------------------------------------ */
/* Trace generation                                                     */
/* ------------------------------------------------------------------ */

function generateTraces(
  state: SimState,
  scenario: ScenarioDefinition,
  targets: Record<string, ImpactTarget>,
  tick: number,
): Trace[] {
  const defs = new Map(scenario.services.map((s) => [s.id, s]));
  let avgErr = 0;
  let w = 0;
  for (const def of scenario.services) {
    avgErr += def.baseline.rps * (targets[def.id]?.errorRate ?? 0);
    w += def.baseline.rps;
  }
  avgErr = w > 0 ? avgErr / w : 0;

  const count = clamp(2 + Math.round(avgErr * 16), 2, 10);
  const out: Trace[] = [];
  const tsBase = simTimeAt(tick);

  for (let i = 0; i < count; i++) {
    const path = pick(scenario.tracePaths, state.seed, tick, i, "path");
    const spans: TraceSpan[] = [];
    let cursor = 0;
    let status: Trace["status"] = "ok";
    let endedEarly = false;

    for (let idx = 0; idx < path.length; idx++) {
      const serviceId = path[idx];
      const def = defs.get(serviceId);
      const target = targets[serviceId];
      if (!def || !target) break;

      const kind: TraceSpan["kind"] =
        def.kind === "data"
          ? "db"
          : def.kind === "cache"
            ? "cache"
            : def.kind === "external"
              ? "http"
              : def.kind === "gateway" || def.kind === "edge"
                ? "http"
                : "rpc";

      const spanId = `sp-${tick}-${i}-${idx}`;
      const durRnd = rand(state.seed, tick, i, idx, "dur");
      const durationMs = Math.max(1, Math.round(target.latencyP95Ms * (0.3 + durRnd * 0.5)));
      const errRnd = rand(state.seed, tick, i, idx, "err");

      let spanStatus: TraceSpan["status"] = "ok";
      if (target.status === "down") {
        spanStatus = "error";
      } else if (target.errorRate >= 0.05 && errRnd < Math.min(0.92, target.errorRate * 2.6)) {
        spanStatus = "error";
      } else if (
        target.latencyP95Ms > def.baseline.latencyP95Ms * 2.5 &&
        errRnd > 0.6
      ) {
        spanStatus = "timeout";
      }

      const span: TraceSpan = {
        id: spanId,
        serviceId,
        name: spanName(def, scenario.entryRoute, kind),
        kind,
        startMs: cursor,
        durationMs,
        status: spanStatus,
        parentId: idx > 0 ? spans[idx - 1]?.id : undefined,
        attributes: spanAttributes(def, target, kind, spanStatus),
      };
      spans.push(span);
      cursor += durationMs;

      if (spanStatus !== "ok") {
        status = spanStatus === "timeout" ? "timeout" : "error";
        endedEarly = target.status === "down" || target.errorRate >= 0.35;
      }
      if (endedEarly) break;
    }

    const durationMs = spans.reduce((acc, s) => Math.max(acc, s.startMs + s.durationMs), 0);
    out.push({
      id: `tr-${tick}-${i}`,
      tick,
      ts: tsBase + Math.floor(rand(state.seed, tick, i, "ts") * TICK_MS),
      rootName: scenario.entryRoute,
      entryServiceId: path[0],
      durationMs,
      status,
      spans,
    });
  }
  return out;
}

function spanName(def: ServiceDef, route: string, kind: TraceSpan["kind"]): string {
  if (kind === "db") return "SELECT / INSERT statement";
  if (kind === "cache") return "cache lookup";
  if (def.kind === "edge") return route;
  if (def.kind === "gateway") return `handle ${route.split(" ")[0] ?? "GET"} ${route.split(" ")[1] ?? "/"}`;
  if (def.kind === "external") return "provider call";
  return `${def.name}.Handle`;
}

function spanAttributes(
  def: ServiceDef,
  target: ImpactTarget,
  kind: TraceSpan["kind"],
  status: TraceSpan["status"],
): Record<string, string | number> {
  const attrs: Record<string, string | number> = {
    "service.name": def.name,
    "service.version": "2026.11.3",
  };
  if (kind === "db") {
    attrs["db.system"] = "postgresql";
    attrs["db.operation"] = "SELECT";
    attrs["net.peer.name"] = def.name;
  } else if (kind === "cache") {
    attrs["db.system"] = "redis";
  } else {
    attrs["rpc.system"] = "grpc";
  }
  attrs["http.status_code"] =
    status === "ok" ? 200 : status === "timeout" ? 504 : target.status === "down" ? 503 : 500;
  return attrs;
}

/* ------------------------------------------------------------------ */
/* Log generation                                                       */
/* ------------------------------------------------------------------ */

const HEALTHY_TEMPLATES: Record<string, string[]> = {
  edge: [
    "TLS handshake complete — client {tls} established",
    "access: {route} {ms}ms from {ip}",
    "upstream health check ok",
  ],
  gateway: ["route served: {route}", "session token verified", "upstream connection pool steady"],
  service: ["handled request: {route}", "background flush complete", "config snapshot applied"],
  data: ["checkpoint complete", "autovacuum finished", "replication stream healthy"],
  cache: ["background save ok", "expired keys evicted", "replica link healthy"],
  external: ["vendor heartbeat ok", "provider healthcheck ok"],
};

const SLOW_TEMPLATE =
  "slow request: {route} took {ms}ms (budget {budget}ms exceeded)";

const ERROR_TEMPLATES = [
  "request failed: upstream {dep} returned {status}",
  "handler error: context deadline exceeded after {ms}ms",
  "request aborted while waiting on {dep}",
  "{route} failed with {status} — dependency unavailable",
];

const DOWN_TEMPLATES = [
  "instance failing readiness probes — marking unhealthy",
  "cannot serve {route}: dependency chain broken",
];

function fillTemplate(tpl: string, values: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? "-"));
}

function generateLogs(
  state: SimState,
  scenario: ScenarioDefinition,
  targets: Record<string, ImpactTarget>,
  signatures: SignatureLog[],
  traces: Trace[],
  tick: number,
): LogEntry[] {
  const out: LogEntry[] = [];
  const tsBase = simTimeAt(tick);
  const failingTraces = traces.filter((t) => t.status !== "ok");
  const downstreamBySource = new Map<string, string[]>();
  for (const e of scenario.edges) {
    const list = downstreamBySource.get(e.source) ?? [];
    list.push(e.target);
    downstreamBySource.set(e.source, list);
  }
  const routes = [scenario.entryRoute, "GET /api/health", "GET /api/me", "GET /api/catalog"];
  let n = 0;
  const seqId = () => {
    n += 1;
    return `log-${tick}-${n}`;
  };

  const maybeTrace = (level: LogLevel): string | undefined => {
    if (level !== "error" && level !== "fatal" && level !== "warn") return undefined;
    if (failingTraces.length === 0) return undefined;
    if (rand(state.seed, tick, n, "trace-link") < 0.45) {
      return failingTraces[Math.floor(rand(state.seed, tick, n, "pick") * failingTraces.length)]!.id;
    }
    return undefined;
  };

  for (const def of scenario.services) {
    const target = targets[def.id];
    if (!target) continue;
    const baseCount =
      def.kind === "edge" ? 4 : def.kind === "gateway" ? 3 : def.kind === "service" ? 2 : 1;
    const base = Math.floor(rand(state.seed, tick, def.id, "base") * (baseCount + 1));

    for (let i = 0; i < base; i++) {
      const pool = HEALTHY_TEMPLATES[def.kind] ?? HEALTHY_TEMPLATES.service;
      const tpl = pick(pool, state.seed, tick, def.id, i, "tpl");
      const route = pick(routes, state.seed, tick, def.id, i, "route");
      const ms = Math.max(1, Math.round(target.latencyP95Ms * (0.2 + rand(state.seed, tick, def.id, i, "ms") * 0.6)));
      out.push({
        id: seqId(),
        tick,
        ts: tsBase + Math.floor(rand(state.seed, tick, def.id, i, "ts") * TICK_MS),
        level: rand(state.seed, tick, def.id, i, "lvl") < 0.35 ? "debug" : "info",
        serviceId: def.id,
        message: fillTemplate(tpl, { route, ms, ip: "10.4.1." + (10 + Math.floor(rand(state.seed, tick, def.id, i, "ip") * 200)), tls: "TLSv1.3", budget: def.baseline.latencyP95Ms }),
        fields: { env: "prod", region: "us-east-1", component: def.name },
      });
    }

    // Slow-request warnings when latency is well above baseline.
    if (target.latencyP95Ms > def.baseline.latencyP95Ms * 1.7 && target.errorRate < 0.5) {
      const count = clamp(Math.round((target.latencyP95Ms / def.baseline.latencyP95Ms - 1.5) * 3), 1, 8);
      for (let i = 0; i < count; i++) {
        const route = pick(routes, state.seed, tick, def.id, i, "sroute");
        out.push({
          id: seqId(),
          tick,
          ts: tsBase + Math.floor(rand(state.seed, tick, def.id, i, "sts") * TICK_MS),
          level: "warn",
          serviceId: def.id,
          message: fillTemplate(SLOW_TEMPLATE, {
            route,
            ms: Math.round(target.latencyP95Ms),
            budget: Math.round(def.baseline.latencyP95Ms * 1.5),
          }),
          traceId: maybeTrace("warn"),
          fields: {
            route,
            duration_ms: Math.round(target.latencyP95Ms),
            budget_ms: Math.round(def.baseline.latencyP95Ms * 1.5),
          },
        });
      }
    }

    // Error logs scale with the service error rate.
    if (target.errorRate > 0.01) {
      const errCount = clamp(
        Math.round(target.errorRate * (6 + target.rps / 80)),
        1,
        26,
      );
      const deps = downstreamBySource.get(def.id) ?? ["postgres-primary"];
      for (let i = 0; i < errCount; i++) {
        const isFatal = target.status === "down" && rand(state.seed, tick, def.id, i, "f") < 0.3;
        const tpl = isFatal
          ? pick(DOWN_TEMPLATES, state.seed, tick, def.id, i, "dtpl")
          : pick(ERROR_TEMPLATES, state.seed, tick, def.id, i, "etpl");
        const dep = pick(deps, state.seed, tick, def.id, i, "dep");
        const route = pick(routes, state.seed, tick, def.id, i, "eroute");
        const status = pick([502, 503, 504, 500], state.seed, tick, def.id, i, "code");
        const ms = Math.round(target.latencyP95Ms * (1.2 + rand(state.seed, tick, def.id, i, "ems") * 1.4));
        out.push({
          id: seqId(),
          tick,
          ts: tsBase + Math.floor(rand(state.seed, tick, def.id, i, "ets") * TICK_MS),
          level: isFatal ? "fatal" : rand(state.seed, tick, def.id, i, "elvl") < 0.25 ? "warn" : "error",
          serviceId: def.id,
          message: fillTemplate(tpl, { dep, route, status, ms }),
          traceId: maybeTrace(isFatal ? "fatal" : "error"),
          fields: {
            route,
            upstream: dep,
            status,
            duration_ms: ms,
            env: "prod",
          },
        });
      }
    }
  }

  // Scenario-specific signature logs (the smoking-gun evidence).
  for (const sig of signatures) {
    for (let i = 0; i < sig.count; i++) {
      out.push({
        id: seqId(),
        tick,
        ts: tsBase + Math.floor(rand(state.seed, tick, sig.serviceId, sig.message, i, "sts") * TICK_MS),
        level: sig.level,
        serviceId: sig.serviceId,
        message: sig.message,
        traceId: maybeTrace(sig.level),
        fields: { ...sig.fields, env: "prod" },
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Incident triggers                                                    */
/* ------------------------------------------------------------------ */

function openIncident(
  scenario: ScenarioDefinition,
  triggerIdx: number,
  tick: number,
  events: { kind: TimelineEvent["kind"]; message: string }[],
): Incident {
  const trigger = scenario.triggers[triggerIdx]!;
  const ts = simTimeAt(tick);
  const timeline: TimelineEvent[] = [
    {
      id: `tl-${trigger.number}-open`,
      ts,
      tick,
      kind: "triggered",
      message: `Incident declared: ${trigger.title} (${trigger.severity.toUpperCase()})`,
      actor: "system",
    },
    ...events.map((e, i) => ({
      id: `tl-${trigger.number}-ev-${i}`,
      ts,
      tick,
      kind: e.kind,
      message: e.message,
      actor: "system" as const,
    })),
    {
      id: `tl-${trigger.number}-detect`,
      ts,
      tick,
      kind: "detected",
      message: trigger.description,
      actor: "system",
    },
  ];
  return {
    id: `inc-${trigger.number}`,
    scenarioId: scenario.id,
    number: `INC-${trigger.number}`,
    triggerId: trigger.id,
    title: trigger.title,
    description: trigger.description,
    severity: trigger.severity,
    status: "triggered",
    serviceIds: trigger.serviceIds,
    openedTick: tick,
    openedTs: ts,
    timeline,
  };
}

function historicalIncidents(scenarioId: ScenarioId): Incident[] {
  return [
    {
      id: "inc-1031",
      scenarioId,
      number: "INC-1031",
      triggerId: "historical-redis",
      title: "Redis primary failover in us-east-1",
      description:
        "The session cache primary was evicted under memory pressure and failed over to the replica, causing elevated login latency for ~11 minutes.",
      severity: "sev2",
      status: "resolved",
      serviceIds: ["redis-cache"],
      openedTick: -520,
      openedTs: simTimeAt(-520),
      resolvedTick: -509,
      resolvedTs: simTimeAt(-509),
      rootCause: {
        hypothesisId: "hist-redis-eviction",
        title: "maxmemory policy rejected new sessions during traffic peak",
        confidence: 0.91,
        setBy: "engine",
        atTick: -514,
      },
      resolution:
        "Promoted replica to primary, raised maxmemory-policy to volatile-lru, and restored client connections. Cache hit rate normalised within 4 minutes.",
      timeline: [
        { id: "tl-1031-1", ts: simTimeAt(-520), tick: -520, kind: "triggered", message: "Login latency SLO breached — redis failover suspected", actor: "system" },
        { id: "tl-1031-2", ts: simTimeAt(-519), tick: -519, kind: "acknowledged", message: "Acknowledged by on-call (sre-primary)", actor: "user" },
        { id: "tl-1031-3", ts: simTimeAt(-514), tick: -514, kind: "note", message: "Eviction spikes confirmed — maxmemory-policy noeviction rejecting writes", actor: "user" },
        { id: "tl-1031-4", ts: simTimeAt(-511), tick: -511, kind: "action", message: "Replica promoted, clients re-pointed", actor: "user" },
        { id: "tl-1031-5", ts: simTimeAt(-509), tick: -509, kind: "resolved", message: "Resolved — cache hit ratio back to 96%", actor: "user" },
      ],
    },
    {
      id: "inc-1028",
      scenarioId,
      number: "INC-1028",
      triggerId: "historical-provider",
      title: "Elevated checkout errors from payment provider",
      description:
        "Checkout failures rose after a provider-side configuration change altered decline handling.",
      severity: "sev3",
      status: "resolved",
      serviceIds: ["payments-service"],
      openedTick: -760,
      openedTs: simTimeAt(-760),
      resolvedTick: -742,
      resolvedTs: simTimeAt(-742),
      rootCause: {
        hypothesisId: "hist-provider-config",
        title: "Provider decline-rate webhook misconfigured to hard-fail",
        confidence: 0.87,
        setBy: "user",
        atTick: -748,
      },
      resolution:
        "Provider configuration reverted; soft-decline handling restored. Added synthetic checkout canary.",
      timeline: [
        { id: "tl-1028-1", ts: simTimeAt(-760), tick: -760, kind: "triggered", message: "Checkout success rate below 97%", actor: "system" },
        { id: "tl-1028-2", ts: simTimeAt(-759), tick: -759, kind: "acknowledged", message: "Acknowledged by on-call (payments)", actor: "user" },
        { id: "tl-1028-3", ts: simTimeAt(-748), tick: -748, kind: "note", message: "Provider webhook payload shows hard-fail on soft declines", actor: "user" },
        { id: "tl-1028-4", ts: simTimeAt(-742), tick: -742, kind: "resolved", message: "Resolved after provider config revert", actor: "user" },
      ],
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Tick computation                                                     */
/* ------------------------------------------------------------------ */

interface ComputeOptions {
  /** When true, activity-feed noise is suppressed (used during warmup). */
  quietActivity?: boolean;
}

function computeTick(
  state: SimState,
  scenario: ScenarioDefinition,
  tick: number,
  opts: ComputeOptions = {},
): SimState {
  const adv = scenario.advance(state.fault, tick);
  const targets = adv.targets;

  /* metrics + runtimes */
  const metrics: Record<string, MetricSample[]> = {};
  const services: Record<string, ServiceRuntime> = {};
  for (const def of scenario.services) {
    const target = targets[def.id] ?? {
      cpuPct: def.baseline.cpuPct,
      memPct: def.baseline.memPct,
      rps: def.baseline.rps,
      latencyP95Ms: def.baseline.latencyP95Ms,
      errorRate: def.baseline.errorRate,
      saturation: 0.3,
    };
    const sample = buildSample(def, target, state.seed, tick);
    const prev = state.metrics[def.id] ?? [];
    const series = [...prev, sample].slice(-state.historyLimit);

    const window = series.slice(-10);
    const availability = clamp01(
      1 - window.reduce((a, s) => a + s.errorRate, 0) / Math.max(1, window.length),
    );

    metrics[def.id] = series;
    services[def.id] = {
      id: def.id,
      status: deriveStatus(sample, def, target.status),
      current: sample,
      availability,
    };
  }

  const kpi = computeKpi(services, scenario.services);
  kpi.tick = tick;

  /* traces then logs (logs may reference failing trace ids) */
  const traces = [...state.traces, ...generateTraces(state, scenario, targets, tick)].slice(
    -state.traceLimit,
  );
  const newLogs = generateLogs(state, scenario, targets, adv.signatures, traces, tick);
  const logs = [...state.logs, ...newLogs].slice(-state.logLimit);

  /* activity from scenario events */
  let seq = state.seq;
  const activity: ActivityEvent[] = [...state.activity];
  const pushActivity = (e: Omit<ActivityEvent, "id">) => {
    seq += 1;
    activity.push({ ...e, id: `act-${seq}` });
  };

  if (!opts.quietActivity) {
    for (const ev of adv.events) {
      pushActivity({
        tick,
        ts: simTimeAt(tick),
        kind: "system",
        message: ev.message,
        href: "/dependencies",
      });
    }
  }

  /* incidents */
  const incidents: Incident[] = state.incidents.map((inc) => ({ ...inc, timeline: [...inc.timeline] }));
  const tickState: SimState = {
    ...state,
    tick,
    simTimeMs: simTimeAt(tick),
    services,
    metrics,
    health: kpi.health,
  };
  const triggerCtx = { state: tickState, fault: adv.fault, targets, kpi };

  for (let ti = 0; ti < scenario.triggers.length; ti++) {
    const trigger = scenario.triggers[ti]!;
    const existingIdx = incidents.findIndex(
      (i) => i.triggerId === trigger.id && i.scenarioId === scenario.id,
    );

    if (existingIdx === -1) {
      if (trigger.when(triggerCtx)) {
        const evMsgs = adv.events.map((e) => ({ kind: "detected" as const, message: e.message }));
        const inc = openIncident(scenario, ti, tick, evMsgs);
        incidents.push(inc);
        if (!opts.quietActivity) {
          pushActivity({
            tick,
            ts: simTimeAt(tick),
            kind: "incident",
            message: `${inc.number} opened — ${inc.title}`,
            href: `/incidents/${inc.id}`,
          });
        }
      }
      continue;
    }

    const inc = incidents[existingIdx]!;
    if (inc.status === "resolved") continue;

    // Escalation
    if (trigger.escalateTo && inc.severity !== trigger.escalateTo.severity && trigger.escalateTo.when(triggerCtx)) {
      inc.severity = trigger.escalateTo.severity;
      seq += 1;
      inc.timeline.push({
        id: `tl-${seq}`,
        ts: simTimeAt(tick),
        tick,
        kind: "escalated",
        message: `Escalated to ${trigger.escalateTo.severity.toUpperCase()} — ${trigger.escalateTo.message}`,
        actor: "system",
      });
      if (!opts.quietActivity) {
        pushActivity({
          tick,
          ts: simTimeAt(tick),
          kind: "incident",
          message: `${inc.number} escalated to ${inc.severity.toUpperCase()}`,
          href: `/incidents/${inc.id}`,
        });
      }
    }

    // Relapse note for cascading-style incidents
    if (adv.events.some((e) => e.kind === "relapse")) {
      seq += 1;
      inc.timeline.push({
        id: `tl-${seq}`,
        ts: simTimeAt(tick),
        tick,
        kind: "relapsed",
        message: "auth-service crashed again — recovery did not hold",
        actor: "system",
      });
      if (!opts.quietActivity) {
        pushActivity({
          tick,
          ts: simTimeAt(tick),
          kind: "incident",
          message: `${inc.number} relapse — auth-service crashed again`,
          href: `/incidents/${inc.id}`,
        });
      }
    }

    // Auto-resolve
    if (trigger.resolveWhen && trigger.resolveWhen(triggerCtx)) {
      inc.status = "resolved";
      inc.resolvedTick = tick;
      inc.resolvedTs = simTimeAt(tick);
      inc.resolution = `System health recovered (health ${kpi.health}%) — auto-resolved by the simulation engine.`;
      seq += 1;
      inc.timeline.push({
        id: `tl-${seq}`,
        ts: simTimeAt(tick),
        tick,
        kind: "auto_resolved",
        message: `Auto-resolved — health score back to ${kpi.health}%`,
        actor: "system",
      });
      if (!opts.quietActivity) {
        pushActivity({
          tick,
          ts: simTimeAt(tick),
          kind: "incident",
          message: `${inc.number} auto-resolved (health ${kpi.health}%)`,
          href: `/incidents/${inc.id}`,
        });
      }
    }
  }

  const healthSeries = [
    ...state.healthSeries,
    { t: tick, ts: simTimeAt(tick), health: kpi.health },
  ].slice(-state.historyLimit);

  return {
    ...state,
    tick,
    simTimeMs: simTimeAt(tick),
    fault: adv.fault,
    metrics,
    services,
    healthSeries,
    logs,
    traces,
    incidents,
    activity: activity.slice(-60),
    health: kpi.health,
    seq,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

export interface InitialStateOptions {
  historyLimit?: number;
  logLimit?: number;
  traceLimit?: number;
}

export function createInitialState(
  scenarioId: ScenarioId,
  opts: InitialStateOptions = {},
): SimState {
  const scenario = getScenario(scenarioId);
  const historyLimit = opts.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const logLimit = opts.logLimit ?? DEFAULT_LOG_LIMIT;
  const traceLimit = opts.traceLimit ?? DEFAULT_TRACE_LIMIT;

  let state: SimState = {
    scenarioId: scenario.id,
    seed: scenario.seed,
    tick: 0,
    simStartMs: SIM_EPOCH_MS,
    simTimeMs: SIM_EPOCH_MS,
    services: {},
    metrics: {},
    healthSeries: [],
    logs: [],
    traces: [],
    incidents: historicalIncidents(scenario.id),
    activity: [],
    actions: [],
    health: 100,
    fault: scenario.initialFault(),
    seq: 1000,
    historyLimit,
    logLimit,
    traceLimit,
  };

  // Warm up history so the app opens on a populated, mid-incident snapshot.
  for (let t = 1; t <= scenario.startTick; t++) {
    state = computeTick(state, scenario, t, { quietActivity: true });
  }

  const seededActivity: ActivityEvent[] = [
    {
      id: "act-seed-1",
      tick: scenario.startTick,
      ts: simTimeAt(scenario.startTick),
      kind: "scenario",
      message: `Scenario loaded: ${scenario.name}`,
      href: "/dashboard",
    },
    ...state.activity.filter((a) => a.kind === "incident"),
  ];
  state = {
    ...state,
    activity: seededActivity.slice(-60),
  };

  return state;
}

export function step(state: SimState): SimState {
  const scenario = getScenario(state.scenarioId);
  if (state.tick >= scenario.onsetTick + 480) return state; // safety cap
  return computeTick(state, scenario, state.tick + 1);
}

/** Re-run the current tick's metric/target computation with a (new) fault. */
function recomputeCurrent(state: SimState, scenario: ScenarioDefinition, fault: SimState["fault"]): SimState {
  const adv = scenario.advance(fault, state.tick);
  const tick = state.tick;
  const metrics: Record<string, MetricSample[]> = { ...state.metrics };
  const services: Record<string, ServiceRuntime> = { ...state.services };

  for (const def of scenario.services) {
    const target = adv.targets[def.id];
    if (!target) continue;
    const sample = buildSample(def, target, state.seed, tick);
    const series = [...(state.metrics[def.id] ?? [])];
    if (series.length > 0 && series[series.length - 1]!.t === tick) {
      series[series.length - 1] = sample;
    } else {
      series.push(sample);
    }
    metrics[def.id] = series.slice(-state.historyLimit);
    const window = series.slice(-10);
    services[def.id] = {
      id: def.id,
      status: deriveStatus(sample, def, target.status),
      current: sample,
      availability: clamp01(
        1 - window.reduce((a, s) => a + s.errorRate, 0) / Math.max(1, window.length),
      ),
    };
  }

  const kpi = computeKpi(services, scenario.services);
  const healthSeries = [...state.healthSeries];
  if (healthSeries.length > 0 && healthSeries[healthSeries.length - 1]!.t === tick) {
    healthSeries[healthSeries.length - 1] = { t: tick, ts: simTimeAt(tick), health: kpi.health };
  }

  return {
    ...state,
    fault: adv.fault,
    metrics,
    services,
    healthSeries,
    health: kpi.health,
  };
}

function withNoteLog(state: SimState, message: string, fields: Record<string, string | number | boolean>): SimState {
  const seq = state.seq + 1;
  const entry: LogEntry = {
    id: `log-${state.tick}-${seq}`,
    tick: state.tick,
    ts: simTimeAt(state.tick),
    level: "info",
    serviceId: "api-gateway",
    message,
    fields: { ...fields, operator: "oncall-sre" },
  };
  return { ...state, seq, logs: [...state.logs, entry].slice(-state.logLimit) };
}

export function applyAction(state: SimState, actionId: string): SimState {
  const scenario = getScenario(state.scenarioId);
  const action = scenario.actions.find((a) => a.id === actionId);
  if (!action) return state;

  const before = computeKpi(state.services, scenario.services);
  before.tick = state.tick;

  const applied = action.apply(state.fault, state.tick);
  let next = recomputeCurrent(state, scenario, applied.fault);
  const after = computeKpi(next.services, scenario.services);
  after.tick = state.tick;

  const seq = next.seq + 1;
  const record: AppliedAction = {
    id: `ua-${seq}`,
    actionId,
    name: action.name,
    tick: state.tick,
    ts: simTimeAt(state.tick),
    notes: applied.notes,
    rolledBack: false,
    faultBefore: state.fault,
    kpiBefore: before,
    kpiAfter: after,
  };

  // Audit log entry.
  next = withNoteLog(
    next,
    `operator recovery action: ${action.name}`,
    { action: actionId, risk: action.risk, category: action.category },
  );

  // Timeline + activity.
  const incidents = next.incidents.map((inc) => {
    if (inc.status === "resolved" || inc.scenarioId !== scenario.id) return inc;
    return {
      ...inc,
      timeline: [
        ...inc.timeline,
        {
          id: `tl-${record.id}-${inc.number}`,
          ts: simTimeAt(state.tick),
          tick: state.tick,
          kind: "action" as const,
          message: `Recovery applied: ${action.name} — ${applied.notes[0] ?? ""}`,
          actor: "user" as const,
        },
      ],
    };
  });

  const activity: ActivityEvent[] = [
    ...next.activity,
    {
      id: `act-${next.seq + 5000}`,
      tick: state.tick,
      ts: simTimeAt(state.tick),
      kind: "action",
      message: `Recovery applied: ${action.name}`,
      href: "/recovery",
    },
  ];

  return {
    ...next,
    activity: activity.slice(-60),
    seq: next.seq + 1,
    incidents,
    actions: [...next.actions, record],
  };
}

export function rollbackAction(state: SimState, appliedId: string): SimState {
  const scenario = getScenario(state.scenarioId);
  const idx = state.actions.findIndex((a) => a.id === appliedId);
  if (idx === -1) return state;
  const record = state.actions[idx]!;
  if (record.rolledBack) return state;
  // Only the most recent active action can be rolled back (stack semantics).
  const latestActive = [...state.actions].reverse().find((a) => !a.rolledBack);
  if (!latestActive || latestActive.id !== appliedId) return state;

  let next = recomputeCurrent(state, scenario, record.faultBefore);

  const actions = next.actions.map((a) =>
    a.id === appliedId ? { ...a, rolledBack: true, rolledBackTick: state.tick } : a,
  );

  next = withNoteLog(next, `operator rolled back action: ${record.name}`, { action: record.actionId });

  const incidents = next.incidents.map((inc) => {
    if (inc.status === "resolved" || inc.scenarioId !== scenario.id) return inc;
    return {
      ...inc,
      timeline: [
        ...inc.timeline,
        {
          id: `tl-rb-${appliedId}`,
          ts: simTimeAt(state.tick),
          tick: state.tick,
          kind: "action" as const,
          message: `Rolled back: ${record.name}`,
          actor: "user" as const,
        },
      ],
    };
  });

  const activity: ActivityEvent[] = [
    ...next.activity,
    {
      id: `act-rb-${appliedId}`,
      tick: state.tick,
      ts: simTimeAt(state.tick),
      kind: "action",
      message: `Rolled back: ${record.name}`,
      href: "/recovery",
    },
  ];

  return { ...next, actions, incidents, activity: activity.slice(-60), seq: next.seq + 1 };
}

export type IncidentOp =
  | { op: "ack" }
  | { op: "investigate" }
  | { op: "resolve"; resolution?: string }
  | { op: "note"; message: string }
  | { op: "rootCause"; hypothesisId: string; title: string; confidence: number };

export function updateIncident(state: SimState, incidentId: string, change: IncidentOp): SimState {
  const incidents = state.incidents.map((inc) => {
    if (inc.id !== incidentId) return inc;
    const ts = simTimeAt(state.tick);
    const base = { ...inc, timeline: [...inc.timeline] };
    const push = (kind: TimelineEvent["kind"], message: string, actor: TimelineEvent["actor"]) => {
      base.timeline.push({
        id: `tl-u-${state.tick}-${base.timeline.length}-${kind}`,
        ts,
        tick: state.tick,
        kind,
        message,
        actor,
      });
    };

    switch (change.op) {
      case "ack":
        if (inc.status !== "triggered") return inc;
        base.status = "acknowledged";
        push("acknowledged", "Acknowledged by on-call (you)", "user");
        break;
      case "investigate":
        if (inc.status === "resolved") return inc;
        base.status = "investigating";
        push("investigating", "Moved to investigating — correlation analysis started", "user");
        break;
      case "resolve": {
        if (inc.status === "resolved") return inc;
        base.status = "resolved";
        base.resolvedTick = state.tick;
        base.resolvedTs = ts;
        base.resolution =
          change.resolution?.trim() ||
          `Resolved by operator at health score ${state.health}%.`;
        push("resolved", base.resolution, "user");
        break;
      }
      case "note":
        if (!change.message.trim()) return inc;
        push("note", change.message.trim(), "user");
        break;
      case "rootCause":
        base.rootCause = {
          hypothesisId: change.hypothesisId,
          title: change.title,
          confidence: change.confidence,
          setBy: "user",
          atTick: state.tick,
        };
        push("note", `Root cause set: ${change.title} (${Math.round(change.confidence * 100)}% confidence)`, "user");
        break;
    }
    return base;
  });

  const activity =
    change.op === "note" || change.op === "rootCause"
      ? state.activity
      : [
          ...state.activity,
          {
            id: `act-inc-${incidentId}-${change.op}-${state.tick}`,
            tick: state.tick,
            ts: simTimeAt(state.tick),
            kind: "incident" as const,
            message: `${state.incidents.find((i) => i.id === incidentId)?.number ?? incidentId} → ${change.op === "resolve" ? "resolved" : change.op}`,
            href: `/incidents/${incidentId}`,
          },
        ].slice(-60);

  return { ...state, incidents, activity };
}

export function switchScenario(
  state: SimState,
  scenarioId: ScenarioId,
  opts?: InitialStateOptions,
): SimState {
  const fresh = createInitialState(scenarioId, opts ?? {
    historyLimit: state.historyLimit,
    logLimit: state.logLimit,
    traceLimit: state.traceLimit,
  });
  // Keep incidents from other scenarios so reports stay populated.
  const kept = state.incidents.filter((i) => i.scenarioId !== scenarioId);
  return {
    ...fresh,
    incidents: [...fresh.incidents, ...kept].slice(-50),
  };
}

export function resetScenario(state: SimState, opts?: InitialStateOptions): SimState {
  return switchScenario(state, state.scenarioId, opts);
}

/** Derived phase badge for the top bar. */
export function derivePhase(state: SimState): { label: string; tone: "ok" | "warn" | "bad" | "info" } {
  if (state.health >= 90) return { label: "Operational", tone: "ok" };
  if (state.health >= 70) return { label: "Degraded", tone: "warn" };
  if (state.health >= 40) return { label: "Critical", tone: "bad" };
  const prev = state.healthSeries.at(-15)?.health;
  if (prev !== undefined && state.health > prev + 8) return { label: "Recovering", tone: "info" };
  return { label: "Outage", tone: "bad" };
}
