-- =============================================================================
-- Templates de provisionamento de OLT (Fase 2 — Zyxel ZyNOS)
-- Perfil estruturado + VLANs com papel; default por OLT e override por plano.
-- =============================================================================

-- CreateEnum
CREATE TYPE "ServiceProtocol" AS ENUM ('PPPOE', 'IPOE', 'BRIDGE');

-- CreateEnum
CREATE TYPE "ProfileVlanRole" AS ENUM ('DATA', 'MGMT');

-- CreateTable
CREATE TABLE "olt_provisioning_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "vendor" "OltVendor" NOT NULL DEFAULT 'ZYXEL',
    "ont_password" VARCHAR(64) NOT NULL DEFAULT 'DEFAULT',
    "full_bridge" BOOLEAN NOT NULL DEFAULT false,
    "bw_up_profile_name" VARCHAR(64) NOT NULL,
    "bw_down_profile_name" VARCHAR(64) NOT NULL,
    "bw_group_id" INTEGER NOT NULL DEFAULT 1,
    "uni_port" VARCHAR(16) NOT NULL DEFAULT '2-1',
    "service_protocol" "ServiceProtocol" NOT NULL DEFAULT 'PPPOE',
    "queue_tc" INTEGER NOT NULL DEFAULT 1,
    "queue_priority" INTEGER NOT NULL DEFAULT 0,
    "queue_weight" INTEGER NOT NULL DEFAULT 0,
    "ingress_profile" VARCHAR(64) NOT NULL DEFAULT 'DEFVAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "olt_provisioning_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "olt_profile_vlans" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "vid" INTEGER NOT NULL,
    "role" "ProfileVlanRole" NOT NULL DEFAULT 'DATA',
    "tagged" BOOLEAN NOT NULL DEFAULT true,
    "is_pvid" BOOLEAN NOT NULL DEFAULT false,
    "is_protocol_based" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "olt_profile_vlans_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "olts" ADD COLUMN "default_provisioning_profile_id" UUID;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN "provisioning_profile_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "olt_provisioning_profiles_tenant_id_name_key" ON "olt_provisioning_profiles"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "olt_provisioning_profiles_tenant_id_vendor_idx" ON "olt_provisioning_profiles"("tenant_id", "vendor");

-- CreateIndex
CREATE INDEX "olt_profile_vlans_profile_id_idx" ON "olt_profile_vlans"("profile_id");

-- AddForeignKey
ALTER TABLE "olt_provisioning_profiles" ADD CONSTRAINT "olt_provisioning_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olt_profile_vlans" ADD CONSTRAINT "olt_profile_vlans_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "olt_provisioning_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "olts" ADD CONSTRAINT "olts_default_provisioning_profile_id_fkey" FOREIGN KEY ("default_provisioning_profile_id") REFERENCES "olt_provisioning_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_provisioning_profile_id_fkey" FOREIGN KEY ("provisioning_profile_id") REFERENCES "olt_provisioning_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
