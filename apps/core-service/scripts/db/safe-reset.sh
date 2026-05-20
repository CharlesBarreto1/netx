#!/usr/bin/env bash
# =============================================================================
# safe-reset.sh — wrapper de `prisma migrate reset` com guards anti-acidente
# =============================================================================
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
#
# `prisma migrate reset --force` DROPA todas as tabelas, aplica todas as
# migrations do zero e roda o seed. Em prod = data loss instantâneo.
#
# Este wrapper EXIGE:
#   1. NODE_ENV != "production"  OU  NETX_ALLOW_DB_RESET=yes-i-know-what-im-doing
#   2. Confirmação interativa digitando "DELETE ALL MY DATA"
#   3. Snapshot pg_dump ANTES de continuar (recuperação possível)
#
# Uso normal (dev):
#   npm run db:reset
#
# Uso em prod (só em desastre extremo, com backup recente):
#   NETX_ALLOW_DB_RESET=yes-i-know-what-im-doing npm run db:reset
# =============================================================================
set -Eeuo pipefail

# Resolve .env do monorepo (script chamado de apps/core-service)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../../../../.env"
[[ ! -f "${ENV_FILE}" ]] && ENV_FILE="/etc/netx/.env"
# shellcheck disable=SC1090
[[ -f "${ENV_FILE}" ]] && { set -a; source "${ENV_FILE}"; set +a; }

C_RED=$'\033[1;31m'
C_YELLOW=$'\033[1;33m'
C_RESET=$'\033[0m'

err() { echo "${C_RED}ERRO:${C_RESET} $*" >&2; }
warn() { echo "${C_YELLOW}AVISO:${C_RESET} $*" >&2; }

# -----------------------------------------------------------------------------
# Guard 1: NODE_ENV check
# -----------------------------------------------------------------------------
ENV_NAME="${NODE_ENV:-development}"
if [[ "${ENV_NAME}" == "production" ]]; then
  if [[ "${NETX_ALLOW_DB_RESET:-}" != "yes-i-know-what-im-doing" ]]; then
    err "Recusando 'prisma migrate reset' em NODE_ENV=production."
    err ""
    err "Isso DROPA TODAS as tabelas e perde TODOS os dados."
    err ""
    err "Se você realmente quer (após restore manual de backup), rode:"
    err "  NETX_ALLOW_DB_RESET=yes-i-know-what-im-doing npm run db:reset"
    err ""
    err "Antes, verifique que TEM backup recente em /var/backups/netx/"
    exit 1
  fi
  warn "NETX_ALLOW_DB_RESET setado em produção — prosseguindo (DESTRUTIVO)"
fi

# -----------------------------------------------------------------------------
# Guard 2: confirmação interativa (a menos que NETX_RESET_SKIP_CONFIRM=1, usado em CI)
# -----------------------------------------------------------------------------
if [[ "${NETX_RESET_SKIP_CONFIRM:-0}" != "1" ]]; then
  if [[ ! -t 0 ]]; then
    err "Recusando reset não-interativo. Defina NETX_RESET_SKIP_CONFIRM=1 se for CI."
    exit 1
  fi
  echo "${C_RED}========================================================${C_RESET}"
  echo "${C_RED}  ATENÇÃO: você está prestes a DROPAR todas as tabelas${C_RESET}"
  echo "${C_RED}  do banco '${PGDATABASE:-netx}' em ${ENV_NAME}.${C_RESET}"
  echo "${C_RED}========================================================${C_RESET}"
  echo
  echo -n "Digite ${C_RED}DELETE ALL MY DATA${C_RESET} pra confirmar: "
  read -r CONFIRM
  if [[ "${CONFIRM}" != "DELETE ALL MY DATA" ]]; then
    err "Confirmação não bate. Abortando."
    exit 1
  fi
fi

# -----------------------------------------------------------------------------
# Guard 3: snapshot pg_dump antes do reset
# -----------------------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-/var/backups/netx}"
SAFE_DIR="${BACKUP_DIR}/pre-reset"
mkdir -p "${SAFE_DIR}" 2>/dev/null || {
  warn "Não foi possível criar ${SAFE_DIR} — você está rodando sem permissão?"
  warn "Tentando $HOME/.netx-backups/pre-reset/ como fallback"
  SAFE_DIR="${HOME}/.netx-backups/pre-reset"
  mkdir -p "${SAFE_DIR}"
}

STAMP=$(date -u +"%Y%m%dT%H%M%SZ")
SNAP="${SAFE_DIR}/pre-reset-${STAMP}.dump"

echo
echo "Fazendo snapshot pg_dump antes do reset → ${SNAP}"
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  err "DATABASE_URL não definido. Não dá pra fazer snapshot — abortando."
  exit 1
fi

# Parse DATABASE_URL pra env vars pgsql (mesma lógica de netx-backup.sh)
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

if ! "${PG_DUMP_BIN}" -Fc --no-owner --no-acl -f "${SNAP}"; then
  err "pg_dump falhou — recusando reset por segurança"
  rm -f "${SNAP}"
  exit 1
fi
echo "Snapshot salvo: ${SNAP}"
echo "Pra restaurar (se algo der errado):"
echo "  pg_restore -d '${DATABASE_URL}' --clean --if-exists '${SNAP}'"
echo

# -----------------------------------------------------------------------------
# Execução real
# -----------------------------------------------------------------------------
echo "Executando prisma migrate reset..."
exec npx dotenv -e "${ENV_FILE}" -- prisma migrate reset --force
