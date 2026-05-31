-- Código sequencial do contrato por tenant: "{prefix}-{seq}" (ex.: ZUX-1).
-- O sequencial passa a viver no Contract (todo contrato, Ufinet ou não); a
-- Ufinet apenas herda o code como externalId/Marquilla. Antes o seq vivia no
-- UfinetService — removido aqui.

-- 1) Prefixo de 3 letras por tenant (configurável na operação).
ALTER TABLE "tenants" ADD COLUMN "contract_prefix" VARCHAR(3);

-- 2) Sequencial global por tenant no contrato.
ALTER TABLE "contracts" ADD COLUMN "seq" INTEGER;

-- 3) Backfill do prefixo dos tenants existentes a partir do slug
--    (3 primeiros caracteres alfanuméricos, maiúsculos). Ajustável depois.
UPDATE "tenants"
SET "contract_prefix" = UPPER(LEFT(REGEXP_REPLACE("slug", '[^a-zA-Z0-9]', '', 'g'), 3))
WHERE "contract_prefix" IS NULL OR "contract_prefix" = '';

-- 4) Backfill do seq por tenant na ordem de criação (recomeça do 1 — QA).
--    Zera o code antes de reescrever pra não colidir no índice único
--    (tenant_id, code) durante a renumeração.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS rn
  FROM "contracts"
)
UPDATE "contracts" c
SET "seq" = o.rn, "code" = NULL
FROM ordered o
WHERE c."id" = o."id";

-- 5) Recompõe o code = "{prefix}-{seq}".
UPDATE "contracts" c
SET "code" = t."contract_prefix" || '-' || c."seq"::text
FROM "tenants" t
WHERE c."tenant_id" = t."id" AND c."seq" IS NOT NULL;

-- 6) Índice único do sequencial por tenant.
CREATE UNIQUE INDEX "contracts_tenant_id_seq_key" ON "contracts"("tenant_id", "seq");

-- 7) O sequencial agora vive no Contract; remove o do UfinetService.
DROP INDEX IF EXISTS "ufinet_services_tenant_id_seq_key";
ALTER TABLE "ufinet_services" DROP COLUMN IF EXISTS "seq";
