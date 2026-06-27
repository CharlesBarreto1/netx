-- IA (@netx/ai) — motor de IA por tenant + log de uso.
-- Motor aberto (Ollama) self-hosted por padrão, com fallback de nuvem opcional.
-- A IA é CONSELHEIRA: resume/explica, nunca aplica config nem executa ação.

-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('OLLAMA', 'OPENAI_COMPAT', 'ANTHROPIC');

-- CreateTable
CREATE TABLE "ai_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" "AiProviderKind" NOT NULL DEFAULT 'OLLAMA',
    "base_url" VARCHAR(500),
    "model" VARCHAR(120) NOT NULL DEFAULT 'qwen2.5:3b-instruct',
    "api_key_enc" TEXT,
    "fallback_enabled" BOOLEAN NOT NULL DEFAULT false,
    "fallback_provider" "AiProviderKind" NOT NULL DEFAULT 'ANTHROPIC',
    "fallback_model" VARCHAR(120) NOT NULL DEFAULT 'claude-haiku-4-5',
    "fallback_base_url" VARCHAR(500),
    "fallback_api_key_enc" TEXT,
    "max_tokens" INTEGER NOT NULL DEFAULT 1024,
    "timeout_ms" INTEGER NOT NULL DEFAULT 120000,
    "redact_pii" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "feature" VARCHAR(80) NOT NULL,
    "provider" "AiProviderKind" NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "used_fallback" BOOLEAN NOT NULL DEFAULT false,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "error" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_configs_tenant_id_key" ON "ai_configs"("tenant_id");
CREATE INDEX "ai_usage_logs_tenant_id_feature_created_at_idx" ON "ai_usage_logs"("tenant_id", "feature", "created_at");
CREATE INDEX "ai_usage_logs_tenant_id_created_at_idx" ON "ai_usage_logs"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_configs" ADD CONSTRAINT "ai_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
