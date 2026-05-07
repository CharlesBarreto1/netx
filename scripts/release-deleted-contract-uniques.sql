-- =============================================================================
-- One-shot: libera uniques de contratos soft-deletados existentes.
--
-- Bug histórico: contratos com `deleted_at IS NOT NULL` continuavam ocupando
-- pppoe_username, circuit_id, mac_address e code, impedindo recriação com o
-- mesmo identificador. A partir de hoje o `remove()` no service sufixa
-- automaticamente, mas dados antigos precisam dessa migração.
--
-- Idempotente: se já tem o sufixo `__del_`, pula.
--
-- Uso:
--   PGPASSWORD='...' psql -h localhost -U netx -d netx \
--     -f scripts/release-deleted-contract-uniques.sql
-- =============================================================================
BEGIN;

UPDATE contracts
SET pppoe_username = LEFT(pppoe_username || '__del_' || EXTRACT(EPOCH FROM deleted_at)::bigint::text, 64)
WHERE deleted_at IS NOT NULL
  AND pppoe_username IS NOT NULL
  AND pppoe_username NOT LIKE '%\_\_del\_%' ESCAPE '\';

UPDATE contracts
SET circuit_id = LEFT(circuit_id || '__del_' || EXTRACT(EPOCH FROM deleted_at)::bigint::text, 128)
WHERE deleted_at IS NOT NULL
  AND circuit_id IS NOT NULL
  AND circuit_id NOT LIKE '%\_\_del\_%' ESCAPE '\';

UPDATE contracts
SET mac_address = LEFT(mac_address || '__del_' || EXTRACT(EPOCH FROM deleted_at)::bigint::text, 32)
WHERE deleted_at IS NOT NULL
  AND mac_address IS NOT NULL
  AND mac_address NOT LIKE '%\_\_del\_%' ESCAPE '\';

UPDATE contracts
SET code = LEFT(code || '__del_' || EXTRACT(EPOCH FROM deleted_at)::bigint::text, 32)
WHERE deleted_at IS NOT NULL
  AND code IS NOT NULL
  AND code NOT LIKE '%\_\_del\_%' ESCAPE '\';

SELECT count(*) AS contratos_liberados FROM contracts WHERE deleted_at IS NOT NULL;

COMMIT;
