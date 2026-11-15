import type {
  Incident,
  ScenarioDefinition,
  ServiceDef,
  ServiceRuntime,
  SimState,
} from "@/simulation/types";

export interface ServiceRow {
  def: ServiceDef;
  runtime: ServiceRuntime;
  spark: number[];
}

export function serviceRows(state: SimState, scenario: ScenarioDefinition): ServiceRow[] {
  return scenario.services.map((def) => {
    const runtime = state.services[def.id] ?? {
      id: def.id,
      status: "healthy" as const,
      current: {
        t: state.tick,
        ts: state.simTimeMs,
        cpuPct: def.baseline.cpuPct,
        memPct: def.baseline.memPct,
        rps: def.baseline.rps,
        latencyP95Ms: def.baseline.latencyP95Ms,
        errorRate: def.baseline.errorRate,
        saturation: 0.3,
      },
      availability: 1,
    };
    const series = state.metrics[def.id] ?? [];
    return {
      def,
      runtime,
      spark: series.slice(-40).map((s) => s.latencyP95Ms),
    };
  });
}

export interface AggregatePoint {
  t: number;
  ts: number;
  errorRate: number;
  latencyP95Ms: number;
  rps: number;
}

/** rps-weighted aggregate time series across all services (baseline weights). */
export function aggregateSeries(
  state: SimState,
  scenario: ScenarioDefinition,
  n: number,
): AggregatePoint[] {
  const len = Object.values(state.metrics)[0]?.length ?? 0;
  if (len === 0) return [];
  const start = Math.max(0, len - n);
  const weights = new Map(scenario.services.map((s) => [s.id, s.baseline.rps]));
  const totalWeight = scenario.services.reduce((a, s) => a + s.baseline.rps, 0) || 1;

  const out: AggregatePoint[] = [];
  for (let i = start; i < len; i++) {
    let err = 0;
    let lat = 0;
    let rps = 0;
    let ts = state.simTimeMs;
    let t = state.tick;
    for (const def of scenario.services) {
      const series = state.metrics[def.id];
      const sample = series?.[i];
      if (!sample) continue;
      const w = weights.get(def.id) ?? 1;
      err += w * sample.errorRate;
      lat += w * sample.latencyP95Ms;
      rps += sample.rps;
      ts = sample.ts;
      t = sample.t;
    }
    out.push({
      t,
      ts,
      errorRate: err / totalWeight,
      latencyP95Ms: lat / totalWeight,
      rps,
    });
  }
  return out;
}

export function activeIncidents(state: SimState, scenarioId?: string): Incident[] {
  return state.incidents
    .filter((i) => i.status !== "resolved" && (!scenarioId || i.scenarioId === scenarioId))
    .sort((a, b) => b.openedTick - a.openedTick);
}

export function scenarioIncidents(state: SimState, scenarioId: string): Incident[] {
  return state.incidents
    .filter((i) => i.scenarioId === scenarioId)
    .sort((a, b) => b.openedTick - a.openedTick);
}

export function incidentById(state: SimState, id: string): Incident | undefined {
  return state.incidents.find((i) => i.id === id);
}

export function upstreamOf(scenario: ScenarioDefinition, id: string): ServiceDef[] {
  const ids = scenario.edges.filter((e) => e.target === id).map((e) => e.source);
  return scenario.services.filter((s) => ids.includes(s.id));
}

export function downstreamOf(scenario: ScenarioDefinition, id: string): ServiceDef[] {
  const ids = scenario.edges.filter((e) => e.source === id).map((e) => e.target);
  return scenario.services.filter((s) => ids.includes(s.id));
}

/** Status counts for summary strips. */
export function statusCounts(rows: ServiceRow[]) {
  const counts = { healthy: 0, degraded: 0, critical: 0, down: 0 };
  for (const r of rows) counts[r.runtime.status] += 1;
  return counts;
}
