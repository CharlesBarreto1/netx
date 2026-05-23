-- Contract: paymentMode (POSTPAID|PREPAID), blockAfterDays override,
-- prepaidUntil (PREPAID: data até onde está pago), cycleAnchorDay (PREPAID:
-- dia do mês do ciclo, clamp 28/fev).
-- CREATE TYPE pode coabitar com ALTER TABLE que usa o tipo novo (Postgres
-- permite na mesma migration). ALTER TYPE ADD VALUE é que exigiria migration
-- separada — não é o caso aqui.

CREATE TYPE "PaymentMode" AS ENUM ('POSTPAID', 'PREPAID');

ALTER TABLE "contracts"
  ADD COLUMN "payment_mode"     "PaymentMode" NOT NULL DEFAULT 'POSTPAID',
  ADD COLUMN "block_after_days" INTEGER       NULL,
  ADD COLUMN "prepaid_until"    TIMESTAMP(3)  NULL,
  ADD COLUMN "cycle_anchor_day" INTEGER       NULL;

CREATE INDEX IF NOT EXISTS "contracts_tenant_id_payment_mode_idx"
  ON "contracts"("tenant_id", "payment_mode");
CREATE INDEX IF NOT EXISTS "contracts_tenant_id_prepaid_until_idx"
  ON "contracts"("tenant_id", "prepaid_until");
