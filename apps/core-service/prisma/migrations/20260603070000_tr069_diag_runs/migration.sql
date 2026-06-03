-- CreateEnum
CREATE TYPE "Tr069DiagKind" AS ENUM ('DOWNLOAD', 'UPLOAD', 'PING', 'TRACEROUTE');

-- CreateEnum
CREATE TYPE "Tr069DiagState" AS ENUM ('REQUESTED', 'COMPLETED', 'ERROR');

-- CreateTable
CREATE TABLE "tr069_diagnostic_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "kind" "Tr069DiagKind" NOT NULL,
    "state" "Tr069DiagState" NOT NULL DEFAULT 'REQUESTED',
    "target" VARCHAR(512),
    "throughput_kbps" INTEGER,
    "ping_success" INTEGER,
    "ping_failure" INTEGER,
    "ping_avg_ms" DECIMAL(8,2),
    "ping_min_ms" DECIMAL(8,2),
    "ping_max_ms" DECIMAL(8,2),
    "error_text" TEXT,
    "raw" JSONB,
    "requested_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "tr069_diagnostic_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tr069_diagnostic_runs_tenant_id_device_id_created_at_idx" ON "tr069_diagnostic_runs"("tenant_id", "device_id", "created_at");

-- CreateIndex
CREATE INDEX "tr069_diagnostic_runs_device_id_kind_state_idx" ON "tr069_diagnostic_runs"("device_id", "kind", "state");

-- AddForeignKey
ALTER TABLE "tr069_diagnostic_runs" ADD CONSTRAINT "tr069_diagnostic_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tr069_diagnostic_runs" ADD CONSTRAINT "tr069_diagnostic_runs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "tr069_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

