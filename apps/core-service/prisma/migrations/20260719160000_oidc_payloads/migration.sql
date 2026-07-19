-- Persistência dos artefatos do oidc-provider.
--
-- DDL gerado por `prisma migrate diff` e copiado literalmente.

-- CreateTable
CREATE TABLE "oidc_payloads" (
    "type" VARCHAR(64) NOT NULL,
    "id" VARCHAR(255) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "grant_id" VARCHAR(255),
    "user_code" VARCHAR(64),
    "uid" VARCHAR(255),
    "sub" VARCHAR(255),
    "expires_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oidc_payloads_pkey" PRIMARY KEY ("type","id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "oidc_payloads_grant_id_idx" ON "oidc_payloads"("grant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "oidc_payloads_uid_idx" ON "oidc_payloads"("uid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "oidc_payloads_user_code_idx" ON "oidc_payloads"("user_code");

-- CreateIndex
-- Sustenta a revogação no desligamento: apagar tudo de um usuário sem varrer
-- o JSON de todas as linhas.
CREATE INDEX IF NOT EXISTS "oidc_payloads_tenant_id_sub_idx" ON "oidc_payloads"("tenant_id", "sub");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "oidc_payloads_expires_at_idx" ON "oidc_payloads"("expires_at");

-- AddForeignKey
ALTER TABLE "oidc_payloads" ADD CONSTRAINT "oidc_payloads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
