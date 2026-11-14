import { expect, test } from "@playwright/test";
import { freshScenario } from "./helpers";

/**
 * PostgreSQL persistence end-to-end (requires DATABASE_URL on the server).
 * The webServer started by playwright.config.ts inherits DATABASE_URL from
 * the environment — see package.json `test:e2e` and .github/workflows/ci.yml.
 */
const dbConfigured = Boolean(process.env.DATABASE_URL);

test.describe("database persistence", () => {
  test.skip(!dbConfigured, "DATABASE_URL not set — skipping PostgreSQL E2E");

  test("status endpoint reports a live connection", async ({ request }) => {
    const res = await request.get("/api/persistence/status");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.connected).toBe(true);
  });

  test("save → load round-trips the simulation state", async ({ request }) => {
    const original = (await (await request.get("/api/persistence/load")).json()).state;

    const saveRes = await request.post("/api/persistence/save", {
      data: { state: buildProbeState(), mode: "snapshot" },
    });
    expect(saveRes.ok()).toBe(true);
    const saved = await saveRes.json();
    expect(saved.tick).toBe(999);

    const loaded = await (await request.get("/api/persistence/load")).json();
    expect(loaded.state).toBeTruthy();
    expect(loaded.state.tick).toBe(999);
    expect(loaded.state.scenarioId).toBe("db-exhaustion");

    // Put the original state back so later assertions aren't polluted.
    if (original) {
      const restore = await request.post("/api/persistence/save", {
        data: { state: original, mode: "snapshot" },
      });
      expect(restore.ok()).toBe(true);
    }
  });

  test("state saved from one browser profile restores in a fresh one", async ({
    page,
    browser,
  }) => {
    await freshScenario(page, /Database connection exhaustion/i);
    await page.goto("/settings");

    // Save the current state to PostgreSQL.
    await page.getByRole("button", { name: /Save now/i }).click();
    await expect(page.getByText(/Saved to database/i)).toBeVisible();
    await expect(page.getByTestId("db-status")).toContainText(/connected/);

    const savedTickText = await page.getByTestId("db-status").innerText();
    const savedTick = Number((savedTickText.match(/tick (\d+)/) ?? [])[1]);
    expect(Number.isFinite(savedTick)).toBe(true);

    // A brand-new browser profile has no local snapshot → the provider must
    // restore from PostgreSQL (the flow used when local storage is lost).
    const fresh = await browser.newContext();
    try {
      const p2 = await fresh.newPage();
      await p2.goto("/dashboard");
      await expect(p2.getByText(/Restored from database/i)).toBeVisible({ timeout: 30_000 });
      // Restored state matches the saved tick (simulation may then advance).
      const restoredTick = Number(
        ((await p2.getByText(/T\+\d+/).first().textContent()) ?? "").replace(/\D+/g, ""),
      );
      expect(restoredTick).toBeGreaterThanOrEqual(savedTick - 1);
    } finally {
      await fresh.close();
    }
  });

  test("invalid payloads are rejected", async ({ request }) => {
    const res = await request.post("/api/persistence/save", { data: { state: { nope: true } } });
    expect(res.status()).toBe(422);
  });
});

/** Minimal valid SimState for the round-trip probe (built client-side). */
function buildProbeState(tick = 999): Record<string, unknown> {
  return {
    scenarioId: "db-exhaustion",
    seed: 1,
    tick,
    simStartMs: Date.UTC(2026, 10, 14, 9, 0, 0),
    simTimeMs: Date.UTC(2026, 10, 14, 9, 0, 0) + tick * 60_000,
    services: {},
    metrics: {},
    healthSeries: [],
    logs: [],
    traces: [],
    incidents: [],
    activity: [],
    actions: [],
    health: 88,
    fault: { kind: "db-exhaustion", onsetTick: 100, intensity: 0.5, poolMax: 100, poolTimeoutEnabled: false, replicaShift: 0, rateLimitRps: 0, restartBoost: 0, restartTick: null, breakerEnabled: false, deploymentRolledBack: false },
    seq: 1000,
    historyLimit: 120,
    logLimit: 1200,
    traceLimit: 300,
  };
}
