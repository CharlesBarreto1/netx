-- =============================================================================
-- Módulo Planos — catálogo de velocidades + preços
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Cria a tabela `plans` e vincula ao contrato:
--   - contracts.plan_id      → FK pro plano (SET NULL ao deletar plano)
--   - contracts.upload_mbps  → upload denormalizado (download já é bandwidth_mbps)
--
-- Valores ficam denormalizados no contrato — mudar o plano não altera
-- contratos existentes (preserva histórico financeiro).
-- =============================================================================

-- 1) Tabela plans -------------------------------------------------------------
CREATE TABLE "plans" (
  "id"             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID         NOT NULL,
  "name"           VARCHAR(120) NOT NULL,
  "description"    VARCHAR(500),
  "download_mbps"  INTEGER      NOT NULL,
  "upload_mbps"    INTEGER      NOT NULL,
  "monthly_price"  DECIMAL(12,2) NOT NULL,
  "is_active"      BOOLEAN      NOT NULL DEFAULT true,
  "order"          INTEGER      NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  "deleted_at"     TIMESTAMP(3),

  CONSTRAINT "plans_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "plans_tenant_id_name_key" ON "plans" ("tenant_id", "name");
CREATE INDEX "plans_tenant_id_is_active_idx" ON "plans" ("tenant_id", "is_active");

-- 2) Colunas novas em contracts ----------------------------------------------
ALTER TABLE "contracts"
  ADD COLUMN "plan_id"     UUID,
  ADD COLUMN "upload_mbps" INTEGER;

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL;

CREATE INDEX "contracts_tenant_id_plan_id_idx" ON "contracts" ("tenant_id", "plan_id");

-- 3) updated_at trigger pra plans --------------------------------------------
-- (trg_set_updated_at() já existe — criada na migration de provisioning)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'plans_set_updated_at') THEN
    CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON "plans"
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
END $$;

-- 4) RLS pra plans (mesmo padrão das outras tabelas multi-tenant) ------------
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plans" FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY plans_tenant_isolation ON "plans"
    USING (current_setting('app.tenant_id', true) IS NULL
           OR tenant_id::text = current_setting('app.tenant_id', true))
    WITH CHECK (current_setting('app.tenant_id', true) IS NULL
           OR tenant_id::text = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
