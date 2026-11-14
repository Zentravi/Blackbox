# BLACKBOX data architecture (PostgreSQL-ready)

## TL;DR

The simulator **runs fully in-memory** by default: a deterministic engine
produces services, metrics, logs, traces, incidents and recovery effects in
process, with zero external infrastructure. A PostgreSQL schema (Prisma +
raw SQL migration) is shipped alongside it so the same domain can be
persisted in production without redesign.

## Layers

```
src/simulation/       pure deterministic engine (no I/O, no Date.now, no Math.random)
        │
        ▼
src/state/            React providers — hold SimState, drive ticks & actions
        │
        ▼
src/data/             data contracts:
  schema.ts             Zod models mirroring the SQL tables
  repository.ts         async repository interfaces + InMemoryRepository
  selectors.ts          derived read-models for the UI
        │
        ▼ (optional, production)
prisma/                schema.prisma + migrations/0001_init.sql (PostgreSQL)
```

## Why not run Prisma at runtime?

`@prisma/client` downloads native engine binaries from `binaries.prisma.sh`
during installation. That host is unreachable from this build environment,
and the product requirement is that the app must run **without external
infrastructure**. Shipping a runtime Prisma client that cannot install would
break `npm install` for everyone.

Instead we:

1. keep the engine and UI **database-agnostic** behind repository interfaces
   (`src/data/repository.ts`) whose method set matches the SQL schema,
2. validate all persisted shapes with **Zod** (`src/data/schema.ts`),
3. ship a production-ready **Prisma schema + SQL migration** that can be
   applied as soon as a real database exists.

## Enabling PostgreSQL later

1. Create a database and set `DATABASE_URL` in `.env` (copy `.env.example`).
2. Install the toolchain (once network access to Prisma's engine CDN is available):

   ```bash
   npm install -D prisma
   npm install @prisma/client
   npx prisma generate
   npx prisma migrate deploy     # applies prisma/migrations/0001_init.sql
   ```

3. Implement the methods in `src/data/repository.ts` with Prisma calls
   (all signatures are already `async`), then return that implementation from
   `getRepository()` when `process.env.DATABASE_URL` is set.

No application code changes are required — the UI only consumes selectors
over `SimState`, and incident/telemetry writes go through the repository
contract.

## Schema overview

| Table | Purpose |
| --- | --- |
| `services`, `dependencies` | topology + layout coordinates + baselines |
| `incidents`, `incident_services`, `timeline_events` | incident lifecycle & audit trail |
| `metric_samples` | per-service time series (unique per tick) |
| `log_entries` | structured logs (JSONB fields, GIN-friendly) |
| `traces`, `spans` | distributed traces with parent/child spans |
| `recovery_actions` | applied experiments incl. before/after KPI JSON |
| `workspace_settings` | key/value JSON settings |

Retention guidance for production: downsample `metric_samples` beyond 30
days, partition `log_entries` by day, and archive resolved incidents.

## What *is* persisted today

- Settings → `localStorage` (schema-validated on read, fall back to defaults).
- Workspace snapshot export (Settings → Data & reset) → JSON download that
  validates against `WorkspaceSnapshotSchema`.
