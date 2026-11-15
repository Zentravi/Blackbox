import { expect, test } from "@playwright/test";
import { bearerHeaders, persistenceToken } from "./helpers";

/** Structurally valid SimState used to seed the workspace in security tests. */
function probeState(tick: number): Record<string, unknown> {
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
    fault: {
      kind: "db-exhaustion",
      onsetTick: 100,
      intensity: 0.5,
      poolMax: 100,
      poolTimeoutEnabled: false,
      replicaShift: 0,
      rateLimitRps: 0,
      restartBoost: 0,
      restartTick: null,
      breakerEnabled: false,
      deploymentRolledBack: false,
    },
    seq: 1000,
    historyLimit: 120,
    logLimit: 1200,
    traceLimit: 300,
  };
}

/**
 * Security contract for /api/persistence + /api/auth (see docs/security.md):
 * authentication, CSRF/origin checks, confirmation of destructive operations,
 * generic error bodies and brute-force throttling.
 */
const dbConfigured = Boolean(process.env.DATABASE_URL);
const authed = Boolean(persistenceToken());

test.describe("persistence API security", () => {
  test.skip(!dbConfigured || !authed, "DATABASE_URL / PERSISTENCE_API_TOKEN not set — skipping");

  test("unauthenticated requests are rejected on every endpoint", async ({ request }) => {
    expect((await request.get("/api/persistence/status")).status()).toBe(401);
    expect((await request.get("/api/persistence/load")).status()).toBe(401);
    expect((await request.post("/api/persistence/save", { data: {} })).status()).toBe(401);
    expect((await request.delete("/api/persistence/clear")).status()).toBe(401);

    // Wrong token → generic 401, no echo of the attempted value.
    const bad = await request.post("/api/auth/login", { data: { token: "wrong-token-not-the-secret" } });
    expect(bad.status()).toBe(401);
    const body = await bad.json();
    expect(JSON.stringify(body)).not.toContain("wrong-token");
  });

  test("cross-origin requests are rejected even with a valid token", async ({ request }) => {
    const headers = { ...bearerHeaders(), origin: "https://evil.example" };
    const res = await request.get("/api/persistence/status", { headers });
    expect(res.status()).toBe(403);
    // Rejected before any body processing.
    const post = await request.post("/api/persistence/save", {
      headers,
      data: { state: null },
    });
    expect(post.status()).toBe(403);
    // Cross-site fetch metadata is rejected too.
    const sfs = await request.get("/api/persistence/status", {
      headers: { ...bearerHeaders(), "sec-fetch-site": "cross-site" },
    });
    expect(sfs.status()).toBe(403);
  });

  test("login issues a session cookie that unlocks the API", async ({ request }) => {
    const login = await request.post("/api/auth/login", { data: { token: persistenceToken() } });
    expect(login.ok()).toBe(true);
    const setCookie = login.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("bb_session=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");

    // Same request fixture now carries the cookie → no bearer needed.
    const status = await request.get("/api/persistence/status");
    expect(status.ok()).toBe(true);
    expect((await status.json()).connected).toBe(true);
  });

  test("tampered or expired session cookies are rejected", async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      // Forged signature.
      const forged = await ctx.request.get("/api/persistence/status", {
        headers: { cookie: `bb_session=${Date.now() + 60_000}.deadbeefdeadbeef` },
      });
      expect(forged.status()).toBe(401);
      // Correct-looking shape but expired.
      const expired = await ctx.request.get("/api/persistence/status", {
        headers: { cookie: `bb_session=${Date.now() - 1000}.deadbeefdeadbeef` },
      });
      expect(expired.status()).toBe(401);
    } finally {
      await ctx.close();
    }
  });

  test("destructive clear requires an explicit confirmation header", async ({ request }) => {
    const headers = bearerHeaders();

    // Seed a known state so "unchanged" and "wiped" are both observable
    // (the suite may start against a completely fresh database).
    const seed = await request.post("/api/persistence/save", {
      headers,
      data: { state: probeState(4242), mode: "full" },
    });
    expect(seed.ok()).toBe(true);

    const unconfirmed = await request.delete("/api/persistence/clear", { headers });
    expect(unconfirmed.status()).toBe(412);
    // Still there — the unconfirmed call changed nothing.
    const afterUnconfirmed = (await (await request.get("/api/persistence/load", { headers })).json()).state;
    expect(afterUnconfirmed?.tick).toBe(4242);

    const confirmed = await request.delete("/api/persistence/clear", {
      headers: { ...headers, "x-confirm": "clear" },
    });
    expect(confirmed.ok()).toBe(true);
    expect((await confirmed.json()).ok).toBe(true);
    expect((await (await request.get("/api/persistence/load", { headers })).json()).state).toBeNull();
  });

  test("login brute force is throttled per client", async ({ request }) => {
    // Isolated source address so the shared e2e login budget stays intact.
    const ip = "198.51.100.77";
    let last = 0;
    for (let i = 0; i < 16; i++) {
      const res = await request.post("/api/auth/login", {
        data: { token: `wrong-token-attempt-number-${i}` },
        headers: { "x-forwarded-for": ip },
      });
      last = res.status();
      if (last === 429) break;
    }
    expect(last).toBe(429);

    // A different source address is unaffected.
    const other = await request.post("/api/auth/login", {
      data: { token: "wrong-token-attempt-number-x" },
      headers: { "x-forwarded-for": "198.51.100.78" },
    });
    expect(other.status()).toBe(401);
  });

  test("error bodies never leak driver internals", async ({ request }) => {
    const headers = bearerHeaders();
    const res = await request.post("/api/persistence/save", {
      headers,
      // structurally invalid → 422 with a fixed message
      data: { state: { nope: true } },
    });
    expect(res.status()).toBe(422);
    const text = await res.text();
    expect(text).not.toMatch(/prisma|postgresql|127\.0\.0\.1|ECONNREFUSED|relation /i);
  });
});
