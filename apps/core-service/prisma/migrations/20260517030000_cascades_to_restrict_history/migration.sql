-- =============================================================================
-- Cascades destrutivos → Restrict pra dados de histórico financeiro/auditoria.
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Antes: deletar Customer → Cascade derrubava Contracts → Cascade derrubava
-- ContractInvoice, RadiusEvent, ServiceOrder e OneTimeCharge. Um único delete
-- acidental destruía histórico financeiro inteiro do cliente, irreversível.
--
-- Depois: deletar Customer com contratos lança P2003 (FK violation). Admin
-- precisa explicitamente cancelar/arquivar contratos antes. Soft-delete
-- (deletedAt) continua disponível pra "remover" da UI sem perder dados.
--
-- Operações afetadas (UI):
--   - DELETE /customers/:id retorna 409 se tiver contracts → frontend deve
--     mostrar "Cliente tem N contratos ativos. Cancele-os primeiro."
--   - DELETE /contracts/:id retorna 409 se tiver invoices/events/orders →
--     mesma mensagem.
-- =============================================================================

-- Contract.customer: Cascade → Restrict
ALTER TABLE "contracts"
  DROP CONSTRAINT "contracts_customer_id_fkey",
  ADD CONSTRAINT "contracts_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ContractInvoice.contract: Cascade → Restrict
ALTER TABLE "contract_invoices"
  DROP CONSTRAINT "contract_invoices_contract_id_fkey",
  ADD CONSTRAINT "contract_invoices_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- RadiusEvent.contract: Cascade → Restrict
ALTER TABLE "radius_events"
  DROP CONSTRAINT "radius_events_contract_id_fkey",
  ADD CONSTRAINT "radius_events_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ServiceOrder.contract: Cascade → Restrict
ALTER TABLE "service_orders"
  DROP CONSTRAINT "service_orders_contract_id_fkey",
  ADD CONSTRAINT "service_orders_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- OneTimeCharge.customer: Cascade → Restrict
ALTER TABLE "one_time_charges"
  DROP CONSTRAINT "one_time_charges_customer_id_fkey",
  ADD CONSTRAINT "one_time_charges_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
