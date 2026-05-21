#!/usr/bin/env bash
# =============================================================================
# netx-update.sh — atualizador de versão (separado do installer inicial)
# =============================================================================
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
#
# Uso típico (deploy de versão nova):
#   sudo netx-update
#
# O que faz (em ordem):
#   1. git pull (origin/main, ou NETX_REPO_BRANCH)
#   2. npm install (devDeps incluídas — necessário pra build)
#   3. prisma generate
#   4. build (Nx — core + gateway + web)
#   5. ownership fix nos artefatos
#   6. safe-migrate (snapshot pré-migration + prisma migrate deploy)
#   7. seed (idempotente — aplica perms/roles novas se houver)
#   8. restart dos 3 serviços systemd
#   9. smoke test rápido
#
# O que NÃO faz (diferente do installer):
#   - Não reinstala pacotes APT (postgres, redis, freeradius, etc)
#   - Não renderiza /etc/netx/.env (preserva customizações manuais)
#   - Não reconfigura nginx / systemd units (preserva customizações)
#   - Não toca em /etc/netx/.secrets (preserva JWT/KMS/etc)
#   - Não toca no admin user (preserva senha trocada pela UI)
#   - Não toca no firewall, chrony, evolution
#
# Pra usar o installer completo (ex.: VPS nova ou recovery total),
# rode `sudo bash /opt/netx/infra/installer/install.sh` direto.
# =============================================================================
set -Eeuo pipefail
shopt -s inherit_errexit 2>/dev/null || true

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERRO: netx-update precisa rodar como root (sudo netx-update)" >&2
  exit 1
fi

NETX_HOME="${NETX_HOME:-/opt/netx}"
NETX_USER="${NETX_USER:-netx}"
NETX_ETC="${NETX_ETC:-/etc/netx}"
NETX_REPO_BRANCH="${NETX_REPO_BRANCH:-main}"
NETX_LOG="${NETX_LOG:-/var/log/netx}"

# Cores
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_GREEN=$'\033[1;32m'; C_RED=$'\033[1;31m'
  C_BLUE=$'\033[1;34m'; C_YELLOW=$'\033[1;33m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_GREEN=""; C_RED=""; C_BLUE=""; C_YELLOW=""; C_DIM=""
fi

log() { echo "${C_BLUE}[netx-update]${C_RESET} $*"; }
ok()  { echo "${C_GREEN}[ OK ]${C_RESET} $*"; }
err() { echo "${C_RED}[FAIL]${C_RESET} $*" >&2; }
warn(){ echo "${C_YELLOW}[WARN]${C_RESET} $*"; }
dim() { echo "${C_DIM}$*${C_RESET}"; }

# Log também em arquivo dedicado pra debug futuro
mkdir -p "${NETX_LOG}"
UPDATE_LOG="${NETX_LOG}/update.log"
exec > >(tee -a "${UPDATE_LOG}") 2>&1

log "Iniciando atualização — $(date -Iseconds)"

# -----------------------------------------------------------------------------
# 0. Pré-checks
# -----------------------------------------------------------------------------
if [[ ! -d "${NETX_HOME}/.git" ]]; then
  err "${NETX_HOME} não é um repo git. Use o installer pra primeiro setup."
  exit 1
fi

if [[ ! -f "${NETX_ETC}/.env" ]]; then
  err "${NETX_ETC}/.env não existe. Use o installer pra primeiro setup."
  exit 1
fi

# Run cmds como user netx (segurança: build/install não devem ser root)
as_netx() {
  sudo -u "${NETX_USER}" -H bash -lc "$*"
}

# -----------------------------------------------------------------------------
# 1. git pull
# -----------------------------------------------------------------------------
log "git fetch + reset --hard origin/${NETX_REPO_BRANCH}"
# Marca o diretório como safe (Git 2.35+ recusa "dubious ownership")
git config --global --add safe.directory "${NETX_HOME}" 2>/dev/null || true

CURRENT_SHA=$(git -C "${NETX_HOME}" rev-parse HEAD 2>/dev/null || echo "unknown")
git -C "${NETX_HOME}" fetch --depth=1 origin "${NETX_REPO_BRANCH}"
git -C "${NETX_HOME}" reset --hard "origin/${NETX_REPO_BRANCH}"
NEW_SHA=$(git -C "${NETX_HOME}" rev-parse HEAD)
chown -R "${NETX_USER}:${NETX_USER}" "${NETX_HOME}"

if [[ "${CURRENT_SHA}" == "${NEW_SHA}" ]]; then
  dim "Já estamos na versão mais recente (${NEW_SHA:0:8}). Build pode pular se artefatos OK."
  NETX_FORCE_BUILD="${NETX_FORCE_BUILD:-0}"
else
  dim "Versão: ${CURRENT_SHA:0:8} → ${NEW_SHA:0:8}"
fi

# -----------------------------------------------------------------------------
# 2. npm install
# -----------------------------------------------------------------------------
log "npm install (~1-2 min)"
as_netx "cd ${NETX_HOME} && NODE_ENV=development npm_config_yes=true npm install --include=dev --no-audit --no-fund"

# Sanity check binários críticos
local_check_bins() {
  local missing=()
  [[ -x "${NETX_HOME}/node_modules/.bin/nx" ]]      || missing+=("nx")
  [[ -x "${NETX_HOME}/node_modules/.bin/nest" ]]    || missing+=("nest")
  [[ -x "${NETX_HOME}/node_modules/.bin/dotenv" ]]  || missing+=("dotenv-cli")
  [[ -x "${NETX_HOME}/node_modules/.bin/prisma" ]]  || missing+=("prisma")
  if [[ ${#missing[@]} -gt 0 ]]; then
    err "Binários ausentes: ${missing[*]}"
    err "Tente: rm -rf ${NETX_HOME}/node_modules && rerun"
    exit 1
  fi
}
local_check_bins

# -----------------------------------------------------------------------------
# 3. Prisma generate
# -----------------------------------------------------------------------------
log "prisma generate"
as_netx "cd ${NETX_HOME} && npm run -w apps/core-service db:generate"

# -----------------------------------------------------------------------------
# 4. Build (com restart automático do systemd no fim — vide netx_app.sh:build)
# -----------------------------------------------------------------------------
log "build (Nx — core + gateway + web)"
as_netx "set -a; . ${NETX_ETC}/.env; set +a; cd ${NETX_HOME} && NODE_ENV=production npm run build -- --skip-nx-cache"

# Sanity checks
[[ -f "${NETX_HOME}/apps/core-service/dist/apps/core-service/src/main.js" ]] \
  || { err "core-service main.js não foi gerado"; exit 1; }
[[ -f "${NETX_HOME}/apps/api-gateway/dist/apps/api-gateway/src/main.js" ]] \
  || { err "api-gateway main.js não foi gerado"; exit 1; }
[[ -f "${NETX_HOME}/apps/web/.next/BUILD_ID" ]] \
  || { err "web BUILD_ID não foi gerado"; exit 1; }

# -----------------------------------------------------------------------------
# 5. Ownership fix
# -----------------------------------------------------------------------------
chown -R "${NETX_USER}:${NETX_USER}" \
  "${NETX_HOME}/apps/web/.next" \
  "${NETX_HOME}/apps/core-service/dist" \
  "${NETX_HOME}/apps/api-gateway/dist" 2>/dev/null || true

# -----------------------------------------------------------------------------
# 6. Migrations (com snapshot pré-migration)
# -----------------------------------------------------------------------------
# Garante dir de snapshot existe + escrevível pelo netx
install -d -o root -g "${NETX_USER}" -m 0770 /var/backups/netx /var/backups/netx/pre-migration 2>/dev/null || true

log "prisma migrate deploy (com snapshot pré-migration)"
as_netx "cd ${NETX_HOME} && npm run -w apps/core-service db:migrate"

# -----------------------------------------------------------------------------
# 7. Seed (idempotente — perms/roles novas)
# -----------------------------------------------------------------------------
log "seed (perms, roles, tenant default)"
as_netx "cd ${NETX_HOME} && npm run -w apps/core-service db:seed"

# -----------------------------------------------------------------------------
# 8. Restart systemd
# -----------------------------------------------------------------------------
log "restart dos serviços systemd"
for svc in netx-core-service netx-api-gateway netx-web; do
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    systemctl restart "$svc"
    dim "  → ${svc} restarted"
  else
    warn "${svc} não estava active — não restarting"
  fi
done

# -----------------------------------------------------------------------------
# 9. Smoke test rápido
# -----------------------------------------------------------------------------
log "smoke test (espera 5s pros serviços bootarem)"
sleep 5

CORE_PORT="${NETX_PORT_CORE_SERVICE:-3101}"
GW_PORT="${NETX_PORT_API_GATEWAY:-3000}"
WEB_PORT="${NETX_PORT_WEB:-3200}"

check_port() {
  local name=$1 port=$2 attempts=10
  for ((i=1; i<=attempts; i++)); do
    if (echo > "/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
      ok "${name} respondendo em :${port}"
      return 0
    fi
    sleep 2
  done
  err "${name} NÃO subiu em :${port} após ${attempts} tentativas — veja journalctl -u netx-${name}"
  return 1
}

check_port "core-service" "${CORE_PORT}"
check_port "api-gateway"  "${GW_PORT}"
check_port "web"          "${WEB_PORT}"

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
echo
ok "Atualização concluída — versão ${NEW_SHA:0:8}"
dim "Logs: ${UPDATE_LOG}"
dim "Pra resetar senha do admin: NETX_ADMIN_RESET=1 sudo bash ${NETX_HOME}/infra/installer/install.sh"
