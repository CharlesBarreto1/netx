-- =============================================================================
-- Módulo Estoque — Fase 2: comodato + consumo em OS
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Adiciona vínculos entre stock e:
--   - Contract  (comodato — equipamento patrimonial alocado a cliente)
--   - ServiceOrder (consumo de material em OS)
--
-- A coluna `serial_items.contract_id` JÁ existe (criada na Fase 1 sem FK pra
-- evitar ciclo). Aqui só adicionamos a FOREIGN KEY.
--
-- As colunas `contract_id` e `service_order_id` em `stock_movements` são NOVAS.
-- =============================================================================

-- 1) FK existente: serial_items.contract_id → contracts(id) -------------------
-- ON DELETE SET NULL: se contrato for deletado (improvável com Restrict da
-- Fase 1, mas defensive), o serial volta a "sem contrato" — preserva histórico
-- do equipamento.
ALTER TABLE "serial_items"
  ADD CONSTRAINT "serial_items_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) stock_movements.contract_id (NEW) ----------------------------------------
ALTER TABLE "stock_movements"
  ADD COLUMN "contract_id" UUID,
  ADD CONSTRAINT "stock_movements_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "stock_movements_contract_id_idx"
  ON "stock_movements" ("contract_id")
  WHERE "contract_id" IS NOT NULL;

-- 3) stock_movements.service_order_id (NEW) -----------------------------------
ALTER TABLE "stock_movements"
  ADD COLUMN "service_order_id" UUID,
  ADD CONSTRAINT "stock_movements_service_order_id_fkey"
    FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "stock_movements_service_order_id_idx"
  ON "stock_movements" ("service_order_id")
  WHERE "service_order_id" IS NOT NULL;
