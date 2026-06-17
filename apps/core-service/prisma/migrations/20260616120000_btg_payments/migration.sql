-- BTG Pactual — pagamentos BR (boleto + Pix cobrança + Pix Automático).
-- Auth OAuth2 via BTG Id (Authorization Code → refresh_token cifrado).
-- Coexiste com EFI; cada tenant escolhe o gateway BR ativo.

-- CreateEnum
CREATE TYPE "BtgEnvironment" AS ENUM ('PRODUCTION', 'SANDBOX');
CREATE TYPE "BtgChargeKind" AS ENUM ('BOLETO', 'PIX');
CREATE TYPE "BtgChargeStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAID', 'CANCELED', 'ERROR');
CREATE TYPE "BtgRecurrenceStatus" AS ENUM ('PENDING', 'PROCESSING', 'CREATED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELED', 'FINISHED', 'ERROR');

-- CreateTable
CREATE TABLE "btg_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "environment" "BtgEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "credentials_enc" TEXT,
    "refresh_token_enc" TEXT,
    "redirect_uri" VARCHAR(500),
    "scopes" VARCHAR(500),
    "company_id" VARCHAR(20),
    "account_number" VARCHAR(20),
    "account_branch" VARCHAR(10),
    "authorized_at" TIMESTAMP(3),
    "authorized_by" UUID,
    "oauth_state" VARCHAR(128),
    "pix_key" VARCHAR(140),
    "default_charge_kind" "BtgChargeKind" NOT NULL DEFAULT 'BOLETO',
    "expiration_days" INTEGER NOT NULL DEFAULT 3,
    "auto_generate" BOOLEAN NOT NULL DEFAULT false,
    "fine_percent" DECIMAL(5,2),
    "interest_percent" DECIMAL(5,2),
    "webhook_token" VARCHAR(64),
    "webhook_secret_enc" TEXT,
    "webhook_id" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "btg_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "btg_charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" "BtgChargeKind" NOT NULL,
    "status" "BtgChargeStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "txid" VARCHAR(64),
    "btg_charge_id" VARCHAR(64),
    "pix_emv" TEXT,
    "pix_qr_image" TEXT,
    "barcode" VARCHAR(64),
    "digitable_line" VARCHAR(64),
    "pdf_url" VARCHAR(500),
    "payment_link" VARCHAR(500),
    "expires_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "paid_amount" DECIMAL(12,2),
    "end_to_end_id" VARCHAR(40),
    "last_error" TEXT,
    "last_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "btg_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "btg_recurrences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "status" "BtgRecurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "contract_ref" VARCHAR(35) NOT NULL,
    "authorization_id" VARCHAR(64),
    "period" VARCHAR(16) NOT NULL,
    "retry_policy" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(12,2),
    "minimum_amount" DECIMAL(12,2),
    "initial_date" TIMESTAMP(3) NOT NULL,
    "final_date" TIMESTAMP(3),
    "installments" INTEGER,
    "emv" TEXT,
    "qr_image" TEXT,
    "approved_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "btg_recurrences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "btg_configs_tenant_id_key" ON "btg_configs"("tenant_id");
CREATE UNIQUE INDEX "btg_charges_txid_key" ON "btg_charges"("txid");
CREATE INDEX "btg_charges_tenant_id_status_idx" ON "btg_charges"("tenant_id", "status");
CREATE INDEX "btg_charges_tenant_id_invoice_id_idx" ON "btg_charges"("tenant_id", "invoice_id");
CREATE INDEX "btg_charges_btg_charge_id_idx" ON "btg_charges"("btg_charge_id");
CREATE UNIQUE INDEX "btg_recurrences_tenant_id_contract_ref_key" ON "btg_recurrences"("tenant_id", "contract_ref");
CREATE INDEX "btg_recurrences_tenant_id_status_idx" ON "btg_recurrences"("tenant_id", "status");
CREATE INDEX "btg_recurrences_tenant_id_contract_id_idx" ON "btg_recurrences"("tenant_id", "contract_id");
CREATE INDEX "btg_recurrences_authorization_id_idx" ON "btg_recurrences"("authorization_id");

-- AddForeignKey
ALTER TABLE "btg_configs" ADD CONSTRAINT "btg_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "btg_charges" ADD CONSTRAINT "btg_charges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "btg_charges" ADD CONSTRAINT "btg_charges_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "contract_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "btg_recurrences" ADD CONSTRAINT "btg_recurrences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "btg_recurrences" ADD CONSTRAINT "btg_recurrences_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
