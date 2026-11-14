// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real PostgreSQL persistence test: boots an embedded PostgreSQL server
 * (binaries shipped via npm), applies the Prisma migration layout with
 * scripts/migrate.mjs, then exercises save/load/clear through the Prisma
 * client (@prisma/client + @prisma/adapter-pg).
 */

type EmbeddedPg = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
};
let embedded: EmbeddedPg | null = null;
let dataDir = "";
let databaseUrl = "";

beforeAll(async () => {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "blackbox-pg-"));
  const port = 54100 + Math.floor(Math.random() * 800);
  embedded = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "test",
    port,
    persistent: false,
  }) as unknown as EmbeddedPg;
  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase("blackbox_test");
  databaseUrl = `postgresql://postgres:test@127.0.0.1:${port}/blackbox_test`;
  process.env.DATABASE_URL = databaseUrl;

  const migration = spawnSync("node", ["scripts/migrate.mjs"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  if (migration.status !== 0) {
    throw new Error(`migrate failed: ${migration.stderr || migration.stdout}`);
  }
}, 180_000);

afterAll(async () => {
  await embedded?.stop().catch(() => undefined);
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
}, 60_000);

describe("PostgreSQL persistence (Prisma)", () => {
  it("applies migrations idempotently", () => {
    const again = spawnSync("node", ["scripts/migrate.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
    });
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("up to date");
  });

  it("saves a full snapshot with normalised telemetry rows", async () => {
    const { saveState, getStatus } = await import("@/server/persistence");
    const { createInitialState, step, applyAction } = await import("@/simulation/engine");

    let state = createInitialState("db-exhaustion");
    for (let i = 0; i < 5; i++) state = step(state);
    state = applyAction(state, "resize-pool");

    const result = await saveState(state, "full");
    expect(result.tick).toBe(state.tick);
    expect(result.mode).toBe("full");

    const status = await getStatus();
    expect(status.configured).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.tick).toBe(state.tick);

    const { getDb } = await import("@/server/db");
    const db = getDb();
    expect(db).not.toBeNull();
    const counts = await Promise.all([
      db!.simulationState.count(),
      db!.incident.count(),
      db!.logEntry.count(),
      db!.trace.count(),
      db!.span.count(),
      db!.metricSample.count(),
      db!.recoveryAction.count(),
      db!.service.count(),
      db!.dependency.count(),
    ]);
    expect(counts[0]).toBe(1);
    expect(counts[1]).toBeGreaterThanOrEqual(3); // historical + active incidents
    expect(counts[2]).toBeGreaterThan(500); // logs persisted
    expect(counts[3]).toBeGreaterThan(50); // traces persisted
    expect(counts[4]).toBeGreaterThan(100); // spans persisted
    expect(counts[5]).toBeGreaterThan(500); // metric samples persisted
    expect(counts[6]).toBe(1); // recovery history persisted
    expect(counts[7]).toBe(10); // services
    expect(counts[8]).toBe(15); // dependency edges
  }, 60_000);

  it("loads the exact state back (round-trip)", async () => {
    const { saveState, loadState } = await import("@/server/persistence");
    const { createInitialState } = await import("@/simulation/engine");

    const original = createInitialState("cascading");
    await saveState(original, "full");
    const loaded = await loadState();
    expect(loaded).not.toBeNull();
    expect(loaded!.tick).toBe(original.tick);
    expect(loaded!.scenarioId).toBe("cascading");
    expect(loaded!.health).toBe(original.health);
    expect(loaded!.logs.length).toBe(original.logs.length);
    expect(loaded!.incidents.length).toBe(original.incidents.length);
    expect(loaded!.fault).toEqual(original.fault);
  }, 60_000);

  it("rejects stale snapshot saves but allows full-save rewinds", async () => {
    const { saveState, loadState } = await import("@/server/persistence");
    const { createInitialState } = await import("@/simulation/engine");

    const newer = { ...createInitialState("db-exhaustion"), tick: 500 };
    await saveState(newer, "full");

    // Older snapshot (unload beacon race) → skipped, row unchanged.
    const stale = { ...newer, tick: 400 };
    const res = await saveState(stale, "snapshot");
    expect(res.skipped).toBe(true);
    const after = await loadState();
    expect(after!.tick).toBe(500);

    // Older full save (deliberate rewind: reset/load) → accepted.
    const rewind = { ...newer, tick: 120 };
    const res2 = await saveState(rewind, "full");
    expect(res2.skipped).toBeUndefined();
    expect((await loadState())!.tick).toBe(120);
  }, 60_000);

  it("clearState removes the snapshot", async () => {
    const { saveState, loadState, clearState } = await import("@/server/persistence");
    const { createInitialState } = await import("@/simulation/engine");
    await saveState(createInitialState("api-latency"), "snapshot");
    expect(await loadState()).not.toBeNull();
    await clearState();
    expect(await loadState()).toBeNull();
  }, 60_000);
});
