-- =============================================================================
-- WiFi-Opt — pacote de otimização Wi-Fi Huawei
-- =============================================================================
-- Flags por tenant (duplo opt-in com as envs WIFI_OPT_*), marcador de estado
-- por device (morre no deleteMany do swap — desejado) e ondas de rollout com
-- baseline/verificação/rollback. `device_id` das wave_devices é o OUI-SN
-- (string) SEM FK: o swap deleta a row de tr069_devices e o histórico da onda
-- deve sobreviver.

-- CreateEnum
CREATE TYPE "WifiOptWaveStatus" AS ENUM ('DRAFT', 'RUNNING', 'GATE_PASSED', 'GATE_FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WifiOptWaveDeviceState" AS ENUM ('QUEUED', 'BASELINED', 'PUSHED', 'VERIFYING', 'APPLIED', 'ROLLED_BACK', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "tr069_tenant_configs" ADD COLUMN     "wifi_opt_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wifi_opt_reg_domain" VARCHAR(8) NOT NULL DEFAULT 'PY',
ADD COLUMN     "wifi_opt_rollout_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tr069_devices" ADD COLUMN     "wifi_opt_profile" VARCHAR(8),
ADD COLUMN     "wifi_opt_applied_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "wifi_opt_waves" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "WifiOptWaveStatus" NOT NULL DEFAULT 'DRAFT',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "gate_report" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wifi_opt_waves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wifi_opt_wave_devices" (
    "id" UUID NOT NULL,
    "wave_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" VARCHAR(128) NOT NULL,
    "ont_id" UUID,
    "state" "WifiOptWaveDeviceState" NOT NULL DEFAULT 'QUEUED',
    "baseline" JSONB,
    "previous" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "pushed_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "rolled_back_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wifi_opt_wave_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wifi_opt_waves_tenant_id_status_idx" ON "wifi_opt_waves"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wifi_opt_wave_devices_wave_id_device_id_key" ON "wifi_opt_wave_devices"("wave_id", "device_id");

-- CreateIndex
CREATE INDEX "wifi_opt_wave_devices_tenant_id_state_idx" ON "wifi_opt_wave_devices"("tenant_id", "state");

-- AddForeignKey
ALTER TABLE "wifi_opt_waves" ADD CONSTRAINT "wifi_opt_waves_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_opt_wave_devices" ADD CONSTRAINT "wifi_opt_wave_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_opt_wave_devices" ADD CONSTRAINT "wifi_opt_wave_devices_wave_id_fkey" FOREIGN KEY ("wave_id") REFERENCES "wifi_opt_waves"("id") ON DELETE CASCADE ON UPDATE CASCADE;
