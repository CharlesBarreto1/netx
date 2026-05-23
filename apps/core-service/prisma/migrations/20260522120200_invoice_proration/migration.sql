-- ContractInvoice: kind (REGULAR|INITIAL|PRORATION|CREDIT) + period_start/end.
-- kind separa fatura recorrente de ajustes (proporcional, crédito de troca).
-- period_start/end documentam o range coberto pela fatura — essencial pra
-- auditoria e disputa de cobrança proporcional. Default REGULAR mantém
-- compat com faturas já criadas.

CREATE TYPE "InvoiceKind" AS ENUM ('REGULAR', 'INITIAL', 'PRORATION', 'CREDIT');

ALTER TABLE "contract_invoices"
  ADD COLUMN "kind"         "InvoiceKind" NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN "period_start" DATE          NULL,
  ADD COLUMN "period_end"   DATE          NULL;
