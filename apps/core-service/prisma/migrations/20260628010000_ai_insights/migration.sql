-- IA — insights proativos (detectores por cron empurram alertas pro Nexus).

-- CreateEnum
CREATE TYPE "AiInsightSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "AiInsightStatus" AS ENUM ('NEW', 'DISMISSED');

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "severity" "AiInsightSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "AiInsightStatus" NOT NULL DEFAULT 'NEW',
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "dedupe_key" VARCHAR(140) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissed_at" TIMESTAMP(3),

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_insights_tenant_id_dedupe_key_key" ON "ai_insights"("tenant_id", "dedupe_key");
CREATE INDEX "ai_insights_tenant_id_status_created_at_idx" ON "ai_insights"("tenant_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
