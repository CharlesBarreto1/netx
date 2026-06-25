-- AlterEnum
ALTER TYPE "Tr069RuleSource" ADD VALUE 'TENANT_ACCESS_PASSWORD';

-- CreateTable
CREATE TABLE "tr069_tenant_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "accept_unknown_informs" BOOLEAN NOT NULL DEFAULT false,
    "wifi_from_contract" BOOLEAN NOT NULL DEFAULT true,
    "pppoe_source" VARCHAR(16) NOT NULL DEFAULT 'CONTRACT',
    "default_vlan" INTEGER,
    "pull_from_olt_provisioning" BOOLEAN NOT NULL DEFAULT false,
    "ipv6_enabled" BOOLEAN NOT NULL DEFAULT true,
    "ipv6_mode" VARCHAR(16) NOT NULL DEFAULT 'AUTOCONFIGURED',
    "access_password_enc" TEXT,
    "apply_access_password" BOOLEAN NOT NULL DEFAULT false,
    "remote_http_enabled" BOOLEAN NOT NULL DEFAULT false,
    "remote_http_port" INTEGER,
    "remote_mode" VARCHAR(16) NOT NULL DEFAULT 'LAN_ONLY',
    "firmware_auto_update" BOOLEAN NOT NULL DEFAULT false,
    "firmware_url" VARCHAR(512),
    "firmware_target_version" VARCHAR(64),
    "reconcile_interval_min" INTEGER,
    "reconcile_window_start" INTEGER,
    "reconcile_window_end" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tr069_tenant_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tr069_pending_devices" (
    "id" UUID NOT NULL,
    "device_id" VARCHAR(128) NOT NULL,
    "oui" VARCHAR(16),
    "product_class" VARCHAR(64),
    "serial_number" VARCHAR(64),
    "manufacturer" VARCHAR(64),
    "software_version" VARCHAR(32),
    "connection_request_url" VARCHAR(255),
    "parameters_snapshot" JSONB,
    "inform_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tr069_pending_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tr069_tenant_configs_tenant_id_key" ON "tr069_tenant_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tr069_pending_devices_device_id_key" ON "tr069_pending_devices"("device_id");

-- CreateIndex
CREATE INDEX "tr069_pending_devices_last_seen_at_idx" ON "tr069_pending_devices"("last_seen_at");

-- AddForeignKey
ALTER TABLE "tr069_tenant_configs" ADD CONSTRAINT "tr069_tenant_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
