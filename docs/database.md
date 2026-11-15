# BLACKBOX data architecture (Prisma + PostgreSQL at runtime)

## TL;DR

BLACKBOX persists the live simulation in **two tiers**:

1. **localStorage** — always available; a schema-validated workspace
   snapshot is written on a ~4 s throttle, on every important action, and
   on `pagehide` (best-effort beacon).
2. **PostgreSQL via Prisma** — used automatically when `DATABASE_URL` is
   set. The app saves a full snapshot + normalised telemetry every ~30 s
   (and immediately after scenario switches, recovery actions and incident
   updates), and restores from the database when no newer local snapshot
   exists.

Restore priority on load: **local snapshot → database snapshot →
deterministic warm-up state**. With no `DATABASE_URL` the app runs exactly
as before — persistence degrades to localStorage only and the Settings page
reports it.

## Runtime architecture

```
src/simulation/          pure deterministic engine (seeded PRNG, no I/O)
        │
        ▼
src/state/simulation-context.tsx
        │  SimState in React; tick loop; action dispatch
        │  save effects (4 s local / 30 s remote throttle, pagehide flush)
        │  remoteSaveChain — serialises remote saves so an older payload
        │  can never land after a newer one
        ▼
src/lib/persistence-client.ts       fetch wrappers for the API routes
        │
        ▼
src/app/api/persistence/{status,save,load,clear}/route.ts
        │  thin HTTP layer (Zod-validated input, mode: "snapshot" | "full")
        ▼
src/server/db.ts                    Prisma singleton + isDatabaseConfigured()
src/server/persistence.ts           saveState()/loadState()
        │  normalises telemetry into relational rows (transactional)
        │  snapshot mode enforces a monotonic-tick guard so a stale
        │  pagehide beacon can never rewind a newer save
        ▼
Prisma 7 (pg adapter) ── prisma/schema.prisma
                     └── prisma/migrations/20261114090000_init (12 tables)
```

Supporting pieces:

| Piece | Role |
| --- | --- |
| `src/lib/snapshot.ts` | Workspace snapshot schema (Zod), localStorage read/write, trim limits |
| `src/data/*` | Zod contracts, repository interfaces, selectors (UI reads stay DB-agnostic) |
| `scripts/db-up.mjs` | Boots an embedded PostgreSQL on `localhost:54329` (dev without a system install) |
| `scripts/migrate.mjs` | Applies pending SQL migrations using `DATABASE_URL` |
| `scripts/prisma.mjs` | `prisma generate` wrapper (used by `postinstall`, `prebuild`, `typecheck`) |
| `GET /api/persistence/status` | `{ configured, connected, tick, scenarioId, updatedAt }` — surfaced in Settings |

## Save modes

| Mode | Used by | Semantics |
| --- | --- | --- |
| `snapshot` | 30 s autosave, pagehide beacon | **Monotonic**: rejected if the stored tick is newer than the incoming one — defeats unload-beacon races |
| `full` | "Save now", scenario switch, restore round-trips | Authoritative write; may rewind (explicit user/system action) |

Client-side, all remote saves are chained (`remoteSaveChain` in
`simulation-context.tsx`): the payload is captured when the save is
requested, execution waits for the previous save to finish. Together with
the server-side tick guard this makes concurrent writers (autosave vs.
manual save vs. beacon) safe.

Telemetry written with a snapshot is pruned to the last
`TELEMETRY_RETENTION_TICKS` (1200) ticks; `full` mode re-normalises the
entire state.

## Schema (12 tables)

| Table | Purpose |
| --- | --- |
| `services` | service catalogue, kind/team, layout coordinates, healthy baselines |
| `dependencies` | directed edges between services (protocol labels) |
| `incidents` | incident lifecycle (severity, status, root cause, resolution) |
| `incident_services` | incident ↔ affected service join table |
| `timeline_events` | ordered incident audit trail (triggered → … → resolved) |
| `metric_samples` | per-service metric rows unique per tick (cpu, latency, errors) |
| `log_entries` | structured logs with JSONB `fields` |
| `traces` / `spans` | distributed traces with parent/child spans |
| `recovery_actions` | applied experiments incl. before/after KPI JSON + rollback |
| `workspace_settings` | key/value JSON settings per workspace |
| `simulation_state` | the canonical snapshot row (state JSON, tick, scenario, mode) |

Enums: `HealthStatus`, `Severity`, `IncidentStatus`, `LogLevel`.

Retention guidance for production: downsample `metric_samples` beyond 30
days, partition `log_entries` by day, archive resolved incidents.

## Running with PostgreSQL

```bash
npm install
npm run db:up          # embedded PostgreSQL on :54329 (or point at your own)
export DATABASE_URL='postgresql://user:pass@host:54329/blackbox?schema=public'
npm run db:migrate     # applies prisma/migrations/20261114090000_init
npm run dev            # app now saves to + restores from PostgreSQL
```

`npm run db:migrate` is idempotent. The Prisma client is generated at
`postinstall`/`prebuild` time into `src/generated/prisma` (git-ignored).

Without `DATABASE_URL`:

- `GET /api/persistence/status` returns `configured: false`,
- save/clear fail with a generic `503` (`save failed` / `clear failed`) —
  the raw configuration error stays in the server log,
- the app keeps working from localStorage (Settings shows
  "Saved locally only").

With `DATABASE_URL` set, the endpoints additionally require authentication —
see [docs/security.md](./security.md) (`PERSISTENCE_API_TOKEN`).

## Production deployment

1. **Inject secrets via the environment** (secret manager / platform env):
   `DATABASE_URL` (TLS, least-privilege role) and `PERSISTENCE_API_TOKEN`
   (≥ 16 chars, `openssl rand -hex 32`). Never bake either into the image.
   `NODE_ENV=production` activates deny-by-default persistence auth and HSTS.
2. **Build once, start once**: `npm ci && npm run build && npm start` —
   `scripts/prisma.mjs generate` runs at build time; the server does not
   need a database to boot (it answers `configured: false` until the DB is
   reachable).
3. **Run migrations before routing traffic**:
   `DATABASE_URL=… npm run db:migrate` (idempotent; prints `up to date` when
   already applied). The startup order — migrate → start → health-check
   `GET /api/persistence/status` — is verified by CI on every PR.
4. **Rollout check**: a fresh deployment against an empty database was
   exercised end-to-end in the audit (migrate → save → status/load respond
   `connected: true`).

## Backup & recovery

Everything needed for restore lives in PostgreSQL; localStorage is a cache.

**Standard deployments (pg client tools available):**

```bash
# Backup (custom format = compressed + selective-restore capable)
pg_dump --format=custom \
  --host=127.0.0.1 --port=54329 --username=postgres \
  --dbname=blackbox --file=blackbox-$(date +%F).dump

# Recovery into a fresh deployment (empty database, schema comes from dump)
createdb --host=… --username=… blackbox_restore
pg_restore --host=… --username=… --dbname=blackbox_restore \
  --no-owner blackbox-2026-11-15.dump
```

**Bundled fallback (no pg client tools — e.g. the embedded server, which
ships only `initdb`/`pg_ctl`/`postgres`):** the repo ships a logical
backup/restore pair driven by the `pg` driver that Prisma already depends on:

```bash
# Backup all 12 tables to JSON
DATABASE_URL=… node scripts/db-backup.mjs backup.json

# Fresh deployment, then restore data (schema is owned by migrations)
DATABASE_URL=… npm run db:migrate
DATABASE_URL=… node scripts/db-restore.mjs backup.json
```

Both scripts use parameterised SQL (no string interpolation of values) and
restore tables in FK-safe order.

- Retention suggestion: daily backups + keep the last 7–30 days; test the
  restore quarterly (the audit's drill below is the template).
- After a restore, `npm run db:migrate` reports `up to date` (the ledger is
  rebuilt by the migrations, not the data dump) and
  `GET /api/persistence/status` answers `connected: true` with the restored
  tick.

### Restore drill (audit execution, 2026-11-15)

Executed against the embedded PostgreSQL (`:54329`) with a populated
workspace:

1. `node scripts/db-backup.mjs /tmp/blackbox-backup.json` — snapshot of all
   12 tables.
2. Fresh deployment simulation: `CREATE DATABASE blackbox_restore_test` on an
   empty database + `npm run db:migrate` → migration applied.
3. `node scripts/db-restore.mjs` into the fresh database → every table
   restored, row counts match the dump.
4. `npm run db:migrate` again → `Database is up to date`.
5. Verification through the application's own persistence code
   (`getStatus()` + `loadState()` pointed at the restored database):
   `connected: true` and a valid simulation state with the same tick — the
   restored workspace loads end-to-end.

Exact outputs are reproduced in the PR audit report.

## What lives where

| Data | Store |
| --- | --- |
| Live simulation snapshot (state, tick, scenario) | localStorage **and** PostgreSQL (when configured) |
| Telemetry rows for DB restore | PostgreSQL (normalised tables above) |
| UI preferences (theme, density, speed, …) | `localStorage`, Zod-validated on read |
| Workspace snapshot export (Settings → Data) | JSON download, validated against `WorkspaceSnapshotSchema` |
| Deterministic warm-up | code (seeded engine) — no storage needed |

## Verification

- `tests/persistence.test.ts` boots a **real embedded PostgreSQL**, runs a
  save → load round-trip, and asserts the monotonic snapshot guard
  (stale snapshot rejected, full-save rewind allowed).
- `tests/e2e/persistence-db.spec.ts` covers the HTTP surface end-to-end:
  status, round-trip, cross-profile restore, invalid payload rejection
  (authenticated with a bearer token).
- `tests/e2e/api-security.spec.ts` covers the security contract: 401 without
  credentials, CSRF rejection, session-cookie login, confirmation header for
  `clear`, login throttling, generic error bodies.
