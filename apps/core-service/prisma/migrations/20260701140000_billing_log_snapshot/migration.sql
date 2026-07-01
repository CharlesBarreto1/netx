-- Snapshot legível no log de disparo de cobrança (histórico: cliente + número).
ALTER TABLE "billing_reminder_logs" ADD COLUMN "customer_name" VARCHAR(200);
ALTER TABLE "billing_reminder_logs" ADD COLUMN "sent_to" VARCHAR(20);
ALTER TABLE "billing_reminder_logs" ADD COLUMN "invoice_ref" VARCHAR(120);
