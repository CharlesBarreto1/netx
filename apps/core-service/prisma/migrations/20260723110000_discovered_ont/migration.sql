-- DiscoveredOnt — staging da descoberta de ONUs na OLT (NetX como integrador
-- técnico). O NetX varre a OLT (ex.: Fiberhome AN5516 via telnet,
-- `show authorization slot all pon all`) e grava cada ONU crua aqui ANTES de
-- casar com o ERP (Hubsoft, por MAC) e materializar em Ont/Contract.
--
-- POR QUE STAGING SEPARADO: descoberta e materialização rodam em camadas
-- independentes e retomáveis (varredura de OLT de produção é lenta e gentil);
-- dá pra auditar o que foi descoberto antes de criar contrato ou tocar no
-- RADIUS; e o casamento com o ERP pode falhar/ficar ambíguo sem sujar a Ont
-- "de verdade".

CREATE TYPE "DiscoveredOntMatchState" AS ENUM (
    'DISCOVERED',
    'MATCHED',
    'UNMATCHED',
    'AMBIGUOUS',
    'MATERIALIZED',
    'IGNORED'
);

CREATE TABLE "discovered_onts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "olt_id" UUID NOT NULL,
    "serial" VARCHAR(64) NOT NULL,
    "slot" INTEGER NOT NULL,
    "pon" INTEGER NOT NULL,
    "onu_index" INTEGER NOT NULL,
    "model" VARCHAR(64),
    "onu_state" VARCHAR(32),
    "mac_address" VARCHAR(17),
    "vlan" INTEGER,
    "match_state" "DiscoveredOntMatchState" NOT NULL DEFAULT 'DISCOVERED',
    "erp_source" VARCHAR(16),
    "erp_customer_code" VARCHAR(64),
    "erp_service_id" VARCHAR(64),
    "contract_id" UUID,
    "match_note" VARCHAR(500),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovered_onts_pkey" PRIMARY KEY ("id")
);

-- Idempotência da varredura: uma ONU (serial) por OLT.
CREATE UNIQUE INDEX "discovered_onts_olt_id_serial_key" ON "discovered_onts"("olt_id", "serial");
CREATE INDEX "discovered_onts_tenant_id_match_state_idx" ON "discovered_onts"("tenant_id", "match_state");
CREATE INDEX "discovered_onts_tenant_id_mac_address_idx" ON "discovered_onts"("tenant_id", "mac_address");
CREATE INDEX "discovered_onts_olt_id_slot_pon_idx" ON "discovered_onts"("olt_id", "slot", "pon");

ALTER TABLE "discovered_onts"
    ADD CONSTRAINT "discovered_onts_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discovered_onts"
    ADD CONSTRAINT "discovered_onts_olt_id_fkey" FOREIGN KEY ("olt_id")
    REFERENCES "olts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
