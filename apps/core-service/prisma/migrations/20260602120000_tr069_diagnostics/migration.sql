-- CreateEnum
CREATE TYPE "Tr069OpticalHealth" AS ENUM ('OK', 'WARNING', 'CRITICAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Tr069AlertType" AS ENUM ('OPTICAL_RX_LOW', 'OPTICAL_RX_HIGH', 'OPTICAL_TX_ABNORMAL', 'DEVICE_OFFLINE', 'WIFI_WEAK_CLIENT', 'WIFI_HIGH_UTIL');

-- CreateEnum
CREATE TYPE "Tr069AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Tr069AlertStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "tr069_devices" ADD COLUMN     "last_diagnostic_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "tr069_diagnostics" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rx_power" DECIMAL(6,2),
    "tx_power" DECIMAL(6,2),
    "temperature" DECIMAL(6,2),
    "voltage" DECIMAL(7,3),
    "bias_current" DECIMAL(7,2),
    "optical_health" "Tr069OpticalHealth" NOT NULL DEFAULT 'UNKNOWN',
    "wifi_clients_24" INTEGER,
    "wifi_clients_5" INTEGER,
    "wifi_channel_24" INTEGER,
    "wifi_channel_5" INTEGER,
    "wifi_worst_rssi" INTEGER,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tr069_diagnostics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tr069_alerts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "type" "Tr069AlertType" NOT NULL,
    "severity" "Tr069AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "Tr069AlertStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "value" DECIMAL(8,2),
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tr069_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tr069_diagnostics_tenant_id_device_id_captured_at_idx" ON "tr069_diagnostics"("tenant_id", "device_id", "captured_at");

-- CreateIndex
CREATE INDEX "tr069_diagnostics_device_id_captured_at_idx" ON "tr069_diagnostics"("device_id", "captured_at");

-- CreateIndex
CREATE INDEX "tr069_alerts_tenant_id_status_severity_idx" ON "tr069_alerts"("tenant_id", "status", "severity");

-- CreateIndex
CREATE INDEX "tr069_alerts_device_id_status_idx" ON "tr069_alerts"("device_id", "status");

-- AddForeignKey
ALTER TABLE "tr069_diagnostics" ADD CONSTRAINT "tr069_diagnostics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tr069_diagnostics" ADD CONSTRAINT "tr069_diagnostics_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "tr069_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tr069_alerts" ADD CONSTRAINT "tr069_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tr069_alerts" ADD CONSTRAINT "tr069_alerts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "tr069_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

