-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BlockMode" AS ENUM ('UI_ONLY', 'UI_AND_PROVISIONING');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WikiAudience" AS ENUM ('INTERNAL', 'CLIENT');

-- CreateTable
CREATE TABLE "licensees" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "tax_id_type" TEXT,
    "contact_email" TEXT,
    "phone" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "plan" TEXT NOT NULL DEFAULT 'per-contract',
    "max_contracts" INTEGER NOT NULL DEFAULT 0,
    "price_per_contract_cents" INTEGER NOT NULL DEFAULT 0,
    "billing_day" INTEGER NOT NULL DEFAULT 10,
    "billing_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licensees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_articles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Geral',
    "audience" "WikiAudience" NOT NULL DEFAULT 'INTERNAL',
    "content" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "updated_by_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wiki_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_users" (
    "id" TEXT NOT NULL,
    "licensee_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "licensee_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "active_contracts" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "paid_amount_cents" INTEGER,
    "payment_method" TEXT,
    "payment_ref" TEXT,
    "proof_storage_key" TEXT,
    "pix_txid" TEXT,
    "pix_copia_e_cola" TEXT,
    "pix_qr_image" TEXT,
    "pix_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_unlocks" (
    "id" TEXT NOT NULL,
    "licensee_id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "granted_until" TIMESTAMP(3) NOT NULL,
    "granted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instances" (
    "id" TEXT NOT NULL,
    "licensee_id" TEXT NOT NULL,
    "label" TEXT,
    "key_hash" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "block_mode" "BlockMode" NOT NULL DEFAULT 'UI_ONLY',
    "last_version" TEXT,
    "last_active_contracts" INTEGER,
    "last_heartbeat_at" TIMESTAMP(3),
    "last_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heartbeat_logs" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "version" TEXT,
    "active_contracts" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "heartbeat_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wiki_articles_slug_key" ON "wiki_articles"("slug");

-- CreateIndex
CREATE INDEX "wiki_articles_audience_category_order_index_idx" ON "wiki_articles"("audience", "category", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "hub_admins_email_key" ON "hub_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "hub_users_email_key" ON "hub_users"("email");

-- CreateIndex
CREATE INDEX "hub_users_licensee_id_idx" ON "hub_users"("licensee_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_pix_txid_key" ON "invoices"("pix_txid");

-- CreateIndex
CREATE INDEX "invoices_licensee_id_status_idx" ON "invoices"("licensee_id", "status");

-- CreateIndex
CREATE INDEX "invoices_status_due_date_idx" ON "invoices"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_licensee_id_period_start_key" ON "invoices"("licensee_id", "period_start");

-- CreateIndex
CREATE INDEX "trust_unlocks_licensee_id_granted_until_idx" ON "trust_unlocks"("licensee_id", "granted_until");

-- CreateIndex
CREATE INDEX "trust_unlocks_invoice_id_idx" ON "trust_unlocks"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "instances_key_hash_key" ON "instances"("key_hash");

-- CreateIndex
CREATE INDEX "instances_licensee_id_idx" ON "instances"("licensee_id");

-- CreateIndex
CREATE INDEX "instances_status_idx" ON "instances"("status");

-- CreateIndex
CREATE INDEX "heartbeat_logs_instance_id_created_at_idx" ON "heartbeat_logs"("instance_id", "created_at");

-- AddForeignKey
ALTER TABLE "hub_users" ADD CONSTRAINT "hub_users_licensee_id_fkey" FOREIGN KEY ("licensee_id") REFERENCES "licensees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_licensee_id_fkey" FOREIGN KEY ("licensee_id") REFERENCES "licensees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_unlocks" ADD CONSTRAINT "trust_unlocks_licensee_id_fkey" FOREIGN KEY ("licensee_id") REFERENCES "licensees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_unlocks" ADD CONSTRAINT "trust_unlocks_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instances" ADD CONSTRAINT "instances_licensee_id_fkey" FOREIGN KEY ("licensee_id") REFERENCES "licensees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heartbeat_logs" ADD CONSTRAINT "heartbeat_logs_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

