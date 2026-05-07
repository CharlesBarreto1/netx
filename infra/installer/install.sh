#!/usr/bin/env bash
# =============================================================================
# NetX — Installer (Debian 13 Trixie)
# =============================================================================
# Uso (em um Debian 13 fresh, como root):
#
#   curl -fsSL https://raw.githubusercontent.com/<seu-user>/netx/main/infra/installer/install.sh \
#     | sudo bash
#
# Ou, se já clonou o repo:
#
#   sudo bash /opt/netx/infra/installer/install.sh
#
# Variáveis de ambiente opcionais (override de defaults):
#
#   NETX_REPO_URL=https://github.com/<user>/netx.git
#   NETX_REPO_BRANCH=main
#   NETX_DOMAIN=netx.example.com   # se vazio, usa IP
#   NETX_ADMIN_EMAIL=admin@netx.local
#   NETX_ADMIN_PASSWORD=...        # se vazio, gera aleatória
#   NETX_TENANT_NAME="Minha ISP"
#   NETX_TENANT_COUNTRY=PY         # PY, BR, AR, ...
#   NETX_SKIP_WIZARD=1             # pula prompts (modo unattended)
#   NETX_FORCE=1                   # re-roda mesmo se já instalado
#
# O script é idempotente: pode rodar várias vezes; só executa o que falta.
# Falha rápido em qualquer erro. Logs completos em /var/log/netx-install.log.
# =============================================================================

set -Eeuo pipefail
shopt -s inherit_errexit 2>/dev/null || true

# -----------------------------------------------------------------------------
# Resolve diretório do installer (funciona via curl|bash ou execução local).
# -----------------------------------------------------------------------------
INSTALLER_SCRIPT="${BASH_SOURCE[0]:-$0}"
if [[ "${INSTALLER_SCRIPT}" == "bash" || -z "${INSTALLER_SCRIPT}" ]]; then
  # Caso curl|bash — instalador foi piped, vamos clonar repo e re-executar
  INSTALLER_DIR=""
else
  INSTALLER_DIR="$(cd "$(dirname "${INSTALLER_SCRIPT}")" && pwd)"
fi

# -----------------------------------------------------------------------------
# Variáveis globais (defaults, podem ser sobrescritos via env)
# -----------------------------------------------------------------------------
export NETX_REPO_URL="${NETX_REPO_URL:-https://github.com/charlesbarreto/netx.git}"
export NETX_REPO_BRANCH="${NETX_REPO_BRANCH:-main}"
export NETX_USER="${NETX_USER:-netx}"
export NETX_HOME="${NETX_HOME:-/opt/netx}"
export NETX_ETC="${NETX_ETC:-/etc/netx}"
export NETX_VAR="${NETX_VAR:-/var/lib/netx}"
export NETX_LOG="${NETX_LOG:-/var/log/netx}"
export NETX_INSTALL_LOG="/var/log/netx-install.log"
export NETX_STATE_DIR="${NETX_VAR}/install-state"

export NETX_DB_NAME="${NETX_DB_NAME:-netx}"
export NETX_DB_USER="${NETX_DB_USER:-netx}"
export NETX_DB_HOST="${NETX_DB_HOST:-localhost}"
export NETX_DB_PORT="${NETX_DB_PORT:-5432}"

export NETX_RABBIT_VHOST="${NETX_RABBIT_VHOST:-netx}"
export NETX_RABBIT_USER="${NETX_RABBIT_USER:-netx}"

export NETX_PORT_API_GATEWAY="${NETX_PORT_API_GATEWAY:-3000}"
export NETX_PORT_CORE_SERVICE="${NETX_PORT_CORE_SERVICE:-3101}"
export NETX_PORT_WEB="${NETX_PORT_WEB:-3200}"

export NETX_DOMAIN="${NETX_DOMAIN:-}"
export NETX_ADMIN_EMAIL="${NETX_ADMIN_EMAIL:-}"
export NETX_ADMIN_PASSWORD="${NETX_ADMIN_PASSWORD:-}"
export NETX_TENANT_NAME="${NETX_TENANT_NAME:-NetX Default}"
export NETX_TENANT_COUNTRY="${NETX_TENANT_COUNTRY:-PY}"
export NETX_TENANT_LOCALE="${NETX_TENANT_LOCALE:-es-PY}"
export NETX_TENANT_CURRENCY="${NETX_TENANT_CURRENCY:-PYG}"

export NETX_SKIP_WIZARD="${NETX_SKIP_WIZARD:-0}"
export NETX_FORCE="${NETX_FORCE:-0}"
export DEBIAN_FRONTEND=noninteractive

# -----------------------------------------------------------------------------
# Boot mínimo: mkdir log antes de qualquer source
# -----------------------------------------------------------------------------
mkdir -p "$(dirname "${NETX_INSTALL_LOG}")"
touch "${NETX_INSTALL_LOG}"
chmod 640 "${NETX_INSTALL_LOG}"

# Tudo daqui em diante vai pra console + log file
exec > >(tee -a "${NETX_INSTALL_LOG}") 2>&1

# -----------------------------------------------------------------------------
# Bootstrap: se rodando via curl|bash, clona repo e re-exec a partir dele
# -----------------------------------------------------------------------------
if [[ -z "${INSTALLER_DIR}" || ! -d "${INSTALLER_DIR}/lib" ]]; then
  echo "==> Modo bootstrap: instalando git e clonando repositório..."
  if ! command -v git >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq git ca-certificates curl
  fi
  if [[ ! -d "${NETX_HOME}/.git" ]]; then
    git clone --depth=1 --branch "${NETX_REPO_BRANCH}" "${NETX_REPO_URL}" "${NETX_HOME}"
  else
    git -C "${NETX_HOME}" fetch --depth=1 origin "${NETX_REPO_BRANCH}"
    git -C "${NETX_HOME}" reset --hard "origin/${NETX_REPO_BRANCH}"
  fi
  INSTALLER_DIR="${NETX_HOME}/infra/installer"
  echo "==> Re-executando installer a partir de ${INSTALLER_DIR}/install.sh"
  exec bash "${INSTALLER_DIR}/install.sh" "$@"
fi

export INSTALLER_DIR

# -----------------------------------------------------------------------------
# Carrega libs em ordem de dependência
# -----------------------------------------------------------------------------
# shellcheck source=lib/common.sh
source "${INSTALLER_DIR}/lib/common.sh"
# shellcheck source=lib/preflight.sh
source "${INSTALLER_DIR}/lib/preflight.sh"
# shellcheck source=lib/packages.sh
source "${INSTALLER_DIR}/lib/packages.sh"
# shellcheck source=lib/postgres.sh
source "${INSTALLER_DIR}/lib/postgres.sh"
# shellcheck source=lib/redis.sh
source "${INSTALLER_DIR}/lib/redis.sh"
# shellcheck source=lib/rabbitmq.sh
source "${INSTALLER_DIR}/lib/rabbitmq.sh"
# shellcheck source=lib/freeradius.sh
source "${INSTALLER_DIR}/lib/freeradius.sh"
# shellcheck source=lib/evolution.sh
source "${INSTALLER_DIR}/lib/evolution.sh"
# shellcheck source=lib/netx_app.sh
source "${INSTALLER_DIR}/lib/netx_app.sh"
# shellcheck source=lib/systemd.sh
source "${INSTALLER_DIR}/lib/systemd.sh"
# shellcheck source=lib/nginx.sh
source "${INSTALLER_DIR}/lib/nginx.sh"
# shellcheck source=lib/wizard.sh
source "${INSTALLER_DIR}/lib/wizard.sh"
# shellcheck source=lib/smoke.sh
source "${INSTALLER_DIR}/lib/smoke.sh"

# -----------------------------------------------------------------------------
# Trap de erro: imprime stack trace e onde parou
# -----------------------------------------------------------------------------
on_error() {
  local exit_code=$?
  local line=$1
  log_error "Falha na linha ${line} (exit ${exit_code})"
  log_error "Veja o log completo em ${NETX_INSTALL_LOG}"
  log_error "Para retomar do ponto que falhou, basta rodar o installer de novo."
  exit "${exit_code}"
}
trap 'on_error ${LINENO}' ERR

# -----------------------------------------------------------------------------
# Pipeline
# -----------------------------------------------------------------------------
main() {
  log_banner "NetX Installer — Debian 13"

  step "preflight"           preflight_check
  step "wizard"              wizard_run
  step "packages"            packages_install
  step "postgres"            postgres_setup
  step "redis"               redis_setup
  step "rabbitmq"            rabbitmq_setup
  step "netx_app"            netx_app_setup
  step "freeradius"          freeradius_setup
  step "evolution"           evolution_setup
  step "systemd"             systemd_setup
  step "nginx"               nginx_setup
  step "smoke"               smoke_test

  log_banner "Instalação concluída"
  print_summary
}

main "$@"
