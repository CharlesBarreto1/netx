-- =============================================================================
-- NetX — Auditoria de troca de ONT inconsistente  (READ-ONLY, não altera nada)
-- =============================================================================
-- Detecta contratos onde a ONT PROVISIONADA (onts.sn_gpon + tr069_devices) diverge
-- da ONT realmente em COMODATO (serial_items ALLOCATED). É o sintoma da troca
-- feita pelo caminho errado: devolver a ONT pelo card de comodato e alocar outra,
-- SEM passar pelo swapOnt — então onts/tr069_devices continuam no equipamento antigo.
--
-- Como rodar na VPS:
--   sudo -u postgres psql netx_app -f /opt/netx/infra/installer/scripts/audit/ont-swap-audit.sql
-- Ou colar este conteúdo direto no psql.
--
-- O elo Ont↔SerialItem é só o serial (onts.sn_gpon == serial_items.serial); não há
-- FK. Por isso a auditoria casa por serial (case-insensitive).
-- =============================================================================

\echo ''
\echo '############################################################'
\echo '# (1) RESUMO — quantos contratos com Ont sem comodato igual #'
\echo '############################################################'
SELECT count(*) AS contratos_suspeitos
FROM onts o
JOIN contracts c ON c.id = o.contract_id AND c.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM serial_items si
   WHERE si.contract_id = c.id
     AND si.status = 'ALLOCATED'
     AND lower(si.serial) = lower(o.sn_gpon)
);

\echo ''
\echo '##################################################################'
\echo '# (2) ALTA CONFIANCA — ONT provisionada devolvida + outra alocada #'
\echo '#     (a Ont/Tr069Device ainda apontam pro equipamento ANTIGO)   #'
\echo '##################################################################'
-- Condições: o serial provisionado existe no estoque mas NÃO está mais ALLOCATED
-- neste contrato (foi devolvido), E há outra ONT ALLOCATED no contrato (a nova).
SELECT DISTINCT
  c.code            AS contrato,
  c.status          AS contrato_status,
  o.tenant_id       AS tenant_id,
  o.sn_gpon         AS sn_provisionado_antigo,
  old.status        AS antigo_no_estoque,
  alloc.serial      AS sn_em_comodato_novo,
  d.device_id       AS tr069_device,
  d.status          AS tr069_status,
  d.last_inform_at  AS tr069_ultimo_inform,
  c.id              AS contract_id,
  o.id              AS ont_id
FROM onts o
JOIN contracts c        ON c.id = o.contract_id AND c.deleted_at IS NULL
JOIN serial_items old   ON old.tenant_id = o.tenant_id
                       AND lower(old.serial) = lower(o.sn_gpon)
                       AND NOT (old.contract_id = c.id AND old.status = 'ALLOCATED')
JOIN serial_items alloc ON alloc.contract_id = c.id
                       AND alloc.status = 'ALLOCATED'
                       AND lower(alloc.serial) <> lower(o.sn_gpon)
LEFT JOIN tr069_devices d ON d.ont_id = o.id
ORDER BY c.code;

\echo ''
\echo '##################################################################'
\echo '# (3) A INVESTIGAR — Ont sem comodato e sem serial antigo no estoque'
\echo '#     (provavelmente instalacao via bypass; NAO e troca errada)   #'
\echo '##################################################################'
SELECT
  c.code            AS contrato,
  c.status          AS contrato_status,
  o.tenant_id       AS tenant_id,
  o.sn_gpon         AS sn_provisionado,
  o.status          AS ont_status,
  d.device_id       AS tr069_device,
  d.status          AS tr069_status,
  c.id              AS contract_id
FROM onts o
JOIN contracts c          ON c.id = o.contract_id AND c.deleted_at IS NULL
LEFT JOIN tr069_devices d ON d.ont_id = o.id
WHERE NOT EXISTS (
  SELECT 1 FROM serial_items si
   WHERE si.contract_id = c.id AND si.status = 'ALLOCATED'
     AND lower(si.serial) = lower(o.sn_gpon)
)
AND NOT EXISTS (
  SELECT 1 FROM serial_items old
   WHERE old.tenant_id = o.tenant_id AND lower(old.serial) = lower(o.sn_gpon)
)
ORDER BY c.code;

\echo ''
\echo '##################################################################'
\echo '# (4) Tr069 devices ORFAOS (ont_id nulo) — ONT informou sem vinculo'
\echo '#     Costuma ser a ONT NOVA que ligou e o ACS nao achou a Ont.   #'
\echo '##################################################################'
SELECT
  d.tenant_id,
  d.device_id,
  d.status,
  d.last_inform_at
FROM tr069_devices d
WHERE d.ont_id IS NULL
ORDER BY d.last_inform_at DESC NULLS LAST;

\echo ''
\echo '=== fim da auditoria (nada foi alterado) ==='
