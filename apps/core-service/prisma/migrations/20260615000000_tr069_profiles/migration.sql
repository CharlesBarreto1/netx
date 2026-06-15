-- CreateEnum
CREATE TYPE "Tr069RuleSource" AS ENUM ('STATIC', 'CONTRACT_PPPOE_USER', 'CONTRACT_PPPOE_PASS', 'CONTRACT_PPPOE_VLAN', 'CONTRACT_WIFI_SSID', 'CONTRACT_WIFI_SSID_5G', 'CONTRACT_WIFI_PASS');

-- CreateEnum
CREATE TYPE "Tr069RuleMode" AS ENUM ('ENFORCE', 'REPORT_ONLY');

-- CreateEnum
CREATE TYPE "Tr069ComplianceStatus" AS ENUM ('UNKNOWN', 'COMPLIANT', 'DRIFTED', 'REMEDIATING', 'PENDING_REBOOT', 'FAILED');

-- CreateEnum
CREATE TYPE "Tr069DriftStatus" AS ENUM ('OPEN', 'REMEDIATING', 'PENDING_REBOOT', 'RESOLVED', 'FAILED');

-- AlterTable
ALTER TABLE "tr069_devices" ADD COLUMN     "compliance_status" "Tr069ComplianceStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "last_reconciled_at" TIMESTAMP(3),
ADD COLUMN     "pending_reboot_since" TIMESTAMP(3),
ADD COLUMN     "profile_id" UUID,
ADD COLUMN     "reconciled_profile_version" INTEGER;

-- CreateTable
CREATE TABLE "tr069_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "manufacturer" VARCHAR(64) NOT NULL,
    "product_class" VARCHAR(64),
    "firmware_pattern" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tr069_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tr069_profile_rules" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "param" VARCHAR(255) NOT NULL,
    "value_type" VARCHAR(32) NOT NULL DEFAULT 'xsd:string',
    "source" "Tr069RuleSource" NOT NULL DEFAULT 'STATIC',
    "static_value" VARCHAR(255),
    "mode" "Tr069RuleMode" NOT NULL DEFAULT 'REPORT_ONLY',
    "requires_reboot" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tr069_profile_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tr069_drifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "param" VARCHAR(255) NOT NULL,
    "expected" VARCHAR(255),
    "actual" VARCHAR(255),
    "status" "Tr069DriftStatus" NOT NULL DEFAULT 'OPEN',
    "requires_reboot" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "task_id" UUID,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "tr069_drifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tr069_profiles_tenant_id_manufacturer_product_class_idx" ON "tr069_profiles"("tenant_id", "manufacturer", "product_class");

-- CreateIndex
CREATE UNIQUE INDEX "tr069_profiles_tenant_id_name_key" ON "tr069_profiles"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "tr069_profile_rules_profile_id_idx" ON "tr069_profile_rules"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "tr069_profile_rules_profile_id_param_key" ON "tr069_profile_rules"("profile_id", "param");

-- CreateIndex
CREATE INDEX "tr069_drifts_tenant_id_device_id_status_idx" ON "tr069_drifts"("tenant_id", "device_id", "status");

-- CreateIndex
CREATE INDEX "tr069_drifts_tenant_id_status_idx" ON "tr069_drifts"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "tr069_devices" ADD CONSTRAINT "tr069_devices_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "tr069_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tr069_profiles" ADD CONSTRAINT "tr069_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tr069_profile_rules" ADD CONSTRAINT "tr069_profile_rules_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "tr069_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tr069_drifts" ADD CONSTRAINT "tr069_drifts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tr069_drifts" ADD CONSTRAINT "tr069_drifts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "tr069_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

