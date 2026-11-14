import { describe, expect, it } from "vitest";
import { createInitialState, step, applyAction } from "@/simulation/engine";
import { SCENARIO_LIST } from "@/simulation/scenarios";


const SCENARIO_IDS = SCENARIO_LIST.map((s) => s.id);

describe("deterministic engine", () => {
  it.each(SCENARIO_IDS)("produces identical initial state for %s across runs", (id) => {
    const a = createInitialState(id);
    const b = createInitialState(id);
    expect(a).toEqual(b);
  });

  it.each(SCENARIO_IDS)("advances %s identically across two runs (30 ticks)", (id) => {
    let a = createInitialState(id);
    let b = createInitialState(id);
    for (let i = 0; i < 30; i++) {
      a = step(a);
      b = step(b);
    }
    expect(a).toEqual(b);
    expect(a.tick).toBe(createInitialState(id).tick + 30);
  });

  it("applies actions deterministically given the same action sequence", () => {
    const run = () => {
      let s = createInitialState("db-exhaustion");
      s = applyAction(s, "resize-pool");
      s = step(s);
      s = applyAction(s, "read-replica");
      s = step(s);
      s = step(s);
      return s;
    };
    expect(run()).toEqual(run());
  });

  it("different action sequences diverge (actions actually change state)", () => {
    const base = createInitialState("db-exhaustion");
    const modified = applyAction(base, "resize-pool");
    expect(modified.fault).not.toEqual(base.fault);
    expect(modified.services).not.toEqual(base.services);
  });

  it("uses a reproducible sim clock (1 tick = 1 minute)", () => {
    const s = createInitialState("api-latency");
    expect(s.simTimeMs - s.simStartMs).toBe(s.tick * 60_000);
    const next = step(s);
    expect(next.simTimeMs - s.simTimeMs).toBe(60_000);
  });
});
