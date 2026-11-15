# BLACKBOX — Security & Production Readiness

Audit report for the persistence API, database layer and production
configuration. Every fix listed here is implemented in code and verified by
automated tests (see [Verification](#verification)); no claim below is
untested.

## Scope

- `/api/persistence/{status,load,save,clear}` and `/api/auth/{login,logout}`
- Prisma/PostgreSQL data access (`src/server/persistence.ts`, `src/server/db.ts`)
- Browser-facing configuration (`next.config.ts` headers), secrets handling,
  CI workflow, deployment/backup guidance (`docs/database.md`)

## Findings & resolutions

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **Critical** | All four persistence endpoints were unauthenticated — any caller could read, overwrite or wipe the workspace state | **Fixed** — every endpoint now requires a valid `Authorization: Bearer <PERSISTENCE_API_TOKEN>` or an HttpOnly session cookie; in production an unset token disables the API entirely (403) |
| 2 | **High** | No CSRF/origin protection on state-changing routes | **Fixed** — browser `Origin` must match the app host (plus `PERSISTENCE_ALLOWED_ORIGINS`); `Sec-Fetch-Site: cross-site` is rejected |
| 3 | **High** | No rate limiting (brute-forceable once auth exists) | **Fixed** — per-IP sliding-window limits: 300 req/min for persistence routes, 15 attempts/min for login (429 + `Retry-After`) |
| 4 | **Medium** | Error paths returned raw driver messages (`err.message` from Prisma on save/load/clear, `getStatus().error`) — can leak hosts, ports, SQL state | **Fixed** — responses use fixed generic messages; details go to server logs via `console.error` only |
| 5 | **Medium** | `DELETE /api/persistence/clear` was unguarded and unconditional | **Fixed** — authentication + origin + explicit confirmation header `x-confirm: clear` (HTTP 412 otherwise) |
| 6 | **Medium** | No request-size cap on `POST /save` | **Fixed** — 8 MB cap → HTTP 413 (snapshots are typically < 2 MB) |
| 7 | **Medium** | No security headers | **Fixed** — CSP, `X-Frame-Options: DENY`, `nosniff`, HSTS, Referrer-Policy, Permissions-Policy via `next.config.ts` |
| 8 | **Medium** | No way to unlock a locked API from the UI | **Fixed** — Settings → Persistence shows `locked — authentication required` with a token input that exchanges the token for a session cookie |
| 9 | Low | `.env.example` described a non-existent in-memory repository and documented no token | **Fixed** — rewritten with production guidance |
| 10 | Low | CI e2e job had `DATABASE_URL` but no auth token | **Fixed** — `PERSISTENCE_API_TOKEN` (test-only value) added to the e2e job env |
| 11 | Info | Possible SQL injection | **Verified clean** — no `$queryRaw`, `$executeRaw` or `Prisma.raw` anywhere; all queries go through the typed Prisma client |
| 12 | Info | Possible XSS sinks | **Verified clean** — no `dangerouslySetInnerHTML`; React escapes all rendered data |
| 13 | Info | Committed secrets | **Verified clean** — no credential-looking strings in the tree; `.gitignore` excludes `.env`, `.env.*` (except `.env.example`); CI uses an ephemeral service password (`blackbox`) for the throwaway test database only |
| 14 | Medium | Read-then-write check in snapshot saves (TOCTOU) | **Mitigated & documented** — snapshot saves are monotonic (stale pagehide beacons cannot roll back), full saves are authoritative, the client serializes its own save chain; single-workspace writes have no competing writers today |
| 15 | Medium | Prisma's default 5 s interactive-transaction timeout aborted full saves on slower hosts (observed locally, reproducible on the unmodified baseline) | **Fixed** — batch write and clear transactions now use `maxWait: 10 s / timeout: 30 s`, preserving atomicity |

## Authentication architecture

```
PERSISTENCE_API_TOKEN (≥ 16 chars, server-side only)
        │
        ├─ Authorization: Bearer <token>     (API clients, e2e, curl)
        │
        └─ POST /api/auth/login  {token}
                 └─ Set-Cookie: bb_session=<exp>.<hmac>
                      HttpOnly; SameSite=Strict; Secure (when HTTPS); 12 h TTL
                            │
                            └─ used by the browser app (incl. sendBeacon,
                               which cannot attach headers)
```

- The HMAC cookie is signed with the token (`SHA-256` HMAC, constant-time
  comparison) — it cannot be forged or reused beyond its expiry, and the
  secret itself never reaches the browser.
- `POST /api/auth/logout` clears the cookie (idempotent).
- **Modes** (resolved per request):
  - *token* — token configured: all persistence endpoints require auth;
  - *denied* — `NODE_ENV=production` without a usable token: every endpoint
    returns 403 (secure by default; no silent-open fallback);
  - *open* — development without a token: no auth (local DX only).

## Request pipeline (every persistence route)

```
rate limit (per IP) → Origin/CSRF check → auth (mode-dependent)
    → [destructive verbs] confirmation header → handler → validation
```

- **Validation**: JSON body parsed once, `isValidSimState` structural check
  (scenario must exist in the registry) before any database work; invalid →
  400/413/422 with fixed messages.
- **Rate-limit keys** use `X-Forwarded-For` (first hop) when present, so
  deployments behind a proxy throttle per client. Limits are in-memory and
  reset on server restart (see limitations).

## Browser hardening headers

Applied to every route by `next.config.ts`:

| Header | Value |
|--------|-------|
| Content-Security-Policy | `default-src 'self'; … script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; connect-src 'self'` |
| X-Frame-Options | `DENY` |
| X-Content-Type-Options | `nosniff` |
| Strict-Transport-Security | `max-age=15552000; includeSubDomains` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | camera/microphone/geolocation/payment/usb denied |

`'unsafe-inline'` for scripts/styles is required by Next.js' inline
hydration bootstrap and the `motion` library's inline styles; a nonce-based
CSP is future work (see limitations).

## Database security

- **No raw SQL** — all access is via the generated Prisma client; identifiers
  are never interpolated.
- **Transactions** — full saves write the snapshot + normalised telemetry in
  one batch transaction (atomic, 30 s timeout); `clearState()` wipes all
  tables in one transaction (30 s timeout).
- **Error exposure** — connection/driver failures are logged server-side and
  replaced with fixed messages (`connection failed`, `save failed`,
  `load failed`, `clear failed`).
- **Secrets** — `DATABASE_URL` and `PERSISTENCE_API_TOKEN` are read only from
  the server environment (`.env.local` is gitignored; production must inject
  them via a secret manager). Nothing secret is serialised into responses or
  the client bundle.

## Secrets checklist (production)

1. `NODE_ENV=production`
2. `DATABASE_URL` injected from a secret manager — dedicated least-privilege
   role, TLS (`?sslmode=require`), not present in the image/repo.
3. `PERSISTENCE_API_TOKEN` set to ≥ 16 random characters
   (`openssl rand -hex 32`) — if unset, the persistence API stays disabled.
4. Serve over HTTPS (enables the `Secure` cookie flag and HSTS).
5. Optional: `PERSISTENCE_ALLOWED_ORIGINS` for additional front-end origins.

## Verification

Executed on this branch (exact commands and results in the PR report):

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — **9 files / 90 tests passed**, including
  `tests/api-security.test.ts` (auth modes incl. production deny-by-default,
  bearer/session flows, tampered & expired cookies, CSRF/origin, 412
  confirmation, 400/413/422/503 hygiene, rate-limit windows) and
  `tests/persistence.test.ts` (real embedded PostgreSQL).
- `npm run build` — production build OK
- `npm run test:e2e` — **38/38 passed** Playwright suite incl.
  `tests/e2e/api-security.spec.ts`
  (401 on every endpoint without auth, cross-origin/cross-site rejection with
  a *valid* token, cookie login + HttpOnly/SameSite flags, forged/expired
  cookies, unconfirmed vs confirmed clear, per-IP login throttle, no driver
  text in error bodies) and the PostgreSQL round-trip specs.
- Live smoke (curl against `next start`): 401 without credentials → 200 with
  bearer; evil `Origin` → 403; clear without `x-confirm` → 412; wrong login
  token → generic 401; all security headers present.

## Known limitations (residual risk)

- **Shared-secret auth, no user accounts.** Anyone with the token is an
  admin of the single workspace. There is no per-user identity, RBAC or
  audit trail — out of scope for a single-operator tool, but it means token
  rotation is the only revocation mechanism.
- **In-memory rate limits** reset on restart and are per-process — a
  multi-replica deployment would need a shared store (e.g. Redis) for
  global limits.
- **Single-workspace data model.** `clearState()` deletes telemetry tables
  without a workspace filter; with exactly one workspace this cannot cross
  tenants, but it must be revisited before any multi-workspace feature.
- **CSP uses `'unsafe-inline'`** for script/style sources (Next.js inline
  bootstrap, motion inline styles). Nonce/hash-based CSP would harden this
  further.
- **Development without a token is open by design** — acceptable only
  because production mode denies by default and the docs state it plainly.
- **`sendBeacon` saves ride on the session cookie only** (browsers cannot
  attach headers to beacons). If the cookie expires while a tab is open,
  beacon saves fail silently until the next login — normal saves surface the
  locked state in the UI.
- **Snapshot-save TOCTOU** remains theoretically racy for concurrent
  external writers; today the client serializes its own saves and full saves
  are authoritative.
