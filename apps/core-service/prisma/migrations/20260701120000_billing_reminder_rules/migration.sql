-- Régua de cobrança configurável por tenant (múltiplos disparos + canal).
CREATE TABLE "billing_reminder_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "test_recipient" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_reminder_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_reminder_configs_tenant_id_key"
    ON "billing_reminder_configs"("tenant_id");

CREATE TABLE "billing_reminder_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "label" VARCHAR(120),
    "offset_days" INTEGER NOT NULL,
    "channel" VARCHAR(30) NOT NULL DEFAULT 'WHATSAPP_META',
    "template_name" VARCHAR(120) NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'pt_BR',
    "instance_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_reminder_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_reminder_rules_tenant_id_enabled_idx"
    ON "billing_reminder_rules"("tenant_id", "enabled");

CREATE TABLE "billing_reminder_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "channel" VARCHAR(30) NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "error" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_reminder_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_reminder_logs_rule_id_invoice_id_key"
    ON "billing_reminder_logs"("rule_id", "invoice_id");

CREATE INDEX "billing_reminder_logs_tenant_id_sent_at_idx"
    ON "billing_reminder_logs"("tenant_id", "sent_at");

ALTER TABLE "billing_reminder_configs"
    ADD CONSTRAINT "billing_reminder_configs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_reminder_rules"
    ADD CONSTRAINT "billing_reminder_rules_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_reminder_logs"
    ADD CONSTRAINT "billing_reminder_logs_rule_id_fkey"
    FOREIGN KEY ("rule_id") REFERENCES "billing_reminder_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
