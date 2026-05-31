-- EFI / EfiPay — pagamentos BR (Pix imediato + boleto híbrido com Pix "Bolix").

-- CreateEnum
CREATE TYPE "EfiEnvironment" AS ENUM ('PRODUCTION', 'SANDBOX');
CREATE TYPE "EfiChargeKind" AS ENUM ('PIX', 'BOLIX');
CREATE TYPE "EfiChargeStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAID', 'CANCELED', 'ERROR');

-- CreateTable
CREATE TABLE "efi_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "environment" "EfiEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "credentials_enc" TEXT,
    "certificate_enc" TEXT,
    "certificate_pass_enc" TEXT,
    "pix_key" VARCHAR(140),
    "default_charge_kind" "EfiChargeKind" NOT NULL DEFAULT 'BOLIX',
    "expiration_days" INTEGER NOT NULL DEFAULT 3,
    "auto_generate" BOOLEAN NOT NULL DEFAULT false,
    "fine_percent" DECIMAL(5,2),
    "interest_percent" DECIMAL(5,2),
    "webhook_token" VARCHAR(64),
    "pix_webhook_registered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "efi_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efi_charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" "EfiChargeKind" NOT NULL,
    "status" "EfiChargeStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "txid" VARCHAR(64),
    "efi_charge_id" VARCHAR(40),
    "loc_id" VARCHAR(40),
    "pix_copia_e_cola" TEXT,
    "pix_qr_image" TEXT,
    "barcode" VARCHAR(64),
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

    CONSTRAINT "efi_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "efi_configs_tenant_id_key" ON "efi_configs"("tenant_id");
CREATE UNIQUE INDEX "efi_charges_txid_key" ON "efi_charges"("txid");
CREATE INDEX "efi_charges_tenant_id_status_idx" ON "efi_charges"("tenant_id", "status");
CREATE INDEX "efi_charges_tenant_id_invoice_id_idx" ON "efi_charges"("tenant_id", "invoice_id");
CREATE INDEX "efi_charges_efi_charge_id_idx" ON "efi_charges"("efi_charge_id");

-- AddForeignKey
ALTER TABLE "efi_configs" ADD CONSTRAINT "efi_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "efi_charges" ADD CONSTRAINT "efi_charges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "efi_charges" ADD CONSTRAINT "efi_charges_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "contract_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
