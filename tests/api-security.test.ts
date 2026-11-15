// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { signSession, verifySession, rateLimit, resetRateLimits, authMode } from "@/server/auth";
import { GET as GET_status } from "@/app/api/persistence/status/route";
import { GET as GET_load } from "@/app/api/persistence/load/route";
import { POST as POST_save } from "@/app/api/persistence/save/route";
import { DELETE as DELETE_clear } from "@/app/api/persistence/clear/route";
import { POST as POST_login } from "@/app/api/auth/login/route";
import { POST as POST_logout } from "@/app/api/auth/logout/route";

/**
 * Unit tests for the persistence API security layer: auth modes, session
 * signing, CSRF/origin gates, rate limiting, confirmation of destructive
 * operations and generic (non-leaky) error bodies. Route handlers are called
 * directly with standard Request objects — no server needed.
 */

const ORIGINAL_ENV = {
  token: process.env.PERSISTENCE_API_TOKEN,
  nodeEnv: process.env.NODE_ENV,
  allowed: process.env.PERSISTENCE_ALLOWED_ORIGINS,
};

/** process.env.NODE_ENV is typed readonly (Next) — mutate through a cast. */
const mutableEnv = process.env as Record<string, string | undefined>;

const TOKEN = "unit-test-persistence-token-0123456789";

function bearer(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}` };
}

async function status(headers: Record<string, string> = {}) {
  const res = await GET_status(new Request("http://localhost:3000/api/persistence/status", { headers }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function login(body: unknown, headers: Record<string, string> = {}) {
  const res = await POST_login(
    new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() as Record<string, unknown>, setCookie: res.headers.get("set-cookie") };
}

beforeEach(() => {
  resetRateLimits();
  process.env.PERSISTENCE_API_TOKEN = TOKEN;
  delete process.env.PERSISTENCE_ALLOWED_ORIGINS;
  if (process.env.NODE_ENV !== "test") mutableEnv.NODE_ENV = "test";
});

afterAll(() => {
  if (ORIGINAL_ENV.token === undefined) delete process.env.PERSISTENCE_API_TOKEN;
  else process.env.PERSISTENCE_API_TOKEN = ORIGINAL_ENV.token;
  if (ORIGINAL_ENV.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
  else mutableEnv.NODE_ENV = ORIGINAL_ENV.nodeEnv;
  if (ORIGINAL_ENV.allowed === undefined) delete process.env.PERSISTENCE_ALLOWED_ORIGINS;
  else process.env.PERSISTENCE_ALLOWED_ORIGINS = ORIGINAL_ENV.allowed;
  resetRateLimits();
});

describe("auth modes", () => {
  it("resolves token mode when a sufficiently long token is configured", () => {
    expect(authMode()).toBe("token");
    process.env.PERSISTENCE_API_TOKEN = "short";
    // Under-length tokens are ignored (never accepted as weak secrets).
    expect(authMode()).toBe(process.env.NODE_ENV === "production" ? "denied" : "open");
  });

  it("denies everything in production without a token", async () => {
    mutableEnv.NODE_ENV = "production";
    delete process.env.PERSISTENCE_API_TOKEN;
    const { status: s, body } = await status();
    expect(s).toBe(403);
    expect(String(body.message)).toContain("PERSISTENCE_API_TOKEN");
    // save/clear are equally locked down
    const save = await POST_save(
      new Request("http://localhost:3000/api/persistence/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(save.status).toBe(403);
    const clear = await DELETE_clear(
      new Request("http://localhost:3000/api/persistence/clear", { method: "DELETE" }),
    );
    expect(clear.status).toBe(403);
    mutableEnv.NODE_ENV = "test";
    process.env.PERSISTENCE_API_TOKEN = TOKEN;
  });
});

describe("authentication", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const { status: s, body } = await status();
    expect(s).toBe(401);
    expect(body.error).toBe("unauthorized");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("accepts a valid bearer token", async () => {
    const { status: s, body } = await status(bearer());
    expect(s).toBe(200);
    expect(typeof body.configured).toBe("boolean");
  });

  it("issues an HttpOnly session cookie on valid login and honors it", async () => {
    const res = await login({ token: TOKEN });
    expect(res.status).toBe(200);
    expect(res.setCookie).toContain("bb_session=");
    expect(res.setCookie?.toLowerCase()).toContain("httponly");
    expect(res.setCookie?.toLowerCase()).toContain("samesite=strict");
    expect(res.setCookie).not.toContain(TOKEN); // secret never leaves the server

    const cookie = res.setCookie!.split(";")[0];
    const { status: s } = await status({ cookie });
    expect(s).toBe(200);
  });

  it("rejects a wrong login token generically", async () => {
    const res = await login({ token: "not-the-right-token-at-all" });
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("not-the-right-token");
  });

  it("rejects malformed bodies on login", async () => {
    const res = await POST_login(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("logout clears the session cookie", async () => {
    const res = await POST_logout(new Request("http://localhost:3000/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("bb_session=");
    expect(cookie).toContain("Max-Age=0");
  });
});

describe("session signing", () => {
  const secret = "unit-test-persistence-token-0123456789";

  it("round-trips a fresh session", () => {
    const exp = Date.now() + 60_000;
    expect(verifySession(signSession(exp, secret), secret)).toBe(true);
  });

  it("rejects tampered signatures and expired sessions", () => {
    const exp = Date.now() + 60_000;
    const cookie = signSession(exp, secret);
    const [value, sig] = [cookie.slice(0, cookie.indexOf(".")), cookie.slice(cookie.indexOf(".") + 1)];
    expect(verifySession(`${value}.${sig.slice(0, -2)}ff`, secret)).toBe(false);
    expect(verifySession(signSession(Date.now() - 1000, secret), secret)).toBe(false);
    expect(verifySession(`${value}.${sig}`, "other-secret-0123456789")).toBe(false);
    expect(verifySession(null, secret)).toBe(false);
    expect(verifySession("garbage", secret)).toBe(false);
  });
});

describe("CSRF / origin protection", () => {
  it("rejects a foreign origin even with a valid bearer token", async () => {
    const { status: s } = await status({ ...bearer(), origin: "https://evil.example" });
    expect(s).toBe(403);
  });

  it("rejects cross-site fetch metadata", async () => {
    const { status: s } = await status({ ...bearer(), "sec-fetch-site": "cross-site" });
    expect(s).toBe(403);
  });

  it("accepts the app's own origin", async () => {
    const { status: s } = await status({ ...bearer(), origin: "http://localhost:3000" });
    expect(s).toBe(200);
  });

  it("honors PERSISTENCE_ALLOWED_ORIGINS as an extra allow-list entry", async () => {
    process.env.PERSISTENCE_ALLOWED_ORIGINS = "https://trusted.example";
    const { status: s } = await status({ ...bearer(), origin: "https://trusted.example" });
    expect(s).toBe(200);
    process.env.PERSISTENCE_ALLOWED_ORIGINS = "";
    delete process.env.PERSISTENCE_ALLOWED_ORIGINS;
  });

  it("allows requests without an Origin header (non-browser clients)", async () => {
    const { status: s } = await status(bearer());
    expect(s).toBe(200);
  });
});

describe("destructive operations", () => {
  it("clear requires x-confirm: clear (412 otherwise)", async () => {
    const denied = await DELETE_clear(
      new Request("http://localhost:3000/api/persistence/clear", {
        method: "DELETE",
        headers: bearer(),
      }),
    );
    expect(denied.status).toBe(412);

    const body = await denied.json() as { error?: string };
    expect(body.error).toBe("confirmation_required");

    // With confirmation the guard passes (no DATABASE_URL in unit env →
    // clearState() no-ops and the route reports success).
    const ok = await DELETE_clear(
      new Request("http://localhost:3000/api/persistence/clear", {
        method: "DELETE",
        headers: { ...bearer(), "x-confirm": "clear" },
      }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
  });

  it("confirmation is not required for GET endpoints", async () => {
    const { status: s } = await status(bearer());
    expect(s).toBe(200);
    const load = await GET_load(new Request("http://localhost:3000/api/persistence/load", { headers: bearer() }));
    expect(load.status).toBe(200);
  });
});

describe("request validation & error hygiene", () => {
  it("rejects invalid JSON with 400", async () => {
    const res = await POST_save(
      new Request("http://localhost:3000/api/persistence/save", {
        method: "POST",
        headers: { ...bearer(), "content-type": "application/json" },
        body: "{oops",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an invalid simulation state with 422 and a fixed message", async () => {
    const res = await POST_save(
      new Request("http://localhost:3000/api/persistence/save", {
        method: "POST",
        headers: { ...bearer(), "content-type": "application/json" },
        body: JSON.stringify({ state: { nope: true } }),
      }),
    );
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toMatch(/prisma|postgres|ECONN|relation /i);
  });

  it("rejects oversized declared payloads with 413", async () => {
    const res = await POST_save(
      new Request("http://localhost:3000/api/persistence/save", {
        method: "POST",
        headers: { ...bearer(), "content-type": "application/json", "content-length": String(9 * 1024 * 1024) },
        body: "{}",
      }),
    );
    expect(res.status).toBe(413);
  });

  it("hides driver failures behind generic 503 bodies", async () => {
    // DATABASE_URL unset → saveState throws a driver/config error; the route
    // must answer with a fixed message, never the underlying error text.
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const res = await POST_save(
      new Request("http://localhost:3000/api/persistence/save", {
        method: "POST",
        headers: { ...bearer(), "content-type": "application/json" },
        body: JSON.stringify({ state: minimalValidState(), mode: "snapshot" }),
      }),
    );
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("save failed");
    expect(text).not.toMatch(/DATABASE_URL|prisma|ECONN/i);
    if (prev !== undefined) process.env.DATABASE_URL = prev;
  });
});

describe("rate limiting", () => {
  it("slides within the window and reports retry-after", () => {
    const opts = { limit: 2, windowMs: 1_000 };
    const t0 = 1_000_000;
    expect(rateLimit("unit-key", opts, t0).ok).toBe(true);
    expect(rateLimit("unit-key", opts, t0 + 10).ok).toBe(true);
    const blocked = rateLimit("unit-key", opts, t0 + 20);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    // Window slides forward → allowed again.
    expect(rateLimit("unit-key", opts, t0 + 1_001).ok).toBe(true);
  });

  it("throttles login brute force per client address", async () => {
    const headers = { "x-forwarded-for": "203.0.113.55" };
    let saw429 = false;
    for (let i = 0; i < 16; i++) {
      const res = await login({ token: `wrong-token-attempt-${i}` }, headers);
      if (res.status === 429) {
        saw429 = true;
        break;
      }
      expect(res.status).toBe(401);
    }
    expect(saw429).toBe(true);

    // A different client is unaffected.
    const other = await login({ token: "wrong-token-attempt-x" }, { "x-forwarded-for": "203.0.113.56" });
    expect(other.status).toBe(401);
  });
});

/** Smallest structurally valid SimState accepted by isValidSimState. */
function minimalValidState(): Record<string, unknown> {
  return {
    scenarioId: "db-exhaustion",
    seed: 1,
    tick: 1,
    simStartMs: Date.UTC(2026, 0, 1),
    simTimeMs: Date.UTC(2026, 0, 1) + 60_000,
    services: {},
    metrics: {},
    healthSeries: [],
    logs: [],
    traces: [],
    incidents: [],
    activity: [],
    actions: [],
    health: 100,
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
    seq: 1,
    historyLimit: 120,
    logLimit: 1200,
    traceLimit: 300,
  };
}
