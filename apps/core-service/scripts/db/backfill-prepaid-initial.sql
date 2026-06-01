-- =============================================================================
-- Backfill da fatura INITIAL pra contratos PREPAID ativados ANTES do fix
-- (installCustomer não gerava a inicial → prepaid_until ficou null → o cron
--  pulava o contrato pra sempre). Gera a INITIAL + inicializa prepaid_until /
--  cycle_anchor_day, replicando InvoiceGeneratorService.generateInitialInvoice.
--
-- SEGURO: idempotente (só cria se não houver INITIAL), restrito aos códigos
-- listados, e só toca PREPAID + ACTIVE. Roda dentro de transação — confira a
-- contagem antes do COMMIT.
--
-- Uso no servidor (ajuste user/db conforme o .env):
--   sudo -u postgres psql -d netx -v codes="'ZUX-1','ZUX-6','ZUX-7'" \
--        -f apps/core-service/scripts/db/backfill-prepaid-initial.sql
-- (ou cole o conteúdo num psql e troque a lista em :codes)
-- =============================================================================

BEGIN;

-- Pré-visualização: o que SERÁ inserido (rode antes; aborta nada).
SELECT
  c.code,
  c.monthly_value,
  date_trunc('day', c.activated_at AT TIME ZONE 'UTC')::date            AS due,
  (date_trunc('day', c.activated_at AT TIME ZONE 'UTC')::date
     + interval '1 month')::date                                        AS period_end
FROM contracts c
WHERE c.code IN (:codes)
  AND c.payment_mode = 'PREPAID'
  AND c.status = 'ACTIVE'
  AND c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM contract_invoices ci
    WHERE ci.contract_id = c.id AND ci.kind = 'INITIAL'
  );

-- 1) Cria a fatura INITIAL (OPEN, vencendo na data de ativação).
INSERT INTO contract_invoices
  (id, tenant_id, contract_id, amount, due_date, issued_at, kind,
   period_start, period_end, status, reference, created_at, updated_at)
SELECT
  gen_random_uuid(),
  c.tenant_id,
  c.id,
  c.monthly_value,
  date_trunc('day', c.activated_at AT TIME ZONE 'UTC')::date,
  now(),
  'INITIAL',
  date_trunc('day', c.activated_at AT TIME ZONE 'UTC')::date,
  (date_trunc('day', c.activated_at AT TIME ZONE 'UTC')::date + interval '1 month')::date,
  'OPEN',
  -- InvoiceReference.initialPrepaid → "Pré-pago DD/MM/AAAA"
  'Pré-pago ' || to_char(date_trunc('day', c.activated_at AT TIME ZONE 'UTC')::date, 'DD/MM/YYYY'),
  now(),
  now()
FROM contracts c
WHERE c.code IN (:codes)
  AND c.payment_mode = 'PREPAID'
  AND c.status = 'ACTIVE'
  AND c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM contract_invoices ci
    WHERE ci.contract_id = c.id AND ci.kind = 'INITIAL'
  );

-- 2) Inicializa prepaid_until (= period_end) e cycle_anchor_day (= dia da ativação).
UPDATE contracts c
SET
  prepaid_until = (date_trunc('day', c.activated_at AT TIME ZONE 'UTC')::date + interval '1 month')::date,
  cycle_anchor_day = EXTRACT(DAY FROM date_trunc('day', c.activated_at AT TIME ZONE 'UTC')::date)::int,
  updated_at = now()
WHERE c.code IN (:codes)
  AND c.payment_mode = 'PREPAID'
  AND c.status = 'ACTIVE'
  AND c.deleted_at IS NULL
  AND c.prepaid_until IS NULL;

-- Confirmação: como ficaram.
SELECT c.code, c.prepaid_until, c.cycle_anchor_day,
       ci.due_date, ci.amount, ci.status, ci.reference
FROM contracts c
JOIN contract_invoices ci ON ci.contract_id = c.id AND ci.kind = 'INITIAL'
WHERE c.code IN (:codes);

-- Revise o resultado acima. Se estiver correto:
COMMIT;
-- Se algo estranho:  ROLLBACK;
