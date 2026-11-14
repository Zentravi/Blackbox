-- BLACKBOX — initial PostgreSQL schema (PostgreSQL 14+)
-- Matches prisma/schema.prisma. Applied via `prisma migrate deploy`.

CREATE TYPE health_status AS ENUM ('HEALTHY', 'DEGRADED', 'CRITICAL', 'DOWN');
CREATE TYPE severity AS ENUM ('SEV1', 'SEV2', 'SEV3');
CREATE TYPE incident_status AS ENUM ('TRIGGERED', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED');
CREATE TYPE log_level AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

CREATE TABLE services (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  team          TEXT NOT NULL,
  runtime       TEXT NOT NULL,
  description   TEXT NOT NULL,
  tier          INTEGER NOT NULL,
  pos_x         DOUBLE PRECISION NOT NULL,
  pos_y         DOUBLE PRECISION NOT NULL,
  baseline_cpu  DOUBLE PRECISION NOT NULL,
  baseline_mem  DOUBLE PRECISION NOT NULL,
  baseline_rps  DOUBLE PRECISION NOT NULL,
  baseline_p95  DOUBLE PRECISION NOT NULL,
  baseline_err  DOUBLE PRECISION NOT NULL,
  slo           DOUBLE PRECISION NOT NULL,
  status        health_status NOT NULL DEFAULT 'HEALTHY',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE INDEX services_ws_status_idx ON services (workspace_id, status);

CREATE TABLE dependencies (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_id    TEXT NOT NULL REFERENCES services (id),
  target_id    TEXT NOT NULL REFERENCES services (id),
  protocol     TEXT NOT NULL,
  label        TEXT,
  UNIQUE (workspace_id, source_id, target_id)
);

CREATE TABLE incidents (
  id                       TEXT PRIMARY KEY,
  workspace_id             TEXT NOT NULL,
  scenario_id              TEXT NOT NULL,
  number                   TEXT NOT NULL,
  trigger_id               TEXT NOT NULL,
  title                    TEXT NOT NULL,
  description              TEXT NOT NULL,
  severity                 severity NOT NULL,
  status                   incident_status NOT NULL DEFAULT 'TRIGGERED',
  opened_tick              INTEGER NOT NULL,
  opened_at                TIMESTAMPTZ NOT NULL,
  resolved_tick            INTEGER,
  resolved_at              TIMESTAMPTZ,
  resolution               TEXT,
  root_cause_hypothesis_id TEXT,
  root_cause_title         TEXT,
  root_cause_confidence    DOUBLE PRECISION,
  UNIQUE (workspace_id, number)
);
CREATE INDEX incidents_ws_status_sev_idx ON incidents (workspace_id, status, severity);

CREATE TABLE incident_services (
  incident_id TEXT NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  service_id  TEXT NOT NULL REFERENCES services (id),
  PRIMARY KEY (incident_id, service_id)
);

CREATE TABLE timeline_events (
  id          TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  tick        INTEGER NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  kind        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  message     TEXT NOT NULL
);
CREATE INDEX timeline_events_incident_tick_idx ON timeline_events (incident_id, tick);

CREATE TABLE metric_samples (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  service_id     TEXT NOT NULL REFERENCES services (id),
  tick           INTEGER NOT NULL,
  ts             TIMESTAMPTZ NOT NULL,
  cpu_pct        DOUBLE PRECISION NOT NULL,
  mem_pct        DOUBLE PRECISION NOT NULL,
  rps            DOUBLE PRECISION NOT NULL,
  latency_p95_ms DOUBLE PRECISION NOT NULL,
  error_rate     DOUBLE PRECISION NOT NULL,
  saturation     DOUBLE PRECISION NOT NULL,
  UNIQUE (service_id, tick)
);
CREATE INDEX metric_samples_service_ts_idx ON metric_samples (service_id, ts);

CREATE TABLE log_entries (
  id         TEXT PRIMARY KEY,
  tick       INTEGER NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  level      log_level NOT NULL,
  service_id TEXT NOT NULL REFERENCES services (id),
  message    TEXT NOT NULL,
  trace_id   TEXT,
  fields     JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX log_entries_service_level_ts_idx ON log_entries (service_id, level, ts);
CREATE INDEX log_entries_trace_idx ON log_entries (trace_id);

CREATE TABLE traces (
  id               TEXT PRIMARY KEY,
  tick             INTEGER NOT NULL,
  ts               TIMESTAMPTZ NOT NULL,
  route            TEXT NOT NULL,
  entry_service_id TEXT NOT NULL,
  duration_ms      DOUBLE PRECISION NOT NULL,
  status           TEXT NOT NULL
);
CREATE INDEX traces_status_ts_idx ON traces (status, ts);
CREATE INDEX traces_entry_ts_idx ON traces (entry_service_id, ts);

CREATE TABLE spans (
  id           TEXT PRIMARY KEY,
  trace_id     TEXT NOT NULL REFERENCES traces (id) ON DELETE CASCADE,
  service_id   TEXT NOT NULL REFERENCES services (id),
  parent_id    TEXT,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  start_ms     DOUBLE PRECISION NOT NULL,
  duration_ms  DOUBLE PRECISION NOT NULL,
  status       TEXT NOT NULL,
  attributes   JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX spans_trace_idx ON spans (trace_id);
CREATE INDEX spans_service_status_idx ON spans (service_id, status);

CREATE TABLE recovery_actions (
  id          TEXT PRIMARY KEY,
  incident_id TEXT REFERENCES incidents (id),
  action_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  tick        INTEGER NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL,
  notes       TEXT[] NOT NULL DEFAULT '{}',
  rolled_back BOOLEAN NOT NULL DEFAULT FALSE,
  kpi_before  JSONB NOT NULL,
  kpi_after   JSONB NOT NULL
);
CREATE INDEX recovery_actions_action_tick_idx ON recovery_actions (action_id, tick);

CREATE TABLE workspace_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
