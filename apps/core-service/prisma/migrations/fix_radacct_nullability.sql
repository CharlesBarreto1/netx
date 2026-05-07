-- =============================================================================
-- Migração: corrigir colunas radacct que estavam NOT NULL erroneamente.
--
-- Bug: o schema original (radius-schema.sql v1) criou várias colunas como
-- NOT NULL DEFAULT '', mas o FreeRADIUS padrão envia NULL explícito no
-- INSERT do Accounting-Start (não confia em DEFAULT da coluna), causando:
--
--   ERROR: null value in column "acctterminatecause" of relation "radacct"
--          violates not-null constraint
--
-- Resultado: NENHUMA sessão era gravada → frontend sempre offline.
--
-- Idempotente: pode rodar várias vezes sem dano.
--
-- Uso:
--   psql "$DATABASE_URL" -f apps/core-service/prisma/migrations/fix_radacct_nullability.sql
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

-- realm já é nullable, mas tinha DEFAULT '' — limpa pra ficar consistente
ALTER TABLE radius.radacct
    ALTER COLUMN realm DROP DEFAULT;

-- Sanity: mostra colunas e nullability
DO $$
DECLARE
  r RECORD;
BEGIN
  RAISE NOTICE 'radacct columns após migração:';
  FOR r IN
    SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'radius' AND table_name = 'radacct'
     ORDER BY ordinal_position
  LOOP
    RAISE NOTICE '  % | nullable=% | default=%',
      rpad(r.column_name, 22), r.is_nullable, COALESCE(r.column_default, 'NULL');
  END LOOP;
END $$;
