-- Contas a pagar — parcela de pagamento a fornecedor, gerada pelo lançamento
-- de compra de estoque (à vista = 1 parcela já paga; a prazo = N parcelas).
-- A baixa registra CashMovement OUTCOME (source SUPPLIER_PAYABLE).
-- "Vencida" é derivada: status OPEN + due_date < hoje (sem cron de status).

CREATE TYPE "PayableStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

CREATE TABLE "supplier_payables" (
    "id"                 UUID NOT NULL,
    "tenant_id"          UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "supplier_id"        UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
    "purchase_id"        UUID REFERENCES "purchases"("id") ON DELETE CASCADE,
    "description"        VARCHAR(500),
    "installment_number" INTEGER NOT NULL DEFAULT 1,
    "installment_count"  INTEGER NOT NULL DEFAULT 1,
    "amount"             DECIMAL(14,4) NOT NULL,
    "due_date"           TIMESTAMP(3) NOT NULL,
    "status"             "PayableStatus" NOT NULL DEFAULT 'OPEN',

    "paid_at"            TIMESTAMP(3),
    "paid_amount"        DECIMAL(14,4),
    "paid_via"           "PaymentMethod",
    "cash_register_id"   UUID REFERENCES "cash_registers"("id") ON DELETE RESTRICT,
    "cash_movement_id"   UUID,
    "payment_note"       VARCHAR(500),

    "created_by_id"      UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payables_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supplier_payables_tenant_id_status_due_date_idx"
    ON "supplier_payables" ("tenant_id", "status", "due_date");
CREATE INDEX IF NOT EXISTS "supplier_payables_tenant_id_due_date_idx"
    ON "supplier_payables" ("tenant_id", "due_date");
CREATE INDEX IF NOT EXISTS "supplier_payables_supplier_id_idx"
    ON "supplier_payables" ("supplier_id");
CREATE INDEX IF NOT EXISTS "supplier_payables_purchase_id_idx"
    ON "supplier_payables" ("purchase_id");
