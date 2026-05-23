-- Plan.blockAfterDays: dias após o vencimento até suspender por inadimplência.
-- Default 5 = comportamento histórico hardcoded em OverdueScan.GRACE_DAYS.
-- Contract.blockAfterDays (próxima migration) sobrescreve por contrato.
ALTER TABLE "plans"
  ADD COLUMN "block_after_days" INTEGER NOT NULL DEFAULT 5;
