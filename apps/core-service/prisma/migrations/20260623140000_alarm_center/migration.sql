-- =============================================================================
-- Central de Alarmes (CPE/OLT) — AlarmEvent + Incident + AlarmPolicy (F0+F1)
-- =============================================================================

-- CreateEnum
CREATE TYPE "AlarmEventKind" AS ENUM ('DOWN', 'UP', 'DEGRADED');
CREATE TYPE "AlarmScope" AS ENUM ('ONT', 'PON', 'CTO', 'CABLE', 'OLT', 'GEO');
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACK', 'RESOLVED');
CREATE TYPE "IncidentSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "AlarmRootCause" AS ENUM ('POWER_OUTAGE', 'FIBER_CUT', 'OPTICAL_DEGRADED', 'ISOLATED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "alarm_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ont_id" UUID,
    "olt_id" UUID,
    "contract_id" UUID,
    "kind" "AlarmEventKind" NOT NULL,
    "reason" VARCHAR(32),
    "alarm" VARCHAR(32),
    "aid" VARCHAR(32),
    "pon_slot" INTEGER,
    "pon_frame" INTEGER,
    "source" VARCHAR(24) NOT NULL DEFAULT 'syslog',
    "incident_id" UUID,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alarm_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scope" "AlarmScope" NOT NULL,
    "scope_ref_id" UUID,
    "scope_label" VARCHAR(120) NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "root_cause" "AlarmRootCause" NOT NULL DEFAULT 'UNKNOWN',
    "affected_count" INTEGER NOT NULL DEFAULT 0,
    "total_in_scope" INTEGER NOT NULL DEFAULT 0,
    "affected_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "parent_incident_id" UUID,
    "ai_summary" TEXT,
    "ai_root_cause" VARCHAR(120),
    "first_event_at" TIMESTAMP(3) NOT NULL,
    "last_event_at" TIMESTAMP(3) NOT NULL,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarm_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cto_pct_threshold" INTEGER NOT NULL DEFAULT 60,
    "cto_min_count" INTEGER NOT NULL DEFAULT 3,
    "pon_pct_threshold" INTEGER NOT NULL DEFAULT 50,
    "pon_min_count" INTEGER NOT NULL DEFAULT 4,
    "cable_pct_threshold" INTEGER NOT NULL DEFAULT 50,
    "cable_min_count" INTEGER NOT NULL DEFAULT 2,
    "olt_min_count" INTEGER NOT NULL DEFAULT 10,
    "geo_min_count" INTEGER NOT NULL DEFAULT 5,
    "debounce_seconds" INTEGER NOT NULL DEFAULT 45,
    "rx_low_dbm" DECIMAL(6,2) NOT NULL DEFAULT -27,
    "rx_high_dbm" DECIMAL(6,2) NOT NULL DEFAULT -8,
    "severity_map" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alarm_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alarm_events_tenant_id_at_idx" ON "alarm_events"("tenant_id", "at");
CREATE INDEX "alarm_events_tenant_id_ont_id_idx" ON "alarm_events"("tenant_id", "ont_id");
CREATE INDEX "alarm_events_incident_id_idx" ON "alarm_events"("incident_id");
CREATE INDEX "incidents_tenant_id_status_idx" ON "incidents"("tenant_id", "status");
CREATE INDEX "incidents_tenant_id_scope_scope_ref_id_idx" ON "incidents"("tenant_id", "scope", "scope_ref_id");
CREATE INDEX "incidents_tenant_id_created_at_idx" ON "incidents"("tenant_id", "created_at");
CREATE UNIQUE INDEX "alarm_policies_tenant_id_key" ON "alarm_policies"("tenant_id");

-- AddForeignKey
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_ont_id_fkey" FOREIGN KEY ("ont_id") REFERENCES "onts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_parent_incident_id_fkey" FOREIGN KEY ("parent_incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "alarm_policies" ADD CONSTRAINT "alarm_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
