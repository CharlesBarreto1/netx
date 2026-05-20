#!/usr/bin/env bash
# =============================================================================
# safe-migrate.sh — wrapper de `prisma migrate deploy` com snapshot automático
# =============================================================================
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
#
# Faz `pg_dump` ANTES de aplicar migrations. Se uma migration tiver DROP
# COLUMN, RENAME, ou qualquer transformação destrutiva, você pode restaurar
# em segundos pelo snapshot.
#
# Diferenças vs. safe-reset.sh:
#   - migrate deploy é IDEMPOTENTE (só aplica pendentes) — esperado em prod
#   - Não exige confirmação — é o fluxo normal de deploy
#   - Snapshot vai pra subpasta /var/backups/netx/pre-migration/
#   - Mantém últimos 10 snapshots (não 30 — esses são por deploy, não diários)
#
# Uso:
#   npm run db:migrate          → chama este script (substitui prisma migrate deploy)
# =============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Resolve .env do monorepo OU /etc/netx/.env
ENV_FILE="${APP_DIR}/../../.env"
[[ ! -f "${ENV_FILE}" ]] && ENV_FILE="/etc/netx/.env"
[[ ! -f "${ENV_FILE}" ]] && { echo "ERRO: .env não encontrado" >&2; exit 1; }

# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

ts() { date -Iseconds; }
log() { echo "[$(ts)] $*"; }

# -----------------------------------------------------------------------------
# 1. Detecta se há migrations PENDENTES — se não, skip snapshot (deploy é no-op)
# -----------------------------------------------------------------------------
log "Verificando migrations pendentes"
STATUS_OUTPUT=$(cd "${APP_DIR}" && npx dotenv -e "${ENV_FILE}" -- prisma migrate status 2>&1 || true)

if echo "${STATUS_OUTPUT}" | grep -q "Database schema is up to date"; then
  log "Nenhuma migration pendente — skip snapshot"
  log "(prisma migrate deploy de qualquer jeito, pra atualizar _prisma_migrations se necessário)"
  exec npx dotenv -e "${ENV_FILE}" -- prisma migrate deploy
fi

# -----------------------------------------------------------------------------
# 2. Snapshot pg_dump pré-migration
# -----------------------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-/var/backups/netx}"
SNAP_DIR="${BACKUP_DIR}/pre-migration"

# Em dev (sem permissão em /var/backups), usa $HOME
if ! mkdir -p "${SNAP_DIR}" 2>/dev/null; then
  log "Sem permissão em ${SNAP_DIR} — fallback pra \$HOME/.netx-backups/pre-migration"
  SNAP_DIR="${HOME}/.netx-backups/pre-migration"
  mkdir -p "${SNAP_DIR}"
fi

STAMP=$(date -u +"%Y%m%dT%H%M%SZ")
SNAP="${SNAP_DIR}/pre-migration-${STAMP}.dump"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERRO: DATABASE_URL não definido — não dá pra snapshot" >&2
  exit 1
fi

log "Fazendo snapshot pré-migration → ${SNAP}"

# Parse DATABASE_URL pra env vars pgsql
proto_rest="${DATABASE_URL#postgresql://}"
userpass="${proto_rest%%@*}"
hostdb="${proto_rest#*@}"
export PGUSER="${userpass%%:*}"
export PGPASSWORD="${userpass#*:}"
hostport="${hostdb%%/*}"
export PGHOST="${hostport%%:*}"
PGPORT_VAL="${hostport##*:}"
[[ "${PGPORT_VAL}" == "${PGHOST}" ]] && PGPORT_VAL="5432"
export PGPORT="${PGPORT_VAL}"
dbpath="${hostdb#*/}"
export PGDATABASE="${dbpath%%\?*}"

PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
start_ts=$(date +%s)

if ! "${PG_DUMP_BIN}" -Fc --no-owner --no-acl -f "${SNAP}"; then
  echo "ERRO: pg_dump pré-migration falhou — recusando aplicar migrations" >&2
  rm -f "${SNAP}"
  exit 1
fi
duration=$(( $(date +%s) - start_ts ))
size_kb=$(du -k "${SNAP}" | awk '{print $1}')
log "Snapshot OK: ${size_kb} KB em ${duration}s"

# -----------------------------------------------------------------------------
# 3. Retenção — mantém últimos 10 snapshots pre-migration
# -----------------------------------------------------------------------------
KEEP=10
# Lista por mais recente primeiro, pula os KEEP primeiros, apaga o resto
find "${SNAP_DIR}" -maxdepth 1 -name 'pre-migration-*.dump' -type f -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn \
  | awk -v keep="${KEEP}" 'NR > keep {print $2}' \
  | xargs -r rm -f

# -----------------------------------------------------------------------------
# 4. Aplica migrations
# -----------------------------------------------------------------------------
log "Aplicando migrations (prisma migrate deploy)"
cd "${APP_DIR}"
if ! npx dotenv -e "${ENV_FILE}" -- prisma migrate deploy; then
  echo
  echo "ERRO: migrations falharam. Pra restaurar o estado anterior:" >&2
  echo "  pg_restore -d \"\$DATABASE_URL\" --clean --if-exists '${SNAP}'" >&2
  exit 1
fi

log "Migrations aplicadas com sucesso"
log "Snapshot pré-migration preservado: ${SNAP}"
log "(pra rollback manual em caso de problema futuro: pg_restore -d \"\$DATABASE_URL\" --clean --if-exists '${SNAP}')"
