import type {
  AnalysisContext,
  HypothesisResult,
  LogEntry,
  LogQuery,
  MetricKey,
  ScenarioDefinition,
  SimState,
  TraceQuery,
} from "./types";
import { clamp01, round } from "./rng";

function filterLogs(logs: LogEntry[], q: LogQuery): LogEntry[] {
  return logs.filter((l) => {
    if (q.serviceId && l.serviceId !== q.serviceId) return false;
    if (q.levels && !q.levels.includes(l.level)) return false;
    if (q.sinceTick !== undefined && l.tick < q.sinceTick) return false;
    if (q.contains) {
      const needle = q.contains.toLowerCase();
      const hay = `${l.message} ${JSON.stringify(l.fields)}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

function serviceWindow(state: SimState, serviceId: string, n: number) {
  const series = state.metrics[serviceId] ?? [];
  return series.slice(-n);
}

export function buildAnalysisContext(state: SimState, scenario: ScenarioDefinition): AnalysisContext {
  const edges = scenario.edges;
  const statusOf = (id: string) => state.services[id]?.status ?? "healthy";

  const downstreamOf = (origin: string): string[] => {
    // Services that transitively depend on `origin` (callers of origin).
    const dependents = new Map<string, string[]>();
    for (const e of edges) {
      const list = dependents.get(e.target) ?? [];
      list.push(e.source);
      dependents.set(e.target, list);
    }
    const seen = new Set<string>([origin]);
    const queue = [origin];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const src of dependents.get(cur) ?? []) {
        if (!seen.has(src)) {
          seen.add(src);
          queue.push(src);
        }
      }
    }
    seen.delete(origin);
    return [...seen];
  };

  return {
    state,
    scenario,
    logs: (q) => filterLogs(state.logs, q),
    countLogs: (q) => filterLogs(state.logs, q).length,
    series: (serviceId, key: MetricKey, n) =>
      serviceWindow(state, serviceId, n).map((s) => s[key]),
    avg: (serviceId, key, n) => {
      const win = serviceWindow(state, serviceId, n);
      if (win.length === 0) return 0;
      return win.reduce((a, s) => a + s[key], 0) / win.length;
    },
    ratioVsBaseline: (serviceId, key, n) => {
      const def = scenario.services.find((s) => s.id === serviceId);
      if (!def) return 1;
      const win = serviceWindow(state, serviceId, n);
      if (win.length === 0) return 1;
      const avg = win.reduce((a, s) => a + s[key], 0) / win.length;
      let baseline: number;
      if (key === "errorRate") baseline = Math.max(0.0005, def.baseline.errorRate);
      else if (key === "saturation") baseline = 1; // saturation has no stored baseline
      else baseline = def.baseline[key];
      if (baseline === undefined || baseline === 0) return 1;
      return avg / baseline;
    },
    traceStats: (q: TraceQuery) => {
      const traces = state.traces.filter((t) => {
        if (q.sinceTick !== undefined && t.tick < q.sinceTick) return false;
        if (q.status && t.status !== q.status) return false;
        if (q.serviceId && !t.spans.some((s) => s.serviceId === q.serviceId)) return false;
        return true;
      });
      if (traces.length === 0) return { total: 0, errorPct: 0, avgMs: 0, p95Ms: 0 };
      const errs = traces.filter((t) => t.status !== "ok").length;
      const durations = traces.map((t) => t.durationMs).sort((a, b) => a - b);
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const p95 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]!;
      return { total: traces.length, errorPct: errs / traces.length, avgMs: avg, p95Ms: p95 };
    },
    status: statusOf,
    downstreamOf,
  };
}

/**
 * Rank root-cause hypotheses by correlating logs, metrics, traces and the
 * dependency graph against each hypothesis' evidence slots. Confidence is a
 * deterministic function of the matched evidence weight — no randomness.
 */
export function runAnalysis(state: SimState, scenario: ScenarioDefinition): HypothesisResult[] {
  const ctx = buildAnalysisContext(state, scenario);

  const results = scenario.hypotheses.map((h) => {
    const matched: HypothesisResult["matched"] = [];
    const missing: HypothesisResult["missing"] = [];
    let matchedWeight = 0;
    let totalWeight = 0;

    for (const slot of h.slots) {
      totalWeight += slot.weight;
      const item = slot.collect(ctx);
      if (item) {
        matchedWeight += slot.weight;
        matched.push({ slot, item });
      } else {
        missing.push(slot);
      }
    }

    const ratio = totalWeight > 0 ? matchedWeight / totalWeight : 0;
    const confidence = round(clamp01(h.baseConfidence + (1 - h.baseConfidence) * 0.85 * ratio), 2);

    const explanation =
      matched.length > 0
        ? `${matched.length}/${h.slots.length} signals present (${Math.round(ratio * 100)}% of evidence weight): ${matched
            .map((m) => m.item.title)
            .join(" · ")}.`
        : "No supporting signals found in the current telemetry.";

    return {
      id: h.id,
      title: h.title,
      category: h.category,
      summary: h.summary,
      whyRelevant: h.whyRelevant,
      confidence,
      matched,
      missing,
      explanation,
      actual: h.actual,
    } satisfies HypothesisResult;
  });

  return results.sort((a, b) => b.confidence - a.confidence);
}

/** Convenience: top-ranked hypothesis for an incident's scenario. */
export function topHypothesis(state: SimState, scenario: ScenarioDefinition): HypothesisResult | undefined {
  return runAnalysis(state, scenario)[0];
}
