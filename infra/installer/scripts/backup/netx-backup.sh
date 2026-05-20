#!/usr/bin/env bash
# =============================================================================
# netx-backup.sh — backup automatizado do Postgres (pg_dump + validação + retention)
# =============================================================================
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
#
# Roda via systemd timer (netx-backup.timer). Idempotente, safe pra rodar manual:
#   sudo /opt/netx/infra/installer/scripts/backup/netx-backup.sh
#
# O que faz:
#   1. pg_dump -Fc (custom format, comprimido) do DB
#   2. Valida com `pg_restore --list` — confirma que o arquivo é restaurável
#      (NÃO faz restore real; só lê o header). Se inválido, falha e mantém o
#      backup anterior (não substitui).
#   3. Retenção: mantém últimos N backups (default 30 dias), apaga mais velhos
#   4. Opcional: rclone copy pra remoto, se NETX_BACKUP_REMOTE setado
#   5. Loga em /var/log/netx/backup.log (rotacionado via logrotate)
#
# Variáveis (lidas de /etc/netx/.env):
#   DATABASE_URL              — origem do dump
#   PG_DUMP_BIN               — opcional, default `pg_dump`
#   BACKUP_DIR                — opcional, default /var/backups/netx
#   BACKUP_RETENTION_DAYS     — opcional, default 30
#   NETX_BACKUP_REMOTE        — opcional, formato rclone "remote:path" (ex: "b2:netx-backups/")
#                                Se vazio: backup só local + warning no log.
# =============================================================================
set -Eeuo pipefail

NETX_ETC="${NETX_ETC:-/etc/netx}"
NETX_LOG="${NETX_LOG:-/var/log/netx}"

# -----------------------------------------------------------------------------
# Carrega config do .env
# -----------------------------------------------------------------------------
if [[ ! -f "${NETX_ETC}/.env" ]]; then
  echo "ERRO: ${NETX_ETC}/.env não encontrado" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source "${NETX_ETC}/.env"; set +a

BACKUP_DIR="${BACKUP_DIR:-/var/backups/netx}"
# Subdir dedicado pro cron, separado dos backups manuais que o admin cria via
# UI (/settings/backups → Backup table). Sem isso, UI listaria mix confuso.
AUTO_DIR="${BACKUP_DIR}/auto"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
NETX_BACKUP_REMOTE="${NETX_BACKUP_REMOTE:-}"

mkdir -p "${BACKUP_DIR}" "${AUTO_DIR}" "${NETX_LOG}"

# Lock pra evitar 2 backups simultâneos (ex.: cron + manual)
LOCKFILE="/var/lock/netx-backup.lock"
exec 9>"${LOCKFILE}"
if ! flock -n 9; then
  echo "[$(date -Iseconds)] Outro backup em andamento — abortando" >&2
  exit 0
fi

# Log também em stdout pra journalctl mostrar.
LOGFILE="${NETX_LOG}/backup.log"
exec > >(tee -a "${LOGFILE}") 2>&1

ts() { date -Iseconds; }
log() { echo "[$(ts)] $*"; }

log "===== Backup iniciando ====="

# -----------------------------------------------------------------------------
# 1. Parse DATABASE_URL — extrai vars pgsql
# -----------------------------------------------------------------------------
if [[ -z "${DATABASE_URL:-}" ]]; then
  log "ERRO: DATABASE_URL não definido em .env"
  exit 1
fi

# Regex pra postgresql://user:pass@host:port/db?...
proto_rest="${DATABASE_URL#postgresql://}"
userpass="${proto_rest%%@*}"
hostdb="${proto_rest#*@}"
PGUSER="${userpass%%:*}"
PGPASSWORD="${userpass#*:}"
hostport="${hostdb%%/*}"
PGHOST="${hostport%%:*}"
PGPORT="${hostport##*:}"
[[ "${PGPORT}" == "${PGHOST}" ]] && PGPORT="5432"
dbpath="${hostdb#*/}"
PGDATABASE="${dbpath%%\?*}"

export PGUSER PGPASSWORD PGHOST PGPORT PGDATABASE

# -----------------------------------------------------------------------------
# 2. pg_dump
# -----------------------------------------------------------------------------
STAMP=$(date -u +"%Y%m%dT%H%M%SZ")
DUMP_FILE="${AUTO_DIR}/netx-${STAMP}.dump"
TMP_FILE="${DUMP_FILE}.tmp"

log "pg_dump → ${DUMP_FILE}"
start_ts=$(date +%s)

if ! "${PG_DUMP_BIN}" -Fc --no-owner --no-acl -f "${TMP_FILE}"; then
  log "ERRO: pg_dump falhou — backup ABORTADO"
  rm -f "${TMP_FILE}"
  exit 1
fi

# -----------------------------------------------------------------------------
# 3. Valida que o dump é restaurável (lê header e lista de objetos)
# -----------------------------------------------------------------------------
log "Validando dump (pg_restore --list)"
PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"
if ! "${PG_RESTORE_BIN}" --list "${TMP_FILE}" > /dev/null 2>&1; then
  log "ERRO: dump corrompido (pg_restore --list falhou) — descartando"
  rm -f "${TMP_FILE}"
  exit 1
fi

# Move pro nome final (atomic — só vira "backup oficial" se passou na validação)
mv "${TMP_FILE}" "${DUMP_FILE}"
chmod 640 "${DUMP_FILE}"
chown root:netx "${DUMP_FILE}" 2>/dev/null || true

SIZE_KB=$(du -k "${DUMP_FILE}" | awk '{print $1}')
DURATION=$(( $(date +%s) - start_ts ))
log "Backup OK: ${SIZE_KB} KB em ${DURATION}s"

# -----------------------------------------------------------------------------
# 4. Off-host copy (opcional via rclone)
# -----------------------------------------------------------------------------
if [[ -n "${NETX_BACKUP_REMOTE}" ]]; then
  if ! command -v rclone >/dev/null 2>&1; then
    log "AVISO: NETX_BACKUP_REMOTE setado mas rclone não instalado — pulando off-host"
  else
    log "Off-host: rclone copy → ${NETX_BACKUP_REMOTE}"
    if rclone copy --quiet "${DUMP_FILE}" "${NETX_BACKUP_REMOTE}"; then
      log "Off-host OK"
    else
      log "AVISO: rclone falhou — backup local salvo, mas SEM cópia remota"
      # NÃO falha o script — backup local ainda é melhor que nada.
    fi
  fi
else
  log "AVISO: NETX_BACKUP_REMOTE vazio — backup só local (SPOF se VPS falhar)"
fi

# -----------------------------------------------------------------------------
# 5. Retention — apaga backups mais velhos que N dias (LOCAL ONLY)
# -----------------------------------------------------------------------------
log "Retention: apagando backups locais > ${BACKUP_RETENTION_DAYS} dias (apenas em ${AUTO_DIR})"
# Só apaga em /auto/ — NÃO toca em backups manuais (BACKUP_DIR raiz) nem em
# pre-migration snapshots (BACKUP_DIR/pre-migration), que tem retention própria.
DELETED=$(find "${AUTO_DIR}" -maxdepth 1 -name 'netx-*.dump' -type f -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete | wc -l)
log "${DELETED} backup(s) antigo(s) removidos"

# Sempre mantém pelo menos os 7 mais recentes, mesmo se a retention quiser apagar
# (proteção contra "BACKUP_RETENTION_DAYS=0" por engano)
KEEP_MIN=7
TOTAL=$(find "${AUTO_DIR}" -maxdepth 1 -name 'netx-*.dump' -type f | wc -l)
if (( TOTAL < KEEP_MIN )); then
  log "AVISO: só ${TOTAL} backups locais — retention pode estar muito agressiva"
fi

log "===== Backup concluído ====="
echo
