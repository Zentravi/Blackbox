import { describe, expect, it } from "vitest";
import { applyAction, createInitialState, rollbackAction, step } from "@/simulation/engine";
import { getScenario } from "@/simulation/scenarios";

describe("recovery actions", () => {
  it("resizing the connection pool improves health immediately", () => {
    const before = createInitialState("db-exhaustion");
    const after = applyAction(before, "resize-pool");
    expect(after.health).toBeGreaterThan(before.health + 10);
    expect(after.fault).toMatchObject({ kind: "db-exhaustion", poolMax: 400 });
    // Comparison snapshot recorded for before/after UI.
    const record = after.actions.at(-1)!;
    expect(record.kpiAfter.health).toBeGreaterThan(record.kpiBefore.health);
    expect(record.notes[0]).toContain("100 → 400");
  });

  it("pool wait timeout trades latency for fast failures", () => {
    const before = createInitialState("db-exhaustion");
    const after = applyAction(before, "pool-timeout");
    const api = after.services["api-gateway"]!;
    const apiBefore = before.services["api-gateway"]!;
    expect(api.current.latencyP95Ms).toBeLessThan(apiBefore.current.latencyP95Ms);
    expect(after.fault).toMatchObject({ poolTimeoutEnabled: true });
  });

  it("rollback restores the pre-action fault and keeps stack semantics", () => {
    let s = createInitialState("db-exhaustion");
    const s0 = s;
    s = applyAction(s, "resize-pool");
    const resizeRecord = s.actions.at(-1)!;
    s = applyAction(s, "read-replica");
    const replicaRecord = s.actions.at(-1)!;

    // Cannot roll back the older action while a newer one is active.
    const rejected = rollbackAction(s, resizeRecord.id);
    expect(rejected).toBe(s);

    // Rolling back the newest restores the state as it was when the older
    // action was active (pool resize applied, replica not yet).
    const afterRollback = rollbackAction(s, replicaRecord.id);
    expect(afterRollback.fault).toMatchObject({ poolMax: 400, replicaShift: 0 });
    expect(afterRollback.actions.find((a) => a.id === replicaRecord.id)!.rolledBack).toBe(true);

    // Now the older action becomes rollback-able.
    const afterSecond = rollbackAction(afterRollback, resizeRecord.id);
    expect(afterSecond.fault).toEqual(s0.fault);
    expect(afterSecond.actions.find((a) => a.id === resizeRecord.id)!.rolledBack).toBe(true);
  });

  it("re-applying an action after rollback is allowed (repeat experiments)", () => {
    let s = createInitialState("db-exhaustion");
    s = applyAction(s, "resize-pool");
    const rec = s.actions.at(-1)!;
    s = rollbackAction(s, rec.id);
    s = applyAction(s, "resize-pool");
    expect(s.actions).toHaveLength(2);
    expect(s.fault).toMatchObject({ poolMax: 400 });
  });

  it("a red-herring action (release rollback) produces no health change", () => {
    const before = createInitialState("db-exhaustion");
    const after = applyAction(before, "rollback-release");
    expect(after.health).toBe(before.health);
    expect(after.actions.at(-1)!.kpiAfter.health).toBe(after.actions.at(-1)!.kpiBefore.health);
  });

  it("scaling the gateway alone does not fully recover the system", () => {
    const before = createInitialState("db-exhaustion");
    const after = applyAction(before, "scale-api");
    expect(after.health).toBeGreaterThan(before.health); // partial relief
    expect(after.health).toBeLessThan(88); // but not a clean resolve
  });

  it("cascading: restart alone relapses, patch alone stabilises", () => {
    // Restart without the cache fix → OOM again ~6 ticks later.
    let s = createInitialState("cascading");
    s = applyAction(s, "restart-auth");
    expect(s.services["auth-service"]!.status).not.toBe("down");
    for (let i = 0; i < 7; i++) s = step(s);
    expect(s.services["auth-service"]!.status).toBe("down");
    const incident = s.incidents.find((i) => i.triggerId === "auth-outage")!;
    expect(incident.timeline.some((e) => e.kind === "relapsed")).toBe(true);

    // Combined patch → stable recovery.
    let p = createInitialState("cascading");
    p = applyAction(p, "patch-auth");
    for (let i = 0; i < 6; i++) p = step(p);
    expect(p.services["auth-service"]!.status).toBe("healthy");
    expect(p.services["edge-gateway"]!.status).toBe("healthy");
    expect(p.health).toBeGreaterThan(85);
    expect(p.fault).toMatchObject({ stable: true, cacheCapped: true });
  });

  it("fail-open restores traffic but keeps auth down with a security flag", () => {
    const start = createInitialState("cascading");
    const s = applyAction(start, "fail-open");
    expect(s.fault).toMatchObject({ gatewayFailOpen: true });
    expect(s.services["edge-gateway"]!.status).toBe("healthy");
    expect(s.services["auth-service"]!.status).toBe("down"); // root cause remains
    expect(s.health).toBeGreaterThan(start.health + 30); // big jump, not a full fix
  });

  it("api-latency: rolling back the ranking release collapses the queue", () => {
    const before = createInitialState("api-latency");
    const after = applyAction(before, "rollback-ranking");
    const search = after.services["search-service"]!;
    expect(search.current.latencyP95Ms).toBeLessThan(300);
    expect(search.current.saturation).toBeLessThan(0.3);
    expect(after.health).toBeGreaterThan(before.health + 20);
  });

  it("api-latency: enabling the cache is a partial improvement", () => {
    const before = createInitialState("api-latency");
    const after = applyAction(before, "enable-cache");
    expect(after.services["search-service"]!.current.latencyP95Ms).toBeLessThan(
      before.services["search-service"]!.current.latencyP95Ms,
    );
    expect(after.health).toBeGreaterThan(before.health);
    // Still degraded — cache alone is not a full fix.
    expect(after.services["search-service"]!.current.latencyP95Ms).toBeGreaterThan(250);
  });

  it("recovery actions are written to open incident timelines", () => {
    let s = createInitialState("db-exhaustion");
    const openIncident = s.incidents.find((i) => i.status !== "resolved")!;
    const beforeLen = openIncident.timeline.length;
    s = applyAction(s, "resize-pool");
    const updated = s.incidents.find((i) => i.id === openIncident.id)!;
    expect(updated.timeline.length).toBeGreaterThan(beforeLen);
    expect(updated.timeline.at(-1)!.kind).toBe("action");
    expect(updated.timeline.at(-1)!.message).toContain("Increase connection pool size");
  });

  it("every scenario action is applicable without throwing", () => {
    for (const id of ["db-exhaustion", "api-latency", "cascading"] as const) {
      const scenario = getScenario(id);
      let s = createInitialState(id);
      for (const action of scenario.actions) {
        expect(() => {
          s = applyAction(s, action.id);
        }, `${id}/${action.id}`).not.toThrow();
      }
    }
  });
});
