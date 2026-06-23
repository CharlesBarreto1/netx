#!/usr/bin/env bash
# =============================================================================
# netx-hub-backup.sh — backup do Postgres do Hub (pg_dump + validação + retenção)
# Adaptado do netx-backup.sh do NetX. Roda via systemd timer ou manual:
#   sudo /opt/netx-hub/deploy/backup/netx-hub-backup.sh
#
#   1. pg_dump -Fc (custom, comprimido)
#   2. valida com pg_restore --list (não restaura; só confirma que é legível)
#   3. retenção: apaga > N dias, mantém no mínimo os 7 mais recentes
#   4. opcional: rclone copy off-site se HUB_BACKUP_REMOTE setado
#
# Config lida de /etc/netx-hub/.env:
#   DATABASE_URL            — origem do dump
#   BACKUP_DIR              — opcional, default /var/backups/netx-hub
#   BACKUP_RETENTION_DAYS   — opcional, default 30
#   HUB_BACKUP_REMOTE       — opcional, rclone "remote:path" (ex: b2:netxhub-bkp/)
#   PG_DUMP_BIN/PG_RESTORE_BIN — opcional, caminho explícito do pg 16
# =============================================================================
set -Eeuo pipefail

HUB_ETC="${HUB_ETC:-/etc/netx-hub}"
HUB_LOG="${HUB_LOG:-/var/log/netx-hub}"

if [[ ! -f "${HUB_ETC}/.env" ]]; then
  echo "ERRO: ${HUB_ETC}/.env não encontrado" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source "${HUB_ETC}/.env"; set +a

BACKUP_DIR="${BACKUP_DIR:-/var/backups/netx-hub}"
AUTO_DIR="${BACKUP_DIR}/auto"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"
HUB_BACKUP_REMOTE="${HUB_BACKUP_REMOTE:-}"

mkdir -p "${AUTO_DIR}" "${HUB_LOG}"

LOCKFILE="/var/lock/netx-hub-backup.lock"
exec 9>"${LOCKFILE}"
if ! flock -n 9; then
  echo "[$(date -Iseconds)] Outro backup em andamento — abortando" >&2
  exit 0
fi

LOGFILE="${HUB_LOG}/backup.log"
exec > >(tee -a "${LOGFILE}") 2>&1
ts() { date -Iseconds; }
log() { echo "[$(ts)] $*"; }

log "===== Backup Hub iniciando ====="

if [[ -z "${DATABASE_URL:-}" ]]; then
  log "ERRO: DATABASE_URL não definido"; exit 1
fi

# Parse postgresql://user:pass@host:port/db?...
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

STAMP=$(date -u +"%Y%m%dT%H%M%SZ")
DUMP_FILE="${AUTO_DIR}/netxhub-${STAMP}.dump"
TMP_FILE="${DUMP_FILE}.tmp"

log "pg_dump → ${DUMP_FILE}"
start_ts=$(date +%s)
if ! "${PG_DUMP_BIN}" -Fc --no-owner --no-acl -f "${TMP_FILE}"; then
  log "ERRO: pg_dump falhou — ABORTADO"; rm -f "${TMP_FILE}"; exit 1
fi

log "Validando dump (pg_restore --list)"
if ! "${PG_RESTORE_BIN}" --list "${TMP_FILE}" > /dev/null 2>&1; then
  log "ERRO: dump corrompido — descartando"; rm -f "${TMP_FILE}"; exit 1
fi
mv "${TMP_FILE}" "${DUMP_FILE}"
chmod 640 "${DUMP_FILE}"
chown root:netxhub "${DUMP_FILE}" 2>/dev/null || true

SIZE_KB=$(du -k "${DUMP_FILE}" | awk '{print $1}')
log "Backup OK: ${SIZE_KB} KB em $(( $(date +%s) - start_ts ))s"

if [[ -n "${HUB_BACKUP_REMOTE}" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    log "Off-site: rclone copy → ${HUB_BACKUP_REMOTE}"
    rclone copy --quiet "${DUMP_FILE}" "${HUB_BACKUP_REMOTE}" \
      && log "Off-site OK" || log "AVISO: rclone falhou — backup local salvo"
  else
    log "AVISO: HUB_BACKUP_REMOTE setado mas rclone ausente"
  fi
else
  log "AVISO: HUB_BACKUP_REMOTE vazio — backup só local (SPOF)"
fi

log "Retenção: > ${BACKUP_RETENTION_DAYS} dias em ${AUTO_DIR}"
DELETED=$(find "${AUTO_DIR}" -maxdepth 1 -name 'netxhub-*.dump' -type f -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete | wc -l)
log "${DELETED} backup(s) antigo(s) removido(s)"
TOTAL=$(find "${AUTO_DIR}" -maxdepth 1 -name 'netxhub-*.dump' -type f | wc -l)
(( TOTAL < 7 )) && log "AVISO: só ${TOTAL} backups — retenção pode estar agressiva"

log "===== Backup Hub concluído ====="
echo
