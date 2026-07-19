-- Chaves de assinatura do OIDC Provider.
--
-- DDL da tabela gerado por `prisma migrate diff` e copiado literalmente; o
-- índice parcial no fim é escrito à mão porque o Prisma não sabe declarar
-- índice único com WHERE no schema.

-- CreateEnum
CREATE TYPE "OidcKeyStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "oidc_signing_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kid" VARCHAR(64) NOT NULL,
    "alg" VARCHAR(10) NOT NULL DEFAULT 'RS256',
    "public_jwk" JSONB NOT NULL,
    "private_key_enc" TEXT NOT NULL,
    "status" "OidcKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "oidc_signing_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "oidc_signing_keys_kid_key" ON "oidc_signing_keys"("kid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "oidc_signing_keys_tenant_id_status_idx" ON "oidc_signing_keys"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "oidc_signing_keys" ADD CONSTRAINT "oidc_signing_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariante: no máximo UMA chave ACTIVE por tenant.
--
-- Isto é o que torna "qual chave assina?" uma pergunta sem ambiguidade. Deixar
-- só na aplicação abriria janela para duas chaves ativas numa corrida entre
-- rotações concorrentes, e aí metade dos tokens sairia assinada com uma chave
-- que o outro processo acabou de aposentar.
CREATE UNIQUE INDEX IF NOT EXISTS "oidc_signing_keys_one_active_per_tenant"
    ON "oidc_signing_keys"("tenant_id")
    WHERE "status" = 'ACTIVE';
