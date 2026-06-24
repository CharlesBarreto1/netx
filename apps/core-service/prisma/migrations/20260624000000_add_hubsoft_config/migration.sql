-- Hubsoft — integração de leitura (read-only) para migração/operação conjunta.
-- Config por tenant com credenciais OAuth2 cifradas (CryptoService) + telemetria
-- do último sync. Espelha o padrão de efi_configs / btg_configs.

CREATE TABLE "hubsoft_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "host" VARCHAR(255),
    "credentials_enc" TEXT,
    "auto_sync" BOOLEAN NOT NULL DEFAULT false,
    "sync_customers" BOOLEAN NOT NULL DEFAULT true,
    "sync_financeiro" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" VARCHAR(16),
    "last_sync_error" TEXT,
    "last_sync_stats" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubsoft_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hubsoft_configs_tenant_id_key" ON "hubsoft_configs"("tenant_id");

ALTER TABLE "hubsoft_configs" ADD CONSTRAINT "hubsoft_configs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
