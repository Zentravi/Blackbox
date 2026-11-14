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
- save/clear routes answer `409 not configured`,
- the app keeps working from localStorage (Settings shows
  "Saved locally only").

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
  status, round-trip, cross-profile restore, invalid payload rejection.
