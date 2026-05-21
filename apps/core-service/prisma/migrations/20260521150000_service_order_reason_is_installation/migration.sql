-- =============================================================================
-- ServiceOrderReason ganha flag is_installation
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Quando reason.is_installation = true, a OS NÃO pode ser fechada sem ter
-- SerialItem ALLOCATED ao contrato (vínculo de comodato). Trava operacional:
-- impede técnico finalizar instalação sem registrar equipamento entregue.
-- =============================================================================
ALTER TABLE "service_order_reasons"
  ADD COLUMN IF NOT EXISTS "is_installation" BOOLEAN NOT NULL DEFAULT false;
