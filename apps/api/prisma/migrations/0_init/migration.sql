-- CreateEnum
CREATE TYPE "Vendor" AS ENUM ('juniper');

-- CreateEnum
CREATE TYPE "IfStatus" AS ENUM ('up', 'down', 'unknown');

-- CreateEnum
CREATE TYPE "EventSeverity" AS ENUM ('info', 'warning', 'error', 'critical');

-- CreateTable
CREATE TABLE "device" (
    "id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "mgmt_ip" TEXT NOT NULL,
    "vendor" "Vendor" NOT NULL DEFAULT 'juniper',
    "model" TEXT,
    "os_version" TEXT,
    "site" TEXT,
    "credentials_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interface" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "admin_status" "IfStatus" NOT NULL DEFAULT 'unknown',
    "oper_status" "IfStatus" NOT NULL DEFAULT 'unknown',
    "speed_bps" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interface_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "severity" "EventSeverity" NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_snapshot" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "git_hash" TEXT NOT NULL,
    "diff_summary" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "device_id" UUID,
    "action" TEXT NOT NULL,
    "command" TEXT,
    "diff" TEXT,
    "result" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_mgmt_ip_key" ON "device"("mgmt_ip");

-- CreateIndex
CREATE UNIQUE INDEX "interface_device_id_name_key" ON "interface"("device_id", "name");

-- CreateIndex
CREATE INDEX "event_device_id_ts_idx" ON "event"("device_id", "ts");

-- CreateIndex
CREATE INDEX "config_snapshot_device_id_captured_at_idx" ON "config_snapshot"("device_id", "captured_at");

-- CreateIndex
CREATE INDEX "audit_log_device_id_created_at_idx" ON "audit_log"("device_id", "created_at");

-- AddForeignKey
ALTER TABLE "interface" ADD CONSTRAINT "interface_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_snapshot" ADD CONSTRAINT "config_snapshot_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

