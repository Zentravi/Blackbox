import { describe, expect, it } from "vitest";
import { applyAction, createInitialState, step } from "@/simulation/engine";
import { getScenario, SCENARIO_LIST } from "@/simulation/scenarios";
import { buildAnalysisContext, runAnalysis } from "@/simulation/analysis";

describe("investigation engine", () => {
  it("ranks the planted root cause first in every scenario", () => {
    for (const scenario of SCENARIO_LIST) {
      const state = createInitialState(scenario.id);
      const results = runAnalysis(state, scenario);
      expect(results.length).toBeGreaterThanOrEqual(4);
      const top = results[0]!;
      const actual = scenario.hypotheses.find((h) => h.actual)!;
      expect(top.id, `${scenario.id} top hypothesis`).toBe(actual.id);
      expect(top.confidence).toBeGreaterThan(0.5);
      expect(top.matched.length).toBeGreaterThanOrEqual(3);
      expect(top.explanation).toContain("signals present");
    }
  });

  it("produces sorted, bounded confidences with evidence links", () => {
    const scenario = getScenario("db-exhaustion");
    const state = createInitialState("db-exhaustion");
    const results = runAnalysis(state, scenario);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.confidence).toBeGreaterThanOrEqual(results[i]!.confidence);
    }
    for (const r of results) {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      for (const m of r.matched) {
        expect(m.item.href).toMatch(/^\//);
        expect(m.item.detail.length).toBeGreaterThan(10);
      }
    }
  });

  it("scores distractors below the true cause", () => {
    const scenario = getScenario("db-exhaustion");
    const state = createInitialState("db-exhaustion");
    const results = runAnalysis(state, scenario);
    const byId = new Map(results.map((r) => [r.id, r]));
    const actual = byId.get("db-pool-exhaustion")!;
    expect(actual.confidence).toBeGreaterThan(byId.get("traffic-spike")!.confidence);
    expect(actual.confidence).toBeGreaterThan(byId.get("memory-leak")!.confidence);
    expect(actual.confidence).toBeGreaterThan(byId.get("n1-queries")!.confidence);
  });

  it("captures scenario-specific smoking-gun evidence", () => {
    // DB exhaustion → pool wait logs linked from the gateway.
    const db = createInitialState("db-exhaustion");
    const dbResults = runAnalysis(db, getScenario("db-exhaustion"));
    const dbTop = dbResults[0]!;
    expect(dbTop.matched.some((m) => m.item.href.includes("service=api-gateway"))).toBe(true);

    // Cascading → OOMKilled fatals from auth.
    const cas = createInitialState("cascading");
    const casResults = runAnalysis(cas, getScenario("cascading"));
    const casTop = casResults[0]!;
    expect(casTop.matched.some((m) => m.item.href.includes("OOMKilled"))).toBe(true);

    // API latency → worker pool saturation evidence.
    const lat = createInitialState("api-latency");
    const latResults = runAnalysis(lat, getScenario("api-latency"));
    const latTop = latResults[0]!;
    expect(latTop.matched.some((m) => m.item.title.includes("worker-pool") || m.item.title.includes("Worker-pool") || m.item.title.includes("worker pool"))).toBe(true);
  });

  it("keeps rankings deterministic across repeated runs", () => {
    const scenario = getScenario("cascading");
    const state = createInitialState("cascading");
    const a = runAnalysis(state, scenario);
    const b = runAnalysis(state, scenario);
    expect(a.map((r) => [r.id, r.confidence])).toEqual(b.map((r) => [r.id, r.confidence]));
  });

  it("analysis context helpers read live telemetry", () => {
    const scenario = getScenario("db-exhaustion");
    const state = createInitialState("db-exhaustion");
    const ctx = buildAnalysisContext(state, scenario);

    const logs = ctx.logs({ serviceId: "api-gateway" });
    expect(logs.length).toBeGreaterThan(0);

    const poolLogs = ctx.countLogs({ contains: "pool" });
    expect(poolLogs).toBeGreaterThan(0);

    const ratio = ctx.ratioVsBaseline("api-gateway", "latencyP95Ms", 5);
    expect(ratio).toBeGreaterThan(1.2);

    const stats = ctx.traceStats({ sinceTick: state.tick - 10 });
    expect(stats.total).toBeGreaterThan(0);

    expect(ctx.status("postgres-primary")).not.toBe("healthy");
    expect(ctx.downstreamOf("postgres-primary").length).toBeGreaterThan(2);
  });

  it("confidence responds to evidence: recovery reduces the top score", () => {
    const scenario = getScenario("db-exhaustion");
    const before = createInitialState("db-exhaustion");
    const beforeTop = runAnalysis(before, scenario)[0]!;
    // After a strong fix + several ticks the evidence fades.
    let after = before;
    after = applyAction(after, "resize-pool");
    after = applyAction(after, "read-replica");
    // Step far enough that the pre-fix evidence windows have fully rolled over.
    for (let i = 0; i < 20; i++) after = step(after);
    const afterTop = runAnalysis(after, scenario)[0]!;
    expect(afterTop.confidence).toBeLessThanOrEqual(beforeTop.confidence);
  });
});
