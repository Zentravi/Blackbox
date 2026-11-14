# BLACKBOX — Interactive Incident Investigation & Recovery Simulator

BLACKBOX is a self-contained, end-to-end incident-response simulator. It seeds a
realistic microservices workspace, runs **three deterministic failure scenarios**
through a pure simulation engine, and gives you the tooling to investigate,
experiment with recovery actions, and produce verified incident reports —
entirely in the browser, with **no backend, no paid APIs, and no external
infrastructure**.

```
Dashboard → Service Monitor → Incident Center → Dependency Map → Log Explorer
   → Trace Explorer → Investigation Engine → Recovery Simulator → Reports → Settings
```

Every page is wired to the same live simulation state: pause the clock, dig
through logs, correlate traces, rank root-cause hypotheses, apply recovery
actions with before/after KPIs, roll them back, and export the report.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Then open the app — the workspace is seeded automatically on first launch with
a mid-incident snapshot for the **DB connection exhaustion** scenario
(the engine warms up ~112 ticks of history so there is an active incident,
healthy baselines, logs and traces to explore immediately).

### All commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (http://localhost:3000) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` — strict TypeScript check |
| `npm run lint` | `eslint .` — flat-config Next.js + React hooks rules |
| `npm test` | `vitest run` — simulation-engine test suite |

### Verified results (this checkout)

Executed in order, all passing:

```
npm run typecheck   → 0 errors
npm run lint        → 0 errors, 0 warnings
npm test            → 5 files, 45 tests passed
npm run build       → compiled successfully (see below)
```

---

## The three scenarios

| # | Scenario | What breaks | Planted root cause | Signature evidence |
| --- | --- | --- | --- | --- |
| **A** | **DB connection exhaustion** | Gateway p95 & errors climb, `postgres-primary` saturates, SEV1 escalation | Shared PostgreSQL pool (100 conns) saturated — requests wait up to 5 s for a slot | `waiting 5000ms for a free pool slot` gateway logs, DB saturation, failed `db.query` spans |
| **B** | **API latency degradation** | Search p95 balloons (140 ms → 800 ms+), checkout errors rise, gateway upstream timeouts | New ranking release saturated the search worker pool (queue depth → 0.72) | worker-pool saturation events, 88 % of search traces failing, search p95 4.9× baseline |
| **C** | **Cascading service failure** | Auth crashes (OOMKilled) → edge 503s → orders/notifications fail → SEV1 ×2 | `auth-service` memory leak from an unbounded session cache | `OOMKilled` fatals, auth RSS climbing, cache evictions — while the data tier stays healthy (red herring) |

All three are **deterministic**: the engine never calls `Date.now()` or
`Math.random()` — pseudo-randomness comes from a seeded FNV-1a/mulberry32
stream keyed on `(seed, tick, channel, …)`. The same scenario + seed + action
sequence always produces bit-identical state (covered by `tests/determinism.test.ts`).

Each scenario ships 5 root-cause hypotheses (one `actual: true`) with weighted
evidence slots, 4–6 recovery actions including **red herrings** (e.g. rolling
back the deploy in scenario A changes nothing), and automatic incident triggers
with escalation and auto-resolve rules.

---

## Features by module

- **Dashboard** — live health gauge, KPI row with deltas, error/latency charts,
  service heat tiles, active-incident cards, recent activity feed.
- **Service Monitor** — sortable/filterable service table with CPU/mem/rps/p95
  sparklines; drill into any service (charts, log/trace excerpts, top spans).
- **Incident Center** — list with status/severity/scope/search filters,
  acknowledge → investigate → resolve workflow, operator notes, root-cause
  recording with correctness verification, full timeline.
- **Dependency Map** — React Flow topology (10 nodes / 15 edges), propagation
  highlight, node focus deep-links (`?focus=`), upstream/downstream inspection.
- **Log Explorer** — search (text/level/service/time), live tail, deep links
  from evidence, fields inspector, CSV export.
- **Trace Explorer** — waterfall view with span tree, error/timeout filters,
  service breakdown, cross-links to logs & the owning incident.
- **Investigation Engine** — runs correlation analysis over live telemetry and
  returns ranked hypotheses with confidence bars, matched/missing evidence, and
  deep links; set your root cause, resolve the incident, then reveal the answer
  and see whether you were right.
- **Recovery Simulator** — apply actions with confirmation, before/after KPI
  deltas, action markers on the health chart, stack-scoped rollback (only the
  latest active action), relapse detection (restart-without-fix ⇒ OOM again),
  fail-open trade-offs, and an apply history.
- **Reports** — incident list with verified/refuted badges; per-incident report
  with summary, impact window, root-cause analysis, timeline, recovery actions,
  outcome verification and lessons; Markdown/JSON export + print.
- **Settings** — workspace name/environment, timezone, density, simulation
  defaults; Zod-validated persistence in `localStorage`; scenario switch/reset;
  workspace snapshot export.

---

## Architecture

```
src/
├── simulation/            # pure engine — zero React, zero I/O, zero wall-clock
│   ├── types.ts           # SimState, faults, incidents, hypotheses, actions
│   ├── config.ts          # tick length, epoch, limits, health weights
│   ├── rng.ts             # deterministic hash/mulberry32/noise helpers
│   ├── engine.ts          # createInitialState / step / applyAction / rollbackAction
│   ├── analysis.ts        # evidence correlation → ranked hypotheses
│   └── scenarios/         # A) db-exhaustion  B) api-latency  C) cascading
├── data/
│   ├── schema.ts          # Zod models mirroring the SQL tables + snapshot validation
│   ├── repository.ts      # async repository contract + in-memory implementation
│   └── selectors.ts       # derived read-models for the UI
├── state/                 # SimulationProvider (tick loop, actions, toasts), SettingsProvider
├── lib/                   # formatting, export, report builders, hooks
└── app/                   # App Router pages (10 modules + detail routes)
components/                # shadcn-style UI kit, charts, layout, feature widgets
prisma/                    # schema.prisma + SQL migration (PostgreSQL target)
docs/database.md           # data-architecture guide
tests/                     # vitest suite for the simulation engine
```

Key design decisions:

- **Simulation logic is fully separated from UI.** Pages are client components
  that read `SimulationProvider`; every mutation goes through pure engine
  functions (`step`, `applyAction`, `rollbackAction`, `updateIncident`,
  `switchScenario`) returning new state.
- **Deterministic warm-up** at launch: the engine replays ticks `1…startTick`
  so the first paint shows a populated, mid-incident world.
- **Incidents outlive scenario switches** (tagged with `scenarioId`) so Reports
  can show history across experiments.
- **Rollback is stack-scoped**: actions record `faultBefore`; only the most
  recent active action can be rolled back, guaranteeing consistent state.
- **Evidence windows** in the analysis layer use bounded lookbacks so
  confidence scores decay as the system recovers.

### PostgreSQL-ready data layer (documented deviation)

The product brief calls for a PostgreSQL-ready architecture. The runtime uses
a **deterministic in-memory repository** by default so the app runs with zero
infrastructure, and ships the production persistence layer alongside it:

- `prisma/schema.prisma` + `prisma/migrations/0001_init.sql` — full DDL for
  services, incidents, timeline, metrics, logs, traces/spans, recovery actions
  and settings;
- `src/data/schema.ts` — Zod contracts mirroring those tables (also validates
  workspace snapshot exports);
- `src/data/repository.ts` — async repository interfaces the UI already
  programs against; `docs/database.md` explains how to swap in Prisma.

**Why not run Prisma at runtime?** `@prisma/client` downloads native engines
from `binaries.prisma.sh` during install, which is unreachable from this build
environment, and a runtime Prisma client would violate the "runs without
external infrastructure" requirement. The schema is complete and ready — set
`DATABASE_URL`, run `prisma generate && prisma migrate deploy`, implement the
repository methods, and no application code changes are needed. See
`docs/database.md`.

---

## Verification (commands + actual results)

```bash
npm install          # 492 packages, exit 0
npm run typecheck    # exit 0 — no errors
npm run lint         # exit 0 — 0 errors, 0 warnings
npm test             # exit 0 — Test Files 5 passed (5) | Tests 45 passed (45)
npm run build        # exit 0 — production build compiled
```

Test coverage (all executed, none mocked):

- `tests/determinism.test.ts` — identical initial state & 30-tick trajectories
  per scenario; action-sequence determinism; sim clock invariants.
- `tests/engine.test.ts` — warm-up population, healthy baselines, fault
  progression, red-herring healthiness (payments provider), SEV1 escalation,
  auto-resolve, KPI bounds.
- `tests/recovery.test.ts` — every action applies; pool resize/timeout effects;
  stack-semantics rollback (reject stale rollback, restore `faultBefore`);
  restart ⇒ relapse regression; patch ⇒ stable recovery; fail-open trade-off;
  red-herring action neutrality; timeline audit entries.
- `tests/analysis.test.ts` — planted root cause ranks #1 in all three
  scenarios; confidences sorted/bounded with evidence deep links; distractors
  score below the truth; deterministic rankings; confidence decays after
  recovery.
- `tests/report.test.ts` — report sections, impact metrics, root-cause
  verification (verified/refuted), Markdown/JSON export, snapshot validation.

---

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript 5.9 (strict) · Tailwind CSS 4 ·
Radix/shadcn-style components · Lucide icons · Recharts · React Flow ·
Zod · Vitest · ESLint (flat config) · Geist fonts.

No paid APIs, no external services, no telemetry.

---

## Limitations

- **State is session-only.** Simulation state lives in memory (and settings in
  `localStorage`); a page reload re-seeds the deterministic snapshot. The
  PostgreSQL layer is shipped as schema + repository contract, not wired to a
  live database (see above).
- **Prisma CLI is not installed** (engine CDN unreachable from the build
  environment); the schema/SQL are validated by inspection and mirrored by the
  Zod contracts.
- Traces/metrics are simulated at realistic but fixed cardinality (10 services,
  ~120 metric points, ~300 traces per session) to keep the UI instant.
- Scenario scripts are hand-authored; the engine models queueing, saturation
  and cascade waves with simple deterministic heuristics rather than a
  full discrete-event simulator.
- Concurrent multi-user collaboration is out of scope (single workspace,
  single tab).

---

## Environment variables

`.env.example` contains only safe placeholders:

```
DATABASE_URL="postgresql://user:password@localhost:5432/blackbox?schema=public"
NODE_ENV="development"
```

No secrets are committed. The app runs with an empty environment.

---

## License

MIT — see [LICENSE](./LICENSE).
