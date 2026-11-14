import { describe, expect, it } from "vitest";
import { createInitialState, step, computeKpi, applyAction } from "@/simulation/engine";
import { getScenario, SCENARIO_LIST } from "@/simulation/scenarios";

describe("initial state & warm-up", () => {
  it.each(SCENARIO_LIST.map((s) => s.id))("%s opens on a populated mid-incident snapshot", (id) => {
    const state = createInitialState(id);
    const scenario = getScenario(id);

    // Telemetry exists for every service through the warm-up window.
    for (const def of scenario.services) {
      const series = state.metrics[def.id];
      expect(series, `metrics for ${def.id}`).toBeDefined();
      expect(series!.length).toBeGreaterThanOrEqual(scenario.startTick - 40);
      expect(series!.at(-1)!.t).toBe(state.tick);
    }

    // Logs and traces are populated.
    expect(state.logs.length).toBeGreaterThan(50);
    expect(state.traces.length).toBeGreaterThan(20);

    // At least one incident is active at session start.
    const open = state.incidents.filter((i) => i.status !== "resolved");
    expect(open.length).toBeGreaterThanOrEqual(1);
    expect(open[0]!.timeline.length).toBeGreaterThanOrEqual(2);

    // Historical reports exist too.
    expect(state.incidents.filter((i) => i.status === "resolved").length).toBeGreaterThanOrEqual(2);
  });

  it("starts from a healthy baseline (first warm-up samples are clean)", () => {
    for (const s of SCENARIO_LIST) {
      const state = createInitialState(s.id);
      const first = state.metrics[s.services[0]!.id]![0]!;
      expect(first.errorRate).toBeLessThan(0.02);
      const fatalRatio =
        state.logs.filter((l) => l.level === "fatal").length / state.logs.length;
      // Cascading warm-up legitimately includes OOMKilled fatals; A/B stay clean.
      expect(fatalRatio).toBeLessThan(s.id === "cascading" ? 0.15 : 0.05);
    }
  });
});

describe("fault progression", () => {
  it("degrades system health as the db-exhaustion fault escalates", () => {
    const start = createInitialState("db-exhaustion");
    let s = start;
    for (let i = 0; i < 25; i++) s = step(s);
    expect(s.health).toBeLessThan(start.health);
    expect(s.services["api-gateway"]!.current.errorRate).toBeGreaterThan(
      start.services["api-gateway"]!.current.errorRate,
    );
    expect(s.services["postgres-primary"]!.status).not.toBe("healthy");
  });

  it("keeps the external payments provider healthy during db exhaustion (red herring)", () => {
    const state = createInitialState("db-exhaustion");
    expect(state.services["payments-provider"]!.status).toBe("healthy");
  });

  it("cascading scenario: auth down, data tier healthy, wave propagated", () => {
    const state = createInitialState("cascading");
    expect(state.services["auth-service"]!.status).toBe("down");
    // Direct callers + edge impacted after the wave.
    expect(state.services["orders-service"]!.status).not.toBe("healthy");
    expect(state.services["edge-gateway"]!.status).not.toBe("healthy");
    // Data stores are dependencies of auth, not dependents — they stay up.
    expect(state.services["postgres-primary"]!.status).toBe("healthy");
    expect(state.services["redis-cache"]!.status).toBe("healthy");
  });

  it("api-latency scenario saturates the search worker pool", () => {
    const state = createInitialState("api-latency");
    expect(state.services["search-service"]!.current.saturation).toBeGreaterThan(0.5);
    expect(state.services["search-service"]!.current.latencyP95Ms).toBeGreaterThan(
      140 * 2,
    );
    // Payments provider stays healthy — red herring.
    expect(state.services["payments-provider"]!.status).toBe("healthy");
  });

  it("escalates the primary db-exhaustion incident to SEV1 when errors cross the threshold", () => {
    let s = createInitialState("db-exhaustion");
    for (let i = 0; i < 30; i++) s = step(s);
    const main = s.incidents.find((i) => i.number === "INC-1042");
    expect(main).toBeDefined();
    expect(main!.severity).toBe("sev1");
  });

  it("auto-resolves incidents once health recovers past the trigger condition", () => {
    let s = createInitialState("cascading");
    s = applyAction(s, "patch-auth");
    for (let i = 0; i < 12; i++) s = step(s);
    const authIncident = s.incidents.find((i) => i.triggerId === "auth-outage");
    expect(authIncident!.status).toBe("resolved");
    expect(authIncident!.resolution).toContain("auto-resolved");
  });

  it("computeKpi stays within [0, 100] and tracks down services", () => {
    const state = createInitialState("cascading");
    const scenario = getScenario("cascading");
    const kpi = computeKpi(state.services, scenario.services);
    expect(kpi.health).toBeGreaterThanOrEqual(0);
    expect(kpi.health).toBeLessThanOrEqual(100);
    expect(kpi.downServices).toBeGreaterThanOrEqual(1);
    expect(kpi.availability).toBeLessThan(1);
  });
});
