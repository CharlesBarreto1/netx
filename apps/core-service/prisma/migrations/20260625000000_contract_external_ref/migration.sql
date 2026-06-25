-- Contract.externalRef — chave estável do sistema de origem na migração
-- (ex.: Hubsoft "HS-SVC-<id_cliente_servico>"). Permite que o NÚMERO do
-- contrato (code) use o código do cliente (2561, 2561-1, ...) sem perder a
-- identidade do serviço para idempotência e vínculo das faturas.

ALTER TABLE "contracts" ADD COLUMN "external_ref" VARCHAR(64);

CREATE INDEX "contracts_tenant_id_external_ref_idx" ON "contracts"("tenant_id", "external_ref");
