# BLACKBOX — Interactive Incident Investigation & Recovery Simulator

BLACKBOX is an end-to-end incident-response simulator. It seeds a realistic
microservices workspace, runs **three deterministic failure scenarios** through
a pure simulation engine, and gives you the tooling to investigate, experiment
with recovery actions, and produce verified incident reports.

```
Dashboard → Dependency Map → Service Monitor → Incident Center → Log Explorer
   → Trace Explorer → Investigation Engine → Recovery Simulator → Reports → Settings
```

Every page is wired to the same live simulation state: pause the clock, dig
through logs, correlate traces, rank root-cause hypotheses, apply recovery
actions with before/after KPIs, roll them back, and export the report. State
persists across reloads — in `localStorage` always, and in **PostgreSQL via
Prisma** when `DATABASE_URL` is configured.

---

## Quick start

```bash
npm install          # also runs `prisma generate` (postinstall)
npm run dev          # http://localhost:3000
```

Then open the app — the workspace is seeded automatically on first launch with
a mid-incident snapshot for the **DB connection exhaustion** scenario (the
engine warms up ~112 ticks of history so there is an active incident, healthy
baselines, logs and traces to explore immediately).

### Optional: PostgreSQL persistence

The app works with zero infrastructure (localStorage-only mode). To enable the
database tier:

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/blackbox?schema=public"
npm run db:migrate    # applies prisma/migrations via scripts/migrate.mjs
npm run dev
```

The Settings page shows the live connection status and offers manual
**Save now / Restore / Clear** controls. Without `DATABASE_URL` the app simply
reports `not configured` and keeps using localStorage.

For local development without an external server, `npm run db:up` starts an
embedded PostgreSQL (v17) on port `54329` with data directory `.blackbox-pg/`.

### All commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (http://localhost:3000) |
| `npm run build` | Production build (runs `prisma generate` first) |
| `npm start` | Serve the production build |
| `npm run typecheck` | `prisma generate` + `tsc --noEmit` — strict TypeScript check |
| `npm run lint` | `eslint .` — flat-config Next.js + React hooks rules |
| `npm test` | `vitest run` — 8 suites / 66 tests (engine, analysis, recovery, reports, persistence, routes, UI) |
| `npm run test:e2e` | Prepare browser + `playwright test` — 31 end-to-end tests |
| `npm run db:migrate` | Apply SQL migrations to `$DATABASE_URL` |
| `npm run db:up` | Start the embedded development PostgreSQL (port 54329) |
| `npm run prisma:generate` | Regenerate the Prisma client into `src/generated/prisma` |

### Verified results (this checkout)

Executed in order, all passing:

```
npm run typecheck   → 0 errors
npm run lint        → 0 errors, 0 warnings
npm test            → 8 files, 66 tests passed
npm run build       → compiled successfully (16 routes)
npm run test:e2e    → 31 end-to-end tests passed (7 spec files)
```

CI re-runs the same gates on every pull request (`.github/workflows/ci.yml`).

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
sequence always produces bit-identical state (covered by
`tests/determinism.test.ts`).

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
- **Log Explorer** — search (text/level/service/time), URL-driven filters
  (`?q=`, `?level=`), live tail, deep links from evidence, fields inspector
  with trace jump, CSV export.
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
  workspace snapshot export; **Persistence card** with local/DB status,
  Save now / Restore / Clear controls.

---

## Persistence

State is persisted in two tiers and restored in priority order
(local snapshot wins over the database):

1. **localStorage** (always on) — envelope `blackbox.sim-snapshot.v1`,
   throttled autosave (4 s), flushed on `pagehide`/`visibilitychange`; settings
   stored under a separate Zod-validated key.
2. **PostgreSQL** (when `DATABASE_URL` is set) — Prisma 7 client with the
   `pg` driver adapter:
   - `POST /api/persistence/save` — `snapshot` (single-row JSON) or `full`
     (one transaction: snapshot + normalised services, dependencies,
     incidents, timeline, recovery actions, metric samples, logs, traces and
     spans; telemetry older than 1 200 ticks is pruned);
   - `GET /api/persistence/load` / `DELETE /api/persistence/clear` /
     `GET /api/persistence/status`;
   - client autosave takes a `full` snapshot every 30 s and immediately after
     applying/rolling back actions, resolving incidents, switching or resetting
     scenarios; `sendBeacon` keeps the last tick durable across page loads;
   - on startup with an empty localStorage the app restores from PostgreSQL
     (e.g. a fresh browser profile) and shows a *“Restored from database”*
     toast.

Migrations live in `prisma/migrations/` and are applied with
`npm run db:migrate` (`scripts/migrate.mjs` — an idempotent runner that works
even where the Prisma schema engine download is unavailable).

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
├── server/                # persistence service layer (Prisma) + route helpers
├── state/                 # SimulationProvider (tick loop, actions, persistence), SettingsProvider
├── lib/                   # formatting, export, snapshot, persistence-client, hooks
└── app/                   # App Router pages (10 modules, detail routes, 4 persistence APIs)
components/                # shadcn-style UI kit, charts, layout, feature widgets
prisma/                    # schema.prisma + migrations/20261114090000_init
scripts/                   # prisma/migrate/db-up/e2e-prepare helpers
tests/                     # vitest suites (8) + Playwright e2e specs (7)
.github/workflows/ci.yml   # PR gate: install, typecheck, lint, unit tests, build + E2E job
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
- **Offline-friendly tooling**: `scripts/prisma.mjs` wraps Prisma CLI commands
  (client generation works fully from npm-installed packages), and
  `scripts/migrate.mjs` applies the canonical SQL migrations directly.

---

## Verification (commands + actual results)

```bash
npm install          # exit 0 (postinstall: Prisma client generated)
npm run typecheck    # exit 0 — no errors
npm run lint         # exit 0 — 0 errors, 0 warnings
npm test             # exit 0 — Test Files 8 passed (8) | Tests 66 passed (66)
npm run build        # exit 0 — 16 routes compiled
npm run test:e2e     # exit 0 — 31 passed (Playwright, local Chromium + PostgreSQL)
```

Unit/integration coverage (all executed):

- `tests/determinism.test.ts` — identical initial state & 30-tick trajectories
  per scenario; action-sequence determinism; sim clock invariants.
- `tests/engine.test.ts` — warm-up population, healthy baselines, fault
  progression, red-herring healthiness, SEV1 escalation, auto-resolve, KPI
  bounds.
- `tests/recovery.test.ts` — every action applies; pool resize/timeout effects;
  stack-semantics rollback; restart ⇒ relapse regression; patch ⇒ stable
  recovery; fail-open trade-off; red-herring neutrality; timeline audits.
- `tests/analysis.test.ts` — planted root cause ranks #1 in all three
  scenarios; sorted/bounded confidences with evidence deep links; confidence
  decays after recovery.
- `tests/report.test.ts` — report sections, impact metrics, verification
  (verified/refuted), Markdown/JSON export, snapshot validation.
- `tests/persistence.test.ts` — **real PostgreSQL**: boots an embedded server,
  applies migrations idempotently, round-trips save/load/clear through Prisma,
  asserts normalised row counts and the monotonic snapshot guard (stale
  snapshot rejected, full-save rewind allowed).
- `tests/routes.test.ts` — every sidebar entry has a real `page.tsx`
  (regression guard for the missing-route class of bug), detail + API routes
  exist, navigation has 10 unique entries.
- `tests/ui/sidebar.test.tsx` — jsdom: all ten modules render as real links
  with correct hrefs, group headings, `aria-current`.

End-to-end coverage (Playwright, all executed against a production build):

- `navigation` — each of the 10 sidebar modules opens a functional page with
  its own heading and substantive content; detail deep links work.
- `scenario-persistence` — topbar scenario switching, reload resumes the tick,
  settings survive reload, reset returns the warm-up snapshot.
- `investigation` — correlation analysis → ranked hypotheses → record root
  cause → resolve → reveal/verify; evidence deep links navigate.
- `recovery` — apply action → confirmation → before/after KPIs → history →
  reload persistence → stack rollback; red-herring action applies safely.
- `reports` — report list → full report sections → Markdown download → history
  survives scenario switches.
- `logs` — level/search filters with URL state, deep links, row-detail dialog,
  CSV export, live-tail toggle.
- `persistence-db` — live PostgreSQL status, save/load API round-trip,
  fresh-browser-profile restore from the database, invalid payload rejection.

---

## Motion & animation

The UI uses **one** animation library — [`motion`](https://motion.dev)
(`motion@14`, imported from `motion/react`); no framer-motion or other
duplicate animation packages are installed.

Architecture:

- **Tokens** — `src/lib/motion.ts` is the single source of truth for
  durations (`instant` 120 ms → `slow` 320 ms) and easings, plus shared
  `Variants` (rise/fade/stagger). Components never hard-code ad-hoc timing.
- **Global config** — `MotionConfig reducedMotion="user"` in the root
  layout: Motion skips transform/layout animation for users with
  `prefers-reduced-motion: reduce`, while opacity fades remain. A matching
  CSS media query in `globals.css` disables CSS-driven animation
  (`animate-pulse`, `animate-spin`, transitions) for the same users.
- **Where animations live**:
  - route transitions — `AnimatePresence mode="wait"` keyed by pathname in
    `src/app/(app)/layout.tsx` (providers stay above the animated region);
  - dialogs/sheets/menus — open-state bridge + portal `forceMount` +
    `AnimatePresence` in the Radix primitives, so exits actually animate
    (Radix unmounts instantly by default); menus animate opacity only so the
    Radix popper transform keeps positioning;
  - sidebar active state — `layoutId` pill that slides between items;
  - KPI cards — value swap via `AnimatePresence mode="popLayout"` (no grid
    reflow); dashboard cards stagger in;
  - timeline entries, hypothesis cards, recovery before/after rows — stagger
    entrances; expandable sections animate `height`;
  - charts — Recharts series morph over ~320 ms (sparklines stay static to
    avoid animating every point in dense data);
  - buttons — CSS `hover`/`active` press feedback (zero re-renders).
- **Constraints respected** — animations never change DOM structure that
  Playwright selectors rely on (`data-testid`, roles, accessible names stay
  stable), no layout shift on data updates, reduced-motion honoured, and
  large datasets (log rows, spans, sparklines) are not per-point animated.

---

## Implemented vs. future work

### Implemented now

- All **ten sidebar modules** with functional pages (including the Log
  Explorer at `/logs`) plus detail routes for incidents, services, traces and
  reports.
- **Deterministic simulation engine** with three scenarios, incidents,
  hypotheses, recovery actions (incl. red herrings) and verified reports.
- **Two-tier persistence**: localStorage snapshots + PostgreSQL via Prisma 7
  (snapshot & full-normalised save modes, restore, clear, status API).
- **Persistence across reloads** for simulation state, incidents, metrics,
  logs, traces and recovery history.
- **Settings** with validated local persistence and database controls.
- **Motion (animation system)** — the `motion` package only (`motion/react`
  imports): route/page transitions, dialog/sheet/menu entrances & exits,
  sidebar active-pill layout animation, KPI value swaps, timeline & stagger
  reveals, chart/expandable transitions, button press feedback; everything
  honours `prefers-reduced-motion` (see “Motion & animation” below).
- **Tests**: 66 unit/integration tests (incl. a real-PostgreSQL suite) and 31
  Playwright end-to-end tests covering navigation, scenario switching,
  investigations, recovery/rollback, reports and persistence.
- **CI** on every pull request: install → Prisma generate → typecheck → lint →
  unit tests → production build, plus an E2E job with a PostgreSQL service.

### Future work (not implemented)

- Multi-user/multi-workspace collaboration (single workspace, single tab today).
- Retention/rollup policies beyond the fixed telemetry window (1 200 ticks).
- Additional scenarios or a scenario authoring UI (scenarios are code).
- Real-time database streaming (persistence uses REST + periodic snapshots,
  not subscriptions).
- Visual regression/screenshot testing and performance budgets in CI.
- Authenticated access to the persistence API (currently open on the app
  origin, intended for local/trusted deployments).

---

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript 5.9 (strict) · Tailwind CSS 4 ·
Radix/shadcn-style components · **Motion for React (`motion`)** · Lucide icons ·
Recharts · React Flow · Zod · Prisma 7 + PostgreSQL (pg adapter) · Vitest ·
Playwright · ESLint (flat config) · Geist fonts.

No paid APIs, no external services, no telemetry.

---

## Limitations

- Traces/metrics are simulated at realistic but fixed cardinality (10 services,
  ~1 170 metric points, ~300 traces per run) to keep the UI instant.
- Scenario scripts are hand-authored; the engine models queueing, saturation
  and cascade waves with deterministic heuristics rather than a full
  discrete-event simulator.
- The full save mode writes the snapshot and normalised telemetry in one
  transaction; concurrent saves from multiple tabs are last-writer-wins (single
  workspace by design).
- The embedded development PostgreSQL (`npm run db:up`) is a convenience for
  local/CI use — production deployments should provide their own server via
  `DATABASE_URL`.
- Some Prisma CLI commands require network access in restricted environments;
  `scripts/prisma.mjs` and `scripts/migrate.mjs` cover generate/migrate without
  it.

---

## Environment variables

`.env.example` contains only safe placeholders:

```
DATABASE_URL="postgresql://user:password@localhost:5432/blackbox?schema=public"
NODE_ENV="development"
```

No secrets are committed. The app runs with an empty environment
(localStorage-only mode).

---

## License

MIT — see [LICENSE](./LICENSE).
