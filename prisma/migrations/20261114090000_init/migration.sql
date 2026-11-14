-- BLACKBOX initial schema (PostgreSQL 14+)
-- Naming follows Prisma's default mapping so `prisma migrate` stays compatible.

CREATE TYPE "HealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'CRITICAL', 'DOWN');
CREATE TYPE "Severity" AS ENUM ('SEV1', 'SEV2', 'SEV3');
CREATE TYPE "IncidentStatus" AS ENUM ('TRIGGERED', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED');
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "runtime" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "pos_x" DOUBLE PRECISION NOT NULL,
    "pos_y" DOUBLE PRECISION NOT NULL,
    "baseline_cpu" DOUBLE PRECISION NOT NULL,
    "baseline_mem" DOUBLE PRECISION NOT NULL,
    "baseline_rps" DOUBLE PRECISION NOT NULL,
    "baseline_p95" DOUBLE PRECISION NOT NULL,
    "baseline_err" DOUBLE PRECISION NOT NULL,
    "slo" DOUBLE PRECISION NOT NULL,
    "status" "HealthStatus" NOT NULL DEFAULT 'HEALTHY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Service_workspaceId_name_key" ON "Service"("workspaceId", "name");
CREATE INDEX "Service_workspaceId_status_idx" ON "Service"("workspaceId", "status");

CREATE TABLE "Dependency" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "Dependency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Dependency_workspaceId_source_id_target_id_key" ON "Dependency"("workspaceId", "source_id", "target_id");

CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "trigger_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'TRIGGERED',
    "opened_tick" INTEGER NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "resolved_tick" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    "root_cause_hypothesis_id" TEXT,
    "root_cause_title" TEXT,
    "root_cause_confidence" DOUBLE PRECISION,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Incident_workspaceId_number_key" ON "Incident"("workspaceId", "number");
CREATE INDEX "Incident_workspaceId_status_severity_idx" ON "Incident"("workspaceId", "status", "severity");

CREATE TABLE "IncidentService" (
    "incident_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,

    CONSTRAINT "IncidentService_pkey" PRIMARY KEY ("incident_id", "service_id")
);

CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimelineEvent_incident_id_tick_idx" ON "TimelineEvent"("incident_id", "tick");

CREATE TABLE "MetricSample" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "cpu_pct" DOUBLE PRECISION NOT NULL,
    "mem_pct" DOUBLE PRECISION NOT NULL,
    "rps" DOUBLE PRECISION NOT NULL,
    "latency_p95_ms" DOUBLE PRECISION NOT NULL,
    "error_rate" DOUBLE PRECISION NOT NULL,
    "saturation" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MetricSample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetricSample_service_id_tick_key" ON "MetricSample"("service_id", "tick");
CREATE INDEX "MetricSample_service_id_ts_idx" ON "MetricSample"("service_id", "ts");

CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "level" "LogLevel" NOT NULL,
    "service_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "trace_id" TEXT,
    "fields" JSONB NOT NULL,

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LogEntry_service_id_level_ts_idx" ON "LogEntry"("service_id", "level", "ts");
CREATE INDEX "LogEntry_trace_id_idx" ON "LogEntry"("trace_id");

CREATE TABLE "Trace" (
    "id" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "route" TEXT NOT NULL,
    "entry_service_id" TEXT NOT NULL,
    "duration_ms" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "Trace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Trace_status_ts_idx" ON "Trace"("status", "ts");
CREATE INDEX "Trace_entry_service_id_ts_idx" ON "Trace"("entry_service_id", "ts");

CREATE TABLE "Span" (
    "id" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "start_ms" DOUBLE PRECISION NOT NULL,
    "duration_ms" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,

    CONSTRAINT "Span_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Span_trace_id_idx" ON "Span"("trace_id");
CREATE INDEX "Span_service_id_status_idx" ON "Span"("service_id", "status");

CREATE TABLE "RecoveryAction" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT,
    "action_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT[],
    "rolledBack" BOOLEAN NOT NULL DEFAULT false,
    "rolled_back_tick" INTEGER,
    "fault_before" JSONB NOT NULL,
    "kpi_before" JSONB NOT NULL,
    "kpi_after" JSONB NOT NULL,

    CONSTRAINT "RecoveryAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecoveryAction_action_id_tick_idx" ON "RecoveryAction"("action_id", "tick");

CREATE TABLE "WorkspaceSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "WorkspaceSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "SimulationState" (
    "id" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "health" DOUBLE PRECISION NOT NULL,
    "payload" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationState_pkey" PRIMARY KEY ("id")
);

-- Foreign keys (Prisma default actions: RESTRICT on delete, CASCADE on update)
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_target_id_fkey"
  FOREIGN KEY ("target_id") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncidentService" ADD CONSTRAINT "IncidentService_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncidentService" ADD CONSTRAINT "IncidentService_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetricSample" ADD CONSTRAINT "MetricSample_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Span" ADD CONSTRAINT "Span_trace_id_fkey"
  FOREIGN KEY ("trace_id") REFERENCES "Trace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Span" ADD CONSTRAINT "Span_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecoveryAction" ADD CONSTRAINT "RecoveryAction_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
