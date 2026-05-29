-- =============================================================================
-- Frota — novo valor no enum CashMovementSource (despesa de frota)
-- =============================================================================
-- ALTER TYPE ... ADD VALUE precisa ficar em migration SEPARADA das que criam
-- tabelas usando o valor (regra Postgres). Aqui só adicionamos o valor; as
-- tabelas da frota vêm na migration seguinte (20260528010000_fleet_module).
-- IF NOT EXISTS torna idempotente em re-runs.
-- =============================================================================

ALTER TYPE "CashMovementSource" ADD VALUE IF NOT EXISTS 'FLEET_EXPENSE';
