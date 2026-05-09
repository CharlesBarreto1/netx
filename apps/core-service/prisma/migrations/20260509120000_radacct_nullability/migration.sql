-- =============================================================================
-- Migração: corrigir colunas radacct que estavam NOT NULL erroneamente.
--
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Bug original: o schema radius v1 (carregado via SQL bruto, fora do Prisma)
-- criou várias colunas de `radius.radacct` como NOT NULL DEFAULT '', mas o
-- FreeRADIUS padrão envia NULL explícito no INSERT do Accounting-Start (não
-- confia em DEFAULT da coluna), causando:
--
--   ERROR: null value in column "acctterminatecause" of relation "radacct"
--          violates not-null constraint
--
-- Resultado: NENHUMA sessão era gravada → frontend sempre offline.
--
-- Idempotente: pode rodar várias vezes sem dano (DROP NOT NULL e DROP DEFAULT
-- não falham se já estão nesse estado).
-- =============================================================================

ALTER TABLE radius.radacct
    ALTER COLUMN acctterminatecause DROP NOT NULL,
    ALTER COLUMN acctterminatecause DROP DEFAULT;

ALTER TABLE radius.radacct
    ALTER COLUMN calledstationid DROP NOT NULL,
    ALTER COLUMN calledstationid DROP DEFAULT;

ALTER TABLE radius.radacct
    ALTER COLUMN callingstationid DROP NOT NULL,
    ALTER COLUMN callingstationid DROP DEFAULT;

ALTER TABLE radius.radacct
    ALTER COLUMN groupname DROP NOT NULL,
    ALTER COLUMN groupname DROP DEFAULT;

-- realm já é nullable, só limpa DEFAULT '' para consistência
ALTER TABLE radius.radacct
    ALTER COLUMN realm DROP DEFAULT;
