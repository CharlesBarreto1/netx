#!/usr/bin/env bash
# =============================================================================
# netx-radius-check.sh — auditoria + reconciliação manual RADIUS
# =============================================================================
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
#
# Uso:
#   sudo netx-radius-check         # só inspeciona, não corrige
#   sudo netx-radius-check --fix   # força execução do reconciler (corrige)
#
# O que faz:
#   1. Compara `contracts` (fonte) com `radius.radcheck`/`radusergroup` (aplicado)
#   2. Reporta divergências (contratos sem sync, órfãos em radcheck)
#   3. Com --fix: chama POST /v1/radius/_tasks/run-reconciler (auto-corrige)
#
# Quando rodar:
#   - Depois de update grande pra confirmar coerência
#   - Quando cliente reclama de bloqueio/timeout RADIUS misterioso
#   - Em CI/audit periódico (cron externo)
# =============================================================================
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERRO: precisa rodar como root (sudo netx-radius-check)" >&2
  exit 1
fi

NETX_ETC="${NETX_ETC:-/etc/netx}"
NETX_DB_NAME_DEFAULT="netx_app"
DO_FIX=0

for arg in "$@"; do
  case "$arg" in
    --fix|-f) DO_FIX=1 ;;
    --help|-h)
      head -25 "$0" | grep '^#' | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_GREEN=$'\033[1;32m'; C_RED=$'\033[1;31m'
  C_BLUE=$'\033[1;34m'; C_YELLOW=$'\033[1;33m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_GREEN=""; C_RED=""; C_BLUE=""; C_YELLOW=""; C_DIM=""
fi

log()  { echo "${C_BLUE}[radius-check]${C_RESET} $*"; }
ok()   { echo "${C_GREEN}[ OK ]${C_RESET} $*"; }
err()  { echo "${C_RED}[FAIL]${C_RESET} $*" >&2; }
warn() { echo "${C_YELLOW}[WARN]${C_RESET} $*"; }
dim()  { echo "${C_DIM}$*${C_RESET}"; }

# Carrega NETX_DB_NAME do .env se existir
if [[ -f "${NETX_ETC}/.env" ]]; then
  # Só lê NETX_DB_NAME, não exporta tudo
  NETX_DB_NAME=$(grep -E '^NETX_DB_NAME=' "${NETX_ETC}/.env" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
fi
NETX_DB_NAME="${NETX_DB_NAME:-${NETX_DB_NAME_DEFAULT}}"

log "Auditando coerência contracts ↔ radius.* em ${NETX_DB_NAME}"

# -----------------------------------------------------------------------------
# 1. Audit: query SQL agregada
# -----------------------------------------------------------------------------
AUDIT_SQL=$(cat <<'SQL'
WITH expected AS (
  SELECT
    c.id          AS contract_id,
    c.tenant_id,
    c.status,
    c.auth_method,
    CASE
      WHEN c.auth_method = 'IPOE'  THEN coalesce(c.circuit_id, c.mac_address)
      WHEN c.auth_method = 'PPPOE' THEN c.pppoe_username
    END AS identifier
  FROM contracts c
  WHERE c.deleted_at IS NULL
),
radcheck_users AS (
  SELECT DISTINCT username FROM radius.radcheck
   WHERE attribute IN ('Cleartext-Password','Auth-Type')
),
radgroup_users AS (
  SELECT DISTINCT username FROM radius.radusergroup
)
SELECT
  'active_contracts'      AS metric, count(*) AS n FROM expected WHERE status = 'ACTIVE'    AND identifier IS NOT NULL
UNION ALL
SELECT 'suspended_contracts'  , count(*)        FROM expected WHERE status = 'SUSPENDED' AND identifier IS NOT NULL
UNION ALL
SELECT 'cancelled_contracts'  , count(*)        FROM expected WHERE status = 'CANCELLED' AND identifier IS NOT NULL
UNION ALL
SELECT 'radcheck_total'       , count(*)        FROM radcheck_users
UNION ALL
SELECT 'radusergroup_total'   , count(*)        FROM radgroup_users
UNION ALL
SELECT 'active_missing_radcheck',
       count(*) FROM expected e
       WHERE e.status = 'ACTIVE' AND e.identifier IS NOT NULL
         AND e.identifier NOT IN (SELECT username FROM radcheck_users)
UNION ALL
SELECT 'orphans_in_radcheck',
       count(*) FROM radcheck_users
        WHERE username NOT IN (SELECT identifier FROM expected WHERE identifier IS NOT NULL);
SQL
)

OUTPUT=$(sudo -u postgres psql -d "${NETX_DB_NAME}" -tA -F'|' -c "${AUDIT_SQL}" 2>&1 || true)
if [[ -z "${OUTPUT}" ]] || echo "${OUTPUT}" | grep -qi "error\|ERROR"; then
  err "falha na query de audit:"
  echo "${OUTPUT}" >&2
  exit 1
fi

declare -A METRIC
while IFS='|' read -r key val; do
  METRIC["${key// /}"]="${val// /}"
done <<< "${OUTPUT}"

ACTIVE="${METRIC[active_contracts]:-0}"
SUSPENDED="${METRIC[suspended_contracts]:-0}"
CANCELLED="${METRIC[cancelled_contracts]:-0}"
RC_TOTAL="${METRIC[radcheck_total]:-0}"
RG_TOTAL="${METRIC[radusergroup_total]:-0}"
MISSING="${METRIC[active_missing_radcheck]:-0}"
ORPHANS="${METRIC[orphans_in_radcheck]:-0}"

echo
echo "──────────────── ESTADO ATUAL ────────────────"
printf "  Contratos ACTIVE:               %s\n" "${ACTIVE}"
printf "  Contratos SUSPENDED:            %s\n" "${SUSPENDED}"
printf "  Contratos CANCELLED:            %s\n" "${CANCELLED}"
printf "  Usernames em radcheck:          %s\n" "${RC_TOTAL}"
printf "  Usernames em radusergroup:      %s\n" "${RG_TOTAL}"
echo "──────────────── DIVERGÊNCIAS ────────────────"
if [[ "${MISSING}" -gt 0 ]]; then
  warn "ACTIVE sem radcheck: ${MISSING}  (contratos pagam mas RADIUS rejeita)"
else
  ok "ACTIVE sem radcheck: 0"
fi
if [[ "${ORPHANS}" -gt 0 ]]; then
  warn "Órfãos em radcheck: ${ORPHANS}   (identificadores vazados, podem autenticar indevidamente)"
else
  ok "Órfãos em radcheck: 0"
fi
echo "──────────────────────────────────────────────"

# Lista os primeiros divergentes pra ajudar debug
if [[ "${MISSING}" -gt 0 || "${ORPHANS}" -gt 0 ]]; then
  echo
  log "Detalhes (até 10 cada):"
  if [[ "${MISSING}" -gt 0 ]]; then
    echo "  ${C_YELLOW}ACTIVE sem radcheck:${C_RESET}"
    sudo -u postgres psql -d "${NETX_DB_NAME}" -tA -F' | ' <<SQL
SELECT id, auth_method, coalesce(pppoe_username, circuit_id, mac_address) AS identifier
  FROM contracts
 WHERE deleted_at IS NULL AND status = 'ACTIVE'
   AND coalesce(pppoe_username, circuit_id, mac_address) IS NOT NULL
   AND coalesce(pppoe_username, circuit_id, mac_address) NOT IN
       (SELECT username FROM radius.radcheck WHERE attribute IN ('Cleartext-Password','Auth-Type'))
 LIMIT 10;
SQL
  fi
  if [[ "${ORPHANS}" -gt 0 ]]; then
    echo "  ${C_YELLOW}Órfãos em radcheck:${C_RESET}"
    sudo -u postgres psql -d "${NETX_DB_NAME}" -tA -F' | ' <<SQL
SELECT username, attribute, value
  FROM radius.radcheck
 WHERE attribute IN ('Cleartext-Password','Auth-Type')
   AND username NOT IN (
     SELECT coalesce(pppoe_username, circuit_id, mac_address)
       FROM contracts
      WHERE deleted_at IS NULL
        AND coalesce(pppoe_username, circuit_id, mac_address) IS NOT NULL
   )
 LIMIT 10;
SQL
  fi
fi

# -----------------------------------------------------------------------------
# 2. --fix: dispara reconciler via core-service
# -----------------------------------------------------------------------------
if [[ "${DO_FIX}" -eq 0 ]]; then
  echo
  if [[ "${MISSING}" -gt 0 || "${ORPHANS}" -gt 0 ]]; then
    dim "Reconciler vai corrigir em até 5min automaticamente."
    dim "Pra forçar agora:  sudo netx-radius-check --fix"
  fi
  exit 0
fi

echo
log "Aplicando correção via SQL (enfileira radius_events + remove órfãos)"
log "Estratégia equivalente ao RadiusReconcilerService — applier processa em ≤30s"

# Enfileira radius_event PENDING pra cada contrato divergente.
# O RadiusApplierService (cron 30s) processa normalmente.
ENQUEUE_SQL=$(cat <<'SQL'
INSERT INTO radius_events (id, tenant_id, contract_id, action, status, pppoe_username, target_pool, note, created_at)
SELECT
  gen_random_uuid(),
  c.tenant_id,
  c.id,
  CASE c.status
    WHEN 'ACTIVE'    THEN 'AUTHORIZE'::"RadiusAction"
    WHEN 'SUSPENDED' THEN 'BLOCK'::"RadiusAction"
    WHEN 'CANCELLED' THEN 'CANCEL'::"RadiusAction"
  END,
  'PENDING'::"RadiusEventStatus",
  coalesce(c.pppoe_username, c.circuit_id, c.mac_address),
  CASE c.status
    WHEN 'ACTIVE'    THEN 'ativos'
    WHEN 'SUSPENDED' THEN 'bloqueados'
    WHEN 'CANCELLED' THEN 'cancelados'
  END,
  'manual reconcile via netx-radius-check --fix',
  NOW()
FROM contracts c
WHERE c.deleted_at IS NULL
  AND coalesce(c.pppoe_username, c.circuit_id, c.mac_address) IS NOT NULL
  AND coalesce(c.pppoe_username, c.circuit_id, c.mac_address) NOT IN
      (SELECT username FROM radius.radcheck WHERE attribute IN ('Cleartext-Password','Auth-Type'))
  AND NOT EXISTS (
    SELECT 1 FROM radius_events e
     WHERE e.contract_id = c.id AND e.status = 'PENDING'
  );
SQL
  )
ENQUEUED=$(sudo -u postgres psql -d "${NETX_DB_NAME}" -tA -c "${ENQUEUE_SQL}" 2>&1 | grep -oP 'INSERT 0 \K[0-9]+' || echo "0")
ok "${ENQUEUED} radius_event(s) enfileirados — applier processa em ≤30s"

# Pra órfãos: DELETE direto em radcheck/radreply/radusergroup
if [[ "${ORPHANS}" -gt 0 ]]; then
  sudo -u postgres psql -d "${NETX_DB_NAME}" -c "
DELETE FROM radius.radcheck     WHERE username NOT IN (
  SELECT coalesce(pppoe_username, circuit_id, mac_address) FROM contracts
   WHERE deleted_at IS NULL AND coalesce(pppoe_username, circuit_id, mac_address) IS NOT NULL
);
DELETE FROM radius.radreply     WHERE username NOT IN (
  SELECT coalesce(pppoe_username, circuit_id, mac_address) FROM contracts
   WHERE deleted_at IS NULL AND coalesce(pppoe_username, circuit_id, mac_address) IS NOT NULL
);
DELETE FROM radius.radusergroup WHERE username NOT IN (
  SELECT coalesce(pppoe_username, circuit_id, mac_address) FROM contracts
   WHERE deleted_at IS NULL AND coalesce(pppoe_username, circuit_id, mac_address) IS NOT NULL
);
" >/dev/null
  ok "${ORPHANS} órfão(s) deletados de radcheck/radreply/radusergroup"
fi

echo
log "Re-rodando audit pra confirmar fix..."
sleep 3
exec "$0"  # re-roda o script sem --fix pra mostrar estado pós-fix
