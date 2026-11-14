/**
 * BLACKBOX simulation core — shared type definitions.
 *
 * The simulation is fully deterministic: every value in `SimState` is produced
 * by pure functions of (scenario seed, tick, applied action history). No
 * Date.now(), no Math.random(), no I/O.
 */

export type ScenarioId = "db-exhaustion" | "api-latency" | "cascading";

export type HealthStatus = "healthy" | "degraded" | "critical" | "down";

export type Severity = "sev1" | "sev2" | "sev3";

export type IncidentStatus = "triggered" | "acknowledged" | "investigating" | "resolved";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type ServiceId = string;

export type MetricKey =
  | "cpuPct"
  | "memPct"
  | "rps"
  | "latencyP95Ms"
  | "errorRate"
  | "saturation";

/* ------------------------------------------------------------------ */
/* Service topology                                                     */
/* ------------------------------------------------------------------ */

export type ServiceKind = "edge" | "gateway" | "service" | "data" | "cache" | "external";

export interface ServiceDef {
  id: ServiceId;
  name: string;
  kind: ServiceKind;
  team: string;
  runtime: string;
  description: string;
  /** Layout column for the dependency map. */
  tier: number;
  /** React Flow canvas position. */
  pos: { x: number; y: number };
  baseline: {
    cpuPct: number;
    memPct: number;
    rps: number;
    latencyP95Ms: number;
    errorRate: number;
  };
  /** Rolling SLO target, e.g. 0.999 */
  slo: number;
}

export interface DependencyDef {
  id: string;
  source: ServiceId;
  target: ServiceId;
  protocol: "HTTPS" | "gRPC" | "TCP" | "SQL" | "AMQP";
  label?: string;
}

/* ------------------------------------------------------------------ */
/* Telemetry                                                            */
/* ------------------------------------------------------------------ */

export interface MetricSample {
  /** Tick index the sample was recorded at. */
  t: number;
  /** Simulated epoch milliseconds. */
  ts: number;
  cpuPct: number;
  memPct: number;
  rps: number;
  latencyP95Ms: number;
  /** 0..1 */
  errorRate: number;
  /** 0..1 — resource pressure (pool, queue, …). */
  saturation: number;
}

export interface LogEntry {
  id: string;
  tick: number;
  ts: number;
  level: LogLevel;
  serviceId: ServiceId;
  message: string;
  traceId?: string;
  fields: Record<string, string | number | boolean>;
}

export interface TraceSpan {
  id: string;
  serviceId: ServiceId;
  name: string;
  kind: "http" | "rpc" | "db" | "cache" | "queue" | "auth";
  /** Milliseconds offset from trace start. */
  startMs: number;
  durationMs: number;
  status: "ok" | "error" | "timeout";
  parentId?: string;
  attributes: Record<string, string | number>;
}

export interface Trace {
  id: string;
  tick: number;
  ts: number;
  rootName: string;
  entryServiceId: ServiceId;
  durationMs: number;
  status: "ok" | "error" | "timeout";
  spans: TraceSpan[];
}

/* ------------------------------------------------------------------ */
/* Incidents                                                            */
/* ------------------------------------------------------------------ */

export type TimelineEventKind =
  | "triggered"
  | "escalated"
  | "acknowledged"
  | "investigating"
  | "note"
  | "action"
  | "resolved"
  | "auto_resolved"
  | "detected"
  | "relapsed";

export interface TimelineEvent {
  id: string;
  ts: number;
  tick: number;
  kind: TimelineEventKind;
  message: string;
  actor: "system" | "user";
}

export interface RootCauseRecord {
  hypothesisId: string;
  title: string;
  confidence: number;
  setBy: "user" | "engine";
  atTick: number;
}

export interface Incident {
  id: string;
  scenarioId: ScenarioId;
  /** Human friendly id, e.g. "INC-1042". */
  number: string;
  triggerId: string;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  serviceIds: ServiceId[];
  openedTick: number;
  openedTs: number;
  resolvedTick?: number;
  resolvedTs?: number;
  timeline: TimelineEvent[];
  rootCause?: RootCauseRecord;
  resolution?: string;
}

export interface KpiSnapshot {
  tick: number;
  health: number;
  /** rps-weighted aggregate error rate (0..1). */
  errorRate: number;
  /** rps-weighted aggregate p95 latency (ms). */
  latencyP95Ms: number;
  /** Share of services that are healthy or degraded (0..1). */
  availability: number;
  downServices: number;
  degradedServices: number;
}

export interface AppliedAction {
  id: string;
  actionId: string;
  name: string;
  tick: number;
  ts: number;
  notes: string[];
  rolledBack: boolean;
  rolledBackTick?: number;
  /** Fault snapshot before this action was applied (enables rollback). */
  faultBefore: ScenarioFault;
  kpiBefore: KpiSnapshot;
  kpiAfter: KpiSnapshot;
}

export interface ActivityEvent {
  id: string;
  tick: number;
  ts: number;
  kind: "incident" | "action" | "scenario" | "system";
  message: string;
  href?: string;
}

/* ------------------------------------------------------------------ */
/* Runtime service state                                                */
/* ------------------------------------------------------------------ */

export interface ServiceRuntime {
  id: ServiceId;
  status: HealthStatus;
  current: MetricSample;
  /** Rolling availability derived from recent samples (0..1). */
  availability: number;
}

/* ------------------------------------------------------------------ */
/* Fault state (scenario-specific, stored as a discriminated union)     */
/* ------------------------------------------------------------------ */

export interface DbExhaustionFault {
  kind: "db-exhaustion";
  onsetTick: number;
  /** 0..1 ramp describing raw demand on the connection pool. */
  intensity: number;
  poolMax: number;
  poolTimeoutEnabled: boolean;
  breakerEnabled: boolean;
  /** 0 = disabled, otherwise edge RPS cap. */
  rateLimitRps: number;
  scaleOut: number;
  /** Fraction of read traffic shifted to the read replica (0..0.8). */
  replicaShift: number;
  /** Temporary relief after an API restart; decays over 5 ticks from restartTick. */
  restartBoost: number;
  restartTick: number | null;
  deploymentRolledBack: boolean;
}

export interface ApiLatencyFault {
  kind: "api-latency";
  onsetTick: number;
  intensity: number;
  threadPoolSize: number;
  cacheEnabled: boolean;
  replicaCount: number;
  queryThrottle: boolean;
  rankingRollback: boolean;
  /** Temporary relief after a gateway restart; decays over 5 ticks from restartTick. */
  restartBoost: number;
  restartTick: number | null;
}

export interface CascadingFault {
  kind: "cascading";
  onsetTick: number;
  /** Tick the auth service first crashed, null if never. */
  downSinceTick: number | null;
  /** Tick the auth service was brought back up, null while down. */
  upAtTick: number | null;
  /** Fix applied — auth will not crash again. */
  stable: boolean;
  /** Tick the auth service will crash again if not stabilised. */
  relapseAtTick: number | null;
  cacheCapped: boolean;
  deployRolledBack: boolean;
  gatewayFailOpen: boolean;
  drained: ServiceId[];
}

export type ScenarioFault = DbExhaustionFault | ApiLatencyFault | CascadingFault;

/* ------------------------------------------------------------------ */
/* Scenario definitions                                                 */
/* ------------------------------------------------------------------ */

export interface ImpactTarget {
  cpuPct: number;
  memPct: number;
  rps: number;
  latencyP95Ms: number;
  errorRate: number;
  saturation: number;
  /** Scenario may force a status (e.g. hard "down"). */
  status?: HealthStatus;
}

export interface SignatureLog {
  level: LogLevel;
  serviceId: ServiceId;
  message: string;
  fields: Record<string, string | number | boolean>;
  count: number;
}

export interface ScenarioEvent {
  kind: "fault_started" | "escalation" | "relapse" | "recovered";
  message: string;
  serviceIds: ServiceId[];
}

export interface AdvanceResult<F extends ScenarioFault> {
  fault: F;
  targets: Record<ServiceId, ImpactTarget>;
  signatures: SignatureLog[];
  events: ScenarioEvent[];
}

export interface RecoveryActionDef<F extends ScenarioFault> {
  id: string;
  name: string;
  category: "mitigation" | "fix" | "experiment";
  risk: "low" | "medium" | "high";
  description: string;
  /** What the operator should observe if the action works. */
  expected: string;
  sideEffects?: string;
  apply(fault: F, tick: number): { fault: F; notes: string[] };
}

/* ---------------------------- Investigation ------------------------ */

export type EvidenceKind = "metric" | "log" | "trace" | "dependency" | "incident";

export interface EvidenceItem {
  kind: EvidenceKind;
  title: string;
  detail: string;
  /** Deep link into the app, e.g. `/logs?level=error&q=pool`. */
  href: string;
}

export interface LogQuery {
  serviceId?: ServiceId;
  levels?: LogLevel[];
  contains?: string;
  sinceTick?: number;
}

export interface TraceQuery {
  serviceId?: ServiceId;
  status?: Trace["status"];
  sinceTick?: number;
}

export interface AnalysisContext {
  state: SimState;
  scenario: ScenarioDefinition;
  logs(q: LogQuery): LogEntry[];
  countLogs(q: LogQuery): number;
  series(serviceId: ServiceId, key: MetricKey, n: number): number[];
  avg(serviceId: ServiceId, key: MetricKey, n: number): number;
  /** Current window average ÷ baseline value (>1 means worse). */
  ratioVsBaseline(serviceId: ServiceId, key: MetricKey, n: number): number;
  traceStats(q: TraceQuery): { total: number; errorPct: number; avgMs: number; p95Ms: number };
  status(serviceId: ServiceId): HealthStatus;
  downstreamOf(serviceId: ServiceId): ServiceId[];
}

export interface EvidenceSlot {
  id: string;
  weight: number;
  /** Returns null when the signal is not present in the current state. */
  collect(ctx: AnalysisContext): EvidenceItem | null;
}

export interface HypothesisDef {
  id: string;
  title: string;
  category: string;
  summary: string;
  /** Static explanation of why this cause is worth considering. */
  whyRelevant: string;
  baseConfidence: number;
  /** Marks the true root cause of the scenario (used for verification). */
  actual?: boolean;
  slots: EvidenceSlot[];
}

export interface HypothesisResult {
  id: string;
  title: string;
  category: string;
  summary: string;
  whyRelevant: string;
  confidence: number;
  matched: { slot: EvidenceSlot; item: EvidenceItem }[];
  missing: EvidenceSlot[];
  explanation: string;
  actual?: boolean;
}

/* ---------------------------- Triggers ----------------------------- */

export interface TriggerCtx<F extends ScenarioFault> {
  state: SimState;
  fault: F;
  targets: Record<ServiceId, ImpactTarget>;
  kpi: KpiSnapshot;
}

export interface IncidentTriggerDef<F extends ScenarioFault> {
  id: string;
  number: number;
  title: string;
  description: string;
  severity: Severity;
  serviceIds: ServiceId[];
  when(ctx: TriggerCtx<F>): boolean;
  escalateTo?: {
    severity: Severity;
    message: string;
    when(ctx: TriggerCtx<F>): boolean;
  };
  /** When present, the incident auto-resolves once this returns true. */
  resolveWhen?(ctx: TriggerCtx<F>): boolean;
}

/* ---------------------------- Scenario ----------------------------- */

export interface ScenarioDefinition<F extends ScenarioFault = ScenarioFault> {
  id: ScenarioId;
  name: string;
  tagline: string;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  /** Tick at which the fault begins. */
  onsetTick: number;
  /** Tick the interactive session starts at (history is warmed up to here). */
  startTick: number;
  seed: number;
  entryRoute: string;
  services: ServiceDef[];
  edges: DependencyDef[];
  /** Candidate request paths used for trace sampling. */
  tracePaths: ServiceId[][];
  initialFault(): F;
  advance(fault: F, tick: number): AdvanceResult<F>;
  actions: RecoveryActionDef<F>[];
  hypotheses: HypothesisDef[];
  triggers: IncidentTriggerDef<F>[];
  /** Key/value summary of the live fault state for the Recovery Simulator. */
  faultSummary(fault: F): { label: string; value: string }[];
}

/* ------------------------------------------------------------------ */
/* Whole simulation state                                               */
/* ------------------------------------------------------------------ */

export interface SimState {
  scenarioId: ScenarioId;
  seed: number;
  /** Current tick index. */
  tick: number;
  simStartMs: number;
  simTimeMs: number;
  services: Record<ServiceId, ServiceRuntime>;
  metrics: Record<ServiceId, MetricSample[]>;
  /** Overall health score history for sparklines. */
  healthSeries: { t: number; ts: number; health: number }[];
  logs: LogEntry[];
  traces: Trace[];
  incidents: Incident[];
  activity: ActivityEvent[];
  actions: AppliedAction[];
  health: number;
  fault: ScenarioFault;
  /** Monotonic sequence for deterministic entity ids. */
  seq: number;
  /** Rolling window size for metric samples. */
  historyLimit: number;
  logLimit: number;
  traceLimit: number;
}
