-- =============================================================================
-- RH — novo valor no enum CashMovementSource (pagamento de salário/holerite)
-- =============================================================================
-- ALTER TYPE ... ADD VALUE precisa ficar em migration SEPARADA das que criam
-- tabelas usando o valor (regra Postgres). Aqui só adicionamos o valor; as
-- tabelas do RH vêm na migration seguinte (20260531010000_hr_module).
-- IF NOT EXISTS torna idempotente em re-runs.
-- =============================================================================

ALTER TYPE "CashMovementSource" ADD VALUE IF NOT EXISTS 'PAYROLL';
