import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Persistence API security: token/session auth, origin (CSRF) checks and
 * per-IP rate limiting.
 *
 * Auth modes (resolved per request so tests and runtime can change env):
 *  - `token`  — PERSISTENCE_API_TOKEN is set (≥ 16 chars): every request
 *               must present a valid bearer token or signed session cookie.
 *  - `denied` — production without a usable token: the persistence API is
 *               disabled (secure by default) until the operator configures
 *               a token.
 *  - `open`   — development without a token: no auth (local DX only).
 *
 * Origin checks and rate limits apply in every mode.
 */

export const SESSION_COOKIE = "bb_session";
const SESSION_VERSION = "bb:v1";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MIN_TOKEN_LENGTH = 16;

/** Persistence API requests allowed per IP per window. */
export const API_RATE_LIMIT = { limit: 300, windowMs: 60_000 };
/** Login attempts allowed per IP per window (brute-force throttle). */
export const LOGIN_RATE_LIMIT = { limit: 15, windowMs: 60_000 };

export type AuthMode = "open" | "token" | "denied";

/** Configured token, or null when unset/too short (never logged). */
export function getToken(): string | null {
  const raw = process.env.PERSISTENCE_API_TOKEN;
  if (!raw) return null;
  const token = raw.trim();
  if (token.length < MIN_TOKEN_LENGTH) return null;
  return token;
}

export function authMode(): AuthMode {
  if (getToken()) return "token";
  if (process.env.NODE_ENV === "production") return "denied";
  return "open";
}

/** Length-safe constant-time string comparison (hash first → fixed length). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Session cookie value: `<expMs>.<hmac>` — stateless and unforgeable. */
export function signSession(exp: number, secret: string): string {
  const mac = createHmac("sha256", secret).update(`${SESSION_VERSION}:${exp}`).digest("hex");
  return `${exp}.${mac}`;
}

export function verifySession(value: string | null | undefined, secret: string): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(value.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = signSession(exp, secret);
  return safeEqual(value, expected);
}

export function serializeSessionCookie(exp: number, secret: string, secure: boolean): string {
  const value = signSession(exp, secret);
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function serializeClearCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0", ...(secure ? ["Secure"] : [])].join(
    "; ",
  );
}

export function isSecureRequest(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (proto) return proto === "https";
  return request.url.startsWith("https:");
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "local";
}

/**
 * Origin/CSRF check: browser requests carry `Origin` on POST/PUT/DELETE (and
 * same-origin fetches too) — it must match this app's host. Non-browser
 * clients (no Origin) still pass here but must authenticate.
 */
export function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const allowed = new Set<string>();
  const host = request.headers.get("host");
  if (host) allowed.add(host.trim());
  // Fallback: derive the app host from the request URL (host header can be
  // absent on programmatically constructed Requests).
  try {
    allowed.add(new URL(request.url).host);
  } catch {
    // ignore — header-based checks still apply
  }
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) allowed.add(forwardedHost);
  const extra = process.env.PERSISTENCE_ALLOWED_ORIGINS;
  if (extra) {
    for (const entry of extra.split(",")) {
      const value = entry.trim();
      if (!value) continue;
      try {
        allowed.add(new URL(value).host); // accepts "https://host:port" or bare host
      } catch {
        allowed.add(value);
      }
    }
  }

  return allowed.has(originHost);
}

/** Cross-site requests (form posts from other sites) are rejected outright. */
export function isFetchSiteAllowed(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (!site) return true;
  return site === "same-origin" || site === "none";
}

// --- Rate limiting (per-process, in-memory sliding window) -------------------

const windows = new Map<string, number[]>();
const MAX_RATE_KEYS = 5_000;

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
  now = Date.now(),
): { ok: boolean; retryAfterSec: number } {
  if (windows.size > MAX_RATE_KEYS) {
    for (const [k, hits] of windows) {
      if (hits.length === 0 || hits[hits.length - 1] < now - windowMs) windows.delete(k);
      if (windows.size <= MAX_RATE_KEYS / 2) break;
    }
  }
  const hits = (windows.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) {
    const oldest = hits[0];
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }
  hits.push(now);
  windows.set(key, hits);
  return { ok: true, retryAfterSec: 0 };
}

/** Test hook — resets all rate-limit windows. */
export function resetRateLimits(): void {
  windows.clear();
}

// --- Guards ------------------------------------------------------------------

function unauthorized(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "unauthorized", message: "Authentication required (bearer token or session cookie)." },
    { status: 401, headers: { "cache-control": "no-store", "www-authenticate": 'Bearer realm="persistence"' } },
  );
}

function forbidden(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: "forbidden", message }, {
    status: 403,
    headers: { "cache-control": "no-store" },
  });
}

function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: "rate_limited", message: "Too many requests." },
    { status: 429, headers: { "cache-control": "no-store", "retry-after": String(retryAfterSec) } },
  );
}

function hasValidSession(request: Request): boolean {
  const token = getToken();
  if (!token) return false;
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    if (safeEqual(auth.slice(7).trim(), token)) return true;
  }
  const cookie = request.headers.get("cookie");
  if (cookie) {
    const match = cookie.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${SESSION_COOKIE}=`));
    if (match) return verifySession(match.slice(SESSION_COOKIE.length + 1), token);
  }
  return false;
}

export interface GuardOptions {
  /** Require a confirmation header for destructive verbs, e.g. { name: "x-confirm", value: "clear" }. */
  confirm?: { name: string; value: string };
  /** Rate-limit bucket label (distinct budgets per route family). */
  bucket?: string;
}

/**
 * Returns null when the request may proceed, otherwise an error response
 * (429/403/401/412). Order: rate limit → origin/CSRF → auth → confirmation.
 */
export function guardPersistence(request: Request, options: GuardOptions = {}): NextResponse | null {
  const ip = clientIp(request);
  const rl = rateLimit(`${options.bucket ?? "api"}:${ip}`, API_RATE_LIMIT);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  if (!isOriginAllowed(request)) {
    return forbidden("Cross-origin request rejected.");
  }
  if (!isFetchSiteAllowed(request)) {
    return forbidden("Cross-site request rejected.");
  }

  const mode = authMode();
  if (mode === "denied") {
    return forbidden(
      "Persistence API disabled: set PERSISTENCE_API_TOKEN (≥ 16 characters) to enable authenticated access.",
    );
  }
  if (mode === "token" && !hasValidSession(request)) {
    return unauthorized();
  }

  if (options.confirm && request.method !== "GET") {
    const provided = request.headers.get(options.confirm.name);
    if (provided?.trim().toLowerCase() !== options.confirm.value) {
      return NextResponse.json(
        {
          ok: false,
          error: "confirmation_required",
          message: `Missing confirmation header "${options.confirm.name}: ${options.confirm.value}".`,
        },
        { status: 412, headers: { "cache-control": "no-store" } },
      );
    }
  }

  return null;
}

/** Rate-limit + origin gate for the login endpoint (auth itself happens in the route). */
export function guardLogin(request: Request): NextResponse | null {
  const ip = clientIp(request);
  const rl = rateLimit(`login:${ip}`, LOGIN_RATE_LIMIT);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  if (!isOriginAllowed(request)) return forbidden("Cross-origin request rejected.");
  if (!isFetchSiteAllowed(request)) return forbidden("Cross-site request rejected.");
  return null;
}
