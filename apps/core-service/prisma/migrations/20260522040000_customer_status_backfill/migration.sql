-- =============================================================================
-- Customer.status — backfill baseado nos contratos atuais
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Aplica a regra de auto-status (modules/contracts/customer-status.ts):
--   Sem contrato                          → PROSPECT
--   Algum contrato PENDING_INSTALL        → INACTIVE
--   Algum contrato ACTIVE                 → ACTIVE
--   Algum contrato SUSPENDED              → SUSPENDED
--   Só contratos CANCELLED                → CHURNED
--
-- Ordem do CASE segue a hierarquia (ACTIVE > SUSPENDED > INACTIVE > CHURNED >
-- PROSPECT). Daqui pra frente o backend mantém via recalcCustomerStatus em
-- todo ponto que mexe em contract.status.
-- =============================================================================

UPDATE "customers" c
   SET status = (
     CASE
       WHEN EXISTS (
         SELECT 1 FROM "contracts" k
          WHERE k.customer_id = c.id
            AND k.deleted_at IS NULL
            AND k.status = 'ACTIVE'
       ) THEN 'ACTIVE'::"CustomerStatus"
       WHEN EXISTS (
         SELECT 1 FROM "contracts" k
          WHERE k.customer_id = c.id
            AND k.deleted_at IS NULL
            AND k.status = 'SUSPENDED'
       ) THEN 'SUSPENDED'::"CustomerStatus"
       WHEN EXISTS (
         SELECT 1 FROM "contracts" k
          WHERE k.customer_id = c.id
            AND k.deleted_at IS NULL
            AND k.status = 'PENDING_INSTALL'
       ) THEN 'INACTIVE'::"CustomerStatus"
       WHEN EXISTS (
         SELECT 1 FROM "contracts" k
          WHERE k.customer_id = c.id
            AND k.deleted_at IS NULL
       ) THEN 'CHURNED'::"CustomerStatus"
       ELSE 'PROSPECT'::"CustomerStatus"
     END
   )
 WHERE c.deleted_at IS NULL;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT status, count(*) AS n
      FROM customers
     WHERE deleted_at IS NULL
     GROUP BY status
     ORDER BY status
  LOOP
    RAISE NOTICE 'customer status %: %', r.status, r.n;
  END LOOP;
END $$;
