-- Nexus via WhatsApp — linha interna dedicada ao copiloto.
--
-- 1) whatsapp_instances.purpose: distingue a linha de ATENDIMENTO (SUPPORT,
--    default — preserva as instâncias existentes) da linha NEXUS (operadores
--    falam com o copiloto). O roteamento do webhook usa esta coluna.
-- 2) nexus_operators: allowlist da linha NEXUS. Só operadores ACTIVE (pareados
--    por código) recebem resposta da Nexus — é a fronteira de segurança.
--
-- Idempotente (CREATE TYPE via guarda em pg_type; IF NOT EXISTS no resto) para
-- reaplicar sem quebrar, no mesmo estilo das migrations manuais do repo.

-- ── enum WaInstancePurpose ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WaInstancePurpose') THEN
    CREATE TYPE "WaInstancePurpose" AS ENUM ('SUPPORT', 'NEXUS');
  END IF;
END $$;

ALTER TABLE "whatsapp_instances"
  ADD COLUMN IF NOT EXISTS "purpose" "WaInstancePurpose" NOT NULL DEFAULT 'SUPPORT';

-- ── enum NexusOperatorStatus ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NexusOperatorStatus') THEN
    CREATE TYPE "NexusOperatorStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');
  END IF;
END $$;

-- ── tabela nexus_operators ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "nexus_operators" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"    UUID NOT NULL,
  "user_id"      UUID NOT NULL,
  "phone_e164"   VARCHAR(20),
  "status"       "NexusOperatorStatus" NOT NULL DEFAULT 'PENDING',
  "pair_code"    VARCHAR(16),
  "paired_at"    TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "nexus_operators_pkey" PRIMARY KEY ("id")
);

-- Um número → no máx. um operador; um usuário → no máx. um vínculo.
-- (No Postgres múltiplos NULLs são distintos: vários PENDING sem telefone ok.)
CREATE UNIQUE INDEX IF NOT EXISTS "nexus_operators_tenant_id_phone_e164_key"
  ON "nexus_operators"("tenant_id", "phone_e164");
CREATE UNIQUE INDEX IF NOT EXISTS "nexus_operators_tenant_id_user_id_key"
  ON "nexus_operators"("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "nexus_operators_tenant_id_status_idx"
  ON "nexus_operators"("tenant_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nexus_operators_tenant_id_fkey'
  ) THEN
    ALTER TABLE "nexus_operators"
      ADD CONSTRAINT "nexus_operators_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nexus_operators_user_id_fkey'
  ) THEN
    ALTER TABLE "nexus_operators"
      ADD CONSTRAINT "nexus_operators_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
