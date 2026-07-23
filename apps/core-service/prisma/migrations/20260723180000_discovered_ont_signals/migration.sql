-- Reconciliação da ONT por SINAIS. No Hubsoft a mesma ONT aparece fragmentada em
-- 3 lugares independentes (serviço/provisionamento, comodato/estoque, CPE/ACS)
-- que ele não reconcilia — daí erros humanos (formato hex vs amigável, vínculo
-- faltando, cancelado num e ativo noutro). O NetX cadastra a ONT uma vez e cruza
-- esses sinais para achar o dono correto, com tolerância (não quebra por regra
-- rígida): concordam→alta confiança; só um aponta→casa com aviso; divergem→
-- escolhe por prioridade (SERVICO>COMODATO>CPE) e registra o conflito.

-- Novos estados de reconciliação.
ALTER TYPE "DiscoveredOntMatchState" ADD VALUE IF NOT EXISTS 'CONFLICT';
ALTER TYPE "DiscoveredOntMatchState" ADD VALUE IF NOT EXISTS 'CANCELLED_OWNER';

-- Fonte de um sinal de dono.
CREATE TYPE "DiscoveredOntSignalSource" AS ENUM ('OLT', 'SERVICO', 'COMODATO', 'CPE');

CREATE TABLE "discovered_ont_signals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "discovered_ont_id" UUID NOT NULL,
    "source" "DiscoveredOntSignalSource" NOT NULL,
    "raw_serial" VARCHAR(64),
    "matched_key" VARCHAR(64),
    "mac_address" VARCHAR(17),
    "erp_customer_code" VARCHAR(64),
    "erp_service_id" VARCHAR(64),
    "owner_status" VARCHAR(32),
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "detail" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovered_ont_signals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discovered_ont_signals_ont_source_service_key"
    ON "discovered_ont_signals"("discovered_ont_id", "source", "erp_service_id");
CREATE INDEX "discovered_ont_signals_tenant_customer_idx"
    ON "discovered_ont_signals"("tenant_id", "erp_customer_code");

ALTER TABLE "discovered_ont_signals"
    ADD CONSTRAINT "discovered_ont_signals_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discovered_ont_signals"
    ADD CONSTRAINT "discovered_ont_signals_discovered_ont_id_fkey" FOREIGN KEY ("discovered_ont_id")
    REFERENCES "discovered_onts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
