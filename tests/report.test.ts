import { describe, expect, it } from "vitest";
import { createInitialState, applyAction, updateIncident } from "@/simulation/engine";
import { buildReport, reportToMarkdown, reportToJson } from "./helpers";
import { parseWorkspaceSnapshot } from "@/data/schema";

describe("reports", () => {
  it("builds a report for an active incident with impact metrics", () => {
    const state = createInitialState("db-exhaustion");
    const open = state.incidents.find((i) => i.status !== "resolved")!;
    const model = buildReport(state, open.id)!;

    expect(model.incident.id).toBe(open.id);
    expect(model.impact).not.toBeNull();
    expect(model.impact!.peakErrorRate).toBeGreaterThan(0.01);
    expect(model.impact!.minHealth).toBeLessThanOrEqual(state.health);
    expect(model.durationTicks).toBeGreaterThanOrEqual(0);
    expect(model.lessons.length).toBeGreaterThan(0);
  });

  it("renders markdown with every report section", () => {
    const state = createInitialState("cascading");
    const open = state.incidents.find((i) => i.status !== "resolved")!;
    const md = reportToMarkdown(buildReport(state, open.id)!, "utc");

    expect(md).toContain("# BLACKBOX Incident Report");
    expect(md).toContain("## Incident summary");
    expect(md).toContain("## Impact");
    expect(md).toContain("## Root cause analysis");
    expect(md).toContain("## Timeline");
    expect(md).toContain("## Recovery actions");
    expect(md).toContain("## Outcome");
    expect(md).toContain("## Lessons & observations");
  });

  it("records recovery actions and verification after resolve", () => {
    let state = createInitialState("cascading");
    state = applyAction(state, "patch-auth");
    state = updateIncident(state, "inc-1077", {
      op: "rootCause",
      hypothesisId: "auth-oom-cache",
      title: "auth-service OOM from unbounded session cache",
      confidence: 0.9,
    });
    state = updateIncident(state, "inc-1077", {
      op: "resolve",
      resolution: "Patched session cache and restarted auth.",
    });

    const model = buildReport(state, "inc-1077")!;
    expect(model.actions.length).toBe(1);
    expect(model.actions[0]!.name).toContain("Patch");
    expect(model.verified).toBe(true); // matched the planted cause
    expect(model.rootCauseTitle).toContain("session cache");
    expect(model.lessons.some((l) => l.includes("confirmed"))).toBe(true);

    const json = reportToJson(model);
    expect(JSON.parse(json).rootCause.verified).toBe(true);
  });

  it("marks a wrong root cause as refuted", () => {
    let state = createInitialState("cascading");
    state = updateIncident(state, "inc-1077", {
      op: "rootCause",
      hypothesisId: "tls-expiry",
      title: "Expired TLS certificate on auth-service",
      confidence: 0.5,
    });
    state = updateIncident(state, "inc-1077", { op: "resolve", resolution: "cert renewed" });
    const model = buildReport(state, "inc-1077")!;
    expect(model.verified).toBe(false);
    expect(model.actualRootCauseTitle).toContain("session cache");
  });
});

describe("workspace snapshot validation", () => {
  it("rejects malformed snapshots", () => {
    expect(parseWorkspaceSnapshot("{ not json")).toBeNull();
    expect(parseWorkspaceSnapshot(JSON.stringify({ app: "OTHER" }))).toBeNull();
    expect(parseWorkspaceSnapshot(JSON.stringify({}))).toBeNull();
  });

  it("accepts a well-formed snapshot", () => {
    const snapshot = {
      app: "BLACKBOX",
      version: "1.0.0",
      exportedAtTick: 112,
      settings: {
        workspaceName: "prod",
        environment: "production",
        timezone: "utc",
        density: "comfortable",
        defaultSpeed: 1,
        autoStart: true,
        historyWindow: 120,
        logCap: 1200,
      },
      simulation: {
        scenarioId: "db-exhaustion",
        seed: 1,
        health: 88,
        tick: 112,
        incidents: [],
        healthSeries: [{ t: 1, ts: 1, health: 100 }],
      },
    };
    const parsed = parseWorkspaceSnapshot(JSON.stringify(snapshot));
    expect(parsed).not.toBeNull();
    expect(parsed!.simulation.scenarioId).toBe("db-exhaustion");
  });
});
