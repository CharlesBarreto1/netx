-- =============================================================================
-- SIFEN — fatura eletrônica Paraguay
-- =============================================================================
-- Veja docs/sifen-integration.md (TODO) e Manual Técnico v150 da DNIT.
--
-- Esta migração adiciona:
--   - 2 enums (SifenDocumentType, SifenDocumentStatus)
--   - 1 tabela (sifen_documents)
--   - 4 índices (status+date, type+date, FK invoice, FK charge, retry)
--   - 1 UNIQUE composto (tenant, estab, punto, numero) — numeração sem buraco

-- enums --------------------------------------------------------------------

CREATE TYPE "SifenDocumentType" AS ENUM (
    'FACTURA',
    'NOTA_CREDITO',
    'NOTA_DEBITO',
    'AUTOFACTURA',
    'NOTA_REMISION'
);

CREATE TYPE "SifenDocumentStatus" AS ENUM (
    'DRAFT',
    'SIGNED',
    'SENT',
    'APPROVED',
    'REJECTED',
    'CANCELLED'
);

-- tabela -------------------------------------------------------------------

CREATE TABLE "sifen_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_invoice_id" UUID,
    "one_time_charge_id" UUID,

    "type" "SifenDocumentType" NOT NULL,
    "status" "SifenDocumentStatus" NOT NULL DEFAULT 'DRAFT',

    "establecimiento" VARCHAR(3) NOT NULL,
    "punto_expedicion" VARCHAR(3) NOT NULL,
    "numero" INTEGER NOT NULL,

    "cdc" VARCHAR(44) NOT NULL,

    "emisor_ruc" VARCHAR(20) NOT NULL,
    "emisor_timbrado" VARCHAR(8) NOT NULL,
    "receptor_tax_id" VARCHAR(32),
    "receptor_name" VARCHAR(255),

    "total_amount" DECIMAL(14, 2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PYG',

    "xml_generated" TEXT,
    "xml_signed" TEXT,
    "xml_sent" TEXT,

    "sifen_response" JSONB,
    "rejection_code" VARCHAR(20),
    "rejection_reason" TEXT,
    "qr_url" TEXT,

    "issued_at" TIMESTAMP(3) NOT NULL,
    "signed_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_retry_at" TIMESTAMP(3),

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sifen_documents_pkey" PRIMARY KEY ("id")
);

-- índices ------------------------------------------------------------------

CREATE UNIQUE INDEX "sifen_documents_cdc_key" ON "sifen_documents"("cdc");

-- Numeração fiscal sem buraco
CREATE UNIQUE INDEX "sifen_doc_numero_uniq"
    ON "sifen_documents"("tenant_id", "establecimiento", "punto_expedicion", "numero");

CREATE INDEX "sifen_documents_tenant_id_status_issued_at_idx"
    ON "sifen_documents"("tenant_id", "status", "issued_at" DESC);

CREATE INDEX "sifen_documents_tenant_id_type_issued_at_idx"
    ON "sifen_documents"("tenant_id", "type", "issued_at" DESC);

CREATE INDEX "sifen_documents_contract_invoice_id_idx"
    ON "sifen_documents"("contract_invoice_id");

CREATE INDEX "sifen_documents_one_time_charge_id_idx"
    ON "sifen_documents"("one_time_charge_id");

CREATE INDEX "sifen_doc_retry_idx"
    ON "sifen_documents"("next_retry_at");

-- FKs ----------------------------------------------------------------------

ALTER TABLE "sifen_documents"
    ADD CONSTRAINT "sifen_documents_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sifen_documents"
    ADD CONSTRAINT "sifen_documents_contract_invoice_id_fkey"
    FOREIGN KEY ("contract_invoice_id") REFERENCES "contract_invoices"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sifen_documents"
    ADD CONSTRAINT "sifen_documents_one_time_charge_id_fkey"
    FOREIGN KEY ("one_time_charge_id") REFERENCES "one_time_charges"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
