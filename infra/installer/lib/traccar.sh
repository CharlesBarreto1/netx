# shellcheck shell=bash
# =============================================================================
# traccar.sh — Traccar (rastreamento GPS) pra aba "Ao vivo" da Frota
# =============================================================================
# OPT-IN: só roda quando NETX_ENABLE_TRACCAR=1 (precisa de rastreadores GPS).
#
# Instala via installer oficial self-contained (JRE embutido) que cria a unit
# systemd `traccar.service` e sobe em 0.0.0.0:8082 (web + REST API) + portas de
# protocolo dos rastreadores. O core-service consome /api/devices + /api/positions
# (ver TRACCAR_* no .env) e filtra por tenant via Vehicle.trackerUniqueId.
#
# DB embutido (H2) por default — suficiente pra começar. Migrar pra Postgres é
# evolução futura (editar /opt/traccar/conf/traccar.xml).
#
# O primeiro usuário (admin) é criado na web no primeiro acesso; depois preencha
# TRACCAR_USER / TRACCAR_PASSWORD no /etc/netx/.env e reinicie o core-service.
# =============================================================================

TRACCAR_VERSION="${TRACCAR_VERSION:-6.5}"
TRACCAR_DIR="/opt/traccar"

traccar_setup() {
  if [[ -d "${TRACCAR_DIR}" ]]; then
    log_dim "Traccar já instalado em ${TRACCAR_DIR} — pulando download"
  else
    local variant="linux-64"
    case "$(uname -m)" in
      aarch64 | arm64) variant="linux-arm-64" ;;
    esac
    local url="https://github.com/traccar/traccar/releases/download/v${TRACCAR_VERSION}/traccar-${variant}-${TRACCAR_VERSION}.zip"
    local zip="/tmp/traccar-${variant}-${TRACCAR_VERSION}.zip"
    local tmp
    tmp="$(mktemp -d)"

    log_info "Baixando Traccar ${TRACCAR_VERSION} (${variant})"
    curl -fsSL "${url}" -o "${zip}"
    unzip -q "${zip}" -d "${tmp}"

    log_info "Rodando installer oficial do Traccar (cria systemd unit)"
    (cd "${tmp}" && ./traccar.run)

    rm -rf "${tmp}" "${zip}"
  fi

  systemctl enable traccar >/dev/null 2>&1 || true
  systemctl restart traccar

  # Boot do JRE é lento — espera a API responder (até 40s).
  local i=0
  while ! curl -fsS http://127.0.0.1:8082/api/server >/dev/null 2>&1; do
    i=$((i + 1))
    if ((i >= 40)); then
      log_error "Traccar não respondeu em 40s. Confere: journalctl -u traccar"
      break
    fi
    sleep 1
  done

  export NETX_TRACCAR_URL="http://127.0.0.1:8082"
  log_ok "Traccar em ${NETX_TRACCAR_URL}"
  log_dim "AÇÃO MANUAL: acesse a web do Traccar, crie o usuário admin e preencha"
  log_dim "  TRACCAR_USER / TRACCAR_PASSWORD em /etc/netx/.env (depois reinicie core)"
}
