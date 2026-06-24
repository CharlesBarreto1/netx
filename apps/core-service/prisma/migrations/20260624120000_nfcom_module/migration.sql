-- NFCom — Nota Fiscal Fatura de Serviço de Comunicação Eletrônica (modelo 62).
-- Documento fiscal BR para ISP; autorizador SVRS. Espinha espelha SifenDocument.
-- Transmissão ao Fisco fica atrás de porta plugável (1o adapter = agregador REST).
-- Módulo opcional, ligado por tenant via /settings/nfcom.

-- CreateEnum
CREATE TYPE "NfcomEnvironment" AS ENUM ('HOMOLOGACAO', 'PRODUCAO');
CREATE TYPE "NfcomTransmitter" AS ENUM ('NUVEM_FISCAL', 'FOCUS_NFE', 'SVRS_DIRECT');
CREATE TYPE "NfcomDocumentType" AS ENUM ('NFCOM', 'NFCOM_SUBSTITUICAO');
CREATE TYPE "NfcomDocumentStatus" AS ENUM ('DRAFT', 'SIGNED', 'SENT', 'AUTHORIZED', 'REJECTED', 'DENIED', 'CANCELLED');

-- CreateTable
CREATE TABLE "nfcom_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "environment" "NfcomEnvironment" NOT NULL DEFAULT 'HOMOLOGACAO',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "transmitter" "NfcomTransmitter" NOT NULL DEFAULT 'NUVEM_FISCAL',
    "credentials_enc" TEXT,
    "certificate_enc" TEXT,
    "certificate_password_enc" TEXT,
    "cnpj" VARCHAR(14) NOT NULL,
    "inscricao_estadual" VARCHAR(20),
    "razao_social" VARCHAR(255) NOT NULL,
    "nome_fantasia" VARCHAR(255),
    "crt" VARCHAR(1),
    "uf" VARCHAR(2) NOT NULL,
    "cod_municipio" VARCHAR(7),
    "end_logradouro" VARCHAR(60),
    "end_numero" VARCHAR(60),
    "end_complemento" VARCHAR(60),
    "end_bairro" VARCHAR(60),
    "end_municipio_nome" VARCHAR(60),
    "end_cep" VARCHAR(8),
    "fone" VARCHAR(12),
    "email" VARCHAR(255),
    "serie" VARCHAR(3) NOT NULL DEFAULT '1',
    "next_numero" INTEGER NOT NULL DEFAULT 1,
    "cst_icms" VARCHAR(3),
    "aliquota_icms" DECIMAL(5,2),
    "cfop" VARCHAR(4),
    "c_class" VARCHAR(7),
    "tp_serv" VARCHAR(2),
    "auto_generate" BOOLEAN NOT NULL DEFAULT false,
    "webhook_token" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfcom_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfcom_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_invoice_id" UUID,
    "one_time_charge_id" UUID,
    "type" "NfcomDocumentType" NOT NULL DEFAULT 'NFCOM',
    "status" "NfcomDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "serie" VARCHAR(3) NOT NULL,
    "numero" INTEGER NOT NULL,
    "chave_acesso" VARCHAR(44),
    "protocolo" VARCHAR(20),
    "transmitter_ref" VARCHAR(64),
    "emitente_cnpj" VARCHAR(14) NOT NULL,
    "receptor_tax_id" VARCHAR(20),
    "receptor_name" VARCHAR(255),
    "total_amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "cst_icms" VARCHAR(3),
    "aliquota_icms" DECIMAL(5,2),
    "base_calculo_icms" DECIMAL(14,2),
    "valor_icms" DECIMAL(14,2),
    "xml_generated" TEXT,
    "xml_signed" TEXT,
    "xml_authorized" TEXT,
    "danfe_url" VARCHAR(500),
    "qrcode_data" TEXT,
    "auth_response" JSONB,
    "rejection_code" VARCHAR(20),
    "rejection_reason" TEXT,
    "cancel_protocol" VARCHAR(20),
    "cancel_reason" TEXT,
    "substitutes_id" UUID,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "signed_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "authorized_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_retry_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfcom_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nfcom_configs_tenant_id_key" ON "nfcom_configs"("tenant_id");
CREATE UNIQUE INDEX "nfcom_documents_chave_acesso_key" ON "nfcom_documents"("chave_acesso");
CREATE UNIQUE INDEX "nfcom_doc_numero_uniq" ON "nfcom_documents"("tenant_id", "serie", "numero");
CREATE INDEX "nfcom_documents_tenant_id_status_issued_at_idx" ON "nfcom_documents"("tenant_id", "status", "issued_at" DESC);
CREATE INDEX "nfcom_documents_tenant_id_contract_invoice_id_idx" ON "nfcom_documents"("tenant_id", "contract_invoice_id");
CREATE INDEX "nfcom_doc_retry_idx" ON "nfcom_documents"("next_retry_at");

-- AddForeignKey
ALTER TABLE "nfcom_configs" ADD CONSTRAINT "nfcom_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfcom_documents" ADD CONSTRAINT "nfcom_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfcom_documents" ADD CONSTRAINT "nfcom_documents_contract_invoice_id_fkey" FOREIGN KEY ("contract_invoice_id") REFERENCES "contract_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nfcom_documents" ADD CONSTRAINT "nfcom_documents_one_time_charge_id_fkey" FOREIGN KEY ("one_time_charge_id") REFERENCES "one_time_charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nfcom_documents" ADD CONSTRAINT "nfcom_documents_substitutes_id_fkey" FOREIGN KEY ("substitutes_id") REFERENCES "nfcom_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
