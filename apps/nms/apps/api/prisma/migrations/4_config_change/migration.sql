-- Histórico de aplicações de config (escrita) com ciclo de vida + verify automático.
-- Complementa o audit_log (registro imutável da ação); aqui guardamos o estado do
-- rollback automático (commit confirmed / auto-revert) para a UI acompanhar.

-- CreateEnum
CREATE TYPE "ConfigChangeStatus" AS ENUM ('planned', 'applied', 'confirmed', 'rolled_back', 'failed');

-- CreateTable
CREATE TABLE "config_change" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "status" "ConfigChangeStatus" NOT NULL DEFAULT 'planned',
    "config" TEXT NOT NULL,
    "diff" TEXT,
    "detail" TEXT,
    "confirm_minutes" INTEGER NOT NULL DEFAULT 5,
    "confirm_deadline" TIMESTAMP(3),
    "verify_ok" BOOLEAN,
    "verify_detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "config_change_device_id_created_at_idx" ON "config_change"("device_id", "created_at");

-- AddForeignKey
ALTER TABLE "config_change" ADD CONSTRAINT "config_change_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
