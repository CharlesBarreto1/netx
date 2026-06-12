# shellcheck shell=bash
# =============================================================================
# traccar.sh — Traccar (rastreamento GPS) pra aba "Ao vivo" da Frota
# =============================================================================
# OPT-IN: só roda quando NETX_ENABLE_TRACCAR=1 (precisa de rastreadores GPS).
#
# Instala via installer oficial self-contained (JRE embutido) que cria a unit
# systemd `traccar.service` e sobe em 0.0.0.0:8082 (web + REST API) + portas de
# protocolo dos rastreadores (GT06/Concox=5023 — a que o firewall.sh abre).
#
# INTEGRAÇÃO 100% AUTOMÁTICA — sem passo manual:
#   1. Gera um service-account token (persistido em /etc/netx/.secrets como
#      TRACCAR_SERVICE_TOKEN — o netx_app.sh lê o MESMO segredo pra renderizar
#      TRACCAR_TOKEN no .env, então a ordem dos steps não importa).
#   2. Injeta o token no traccar.xml (web.serviceAccountToken) — a API aceita
#      esse Bearer com poderes de admin, sem existir usuário no banco.
#   3. O core-service cria/renomeia os devices sozinho a partir de
#      Vehicle.trackerUniqueId (VehiclesService → TraccarService.ensureDevice).
#
# A web do Traccar (8082, atrás de túnel SSH — a porta NÃO é aberta no UFW)
# continua disponível pra inspeção humana; criar usuário admin lá é OPCIONAL.
#
# DB embutido (H2) por default — suficiente pra começar. Migrar pra Postgres é
# evolução futura (editar /opt/traccar/conf/traccar.xml).
# =============================================================================

TRACCAR_VERSION="${TRACCAR_VERSION:-6.5}"
TRACCAR_DIR="/opt/traccar"
TRACCAR_XML="${TRACCAR_DIR}/conf/traccar.xml"

traccar_setup() {
  if [[ -d "${TRACCAR_DIR}" ]]; then
    log_dim "Traccar já instalado em ${TRACCAR_DIR} — pulando download"
  else
    # O zip oficial precisa de unzip — não vem no Debian mínimo.
    command -v unzip >/dev/null 2>&1 || apt-get install -y -qq unzip

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

  # --- Service-account token (API admin sem usuário manual) ------------------
  local token
  token=$(secret_get_or_create TRACCAR_SERVICE_TOKEN 48)
  if [[ ! -f "${TRACCAR_XML}" ]]; then
    log_error "Config ${TRACCAR_XML} não encontrado — instalação do Traccar incompleta"
    return 1
  fi
  if grep -q 'web.serviceAccountToken' "${TRACCAR_XML}"; then
    # Idempotente: re-runs sincronizam o XML com o segredo persistido.
    sed -i "s|<entry key='web.serviceAccountToken'>[^<]*</entry>|<entry key='web.serviceAccountToken'>${token}</entry>|" "${TRACCAR_XML}"
  else
    sed -i "s|</properties>|    <entry key='web.serviceAccountToken'>${token}</entry>\n</properties>|" "${TRACCAR_XML}"
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

  # Smoke do token: a integração inteira depende desse Bearer funcionar.
  if curl -fsS -H "Authorization: Bearer ${token}" \
    http://127.0.0.1:8082/api/devices >/dev/null 2>&1; then
    log_ok "Service-account token validado na API do Traccar"
  else
    log_warn "Token de serviço NÃO autenticou — confere web.serviceAccountToken em ${TRACCAR_XML}"
  fi

  export NETX_TRACCAR_URL="http://127.0.0.1:8082"
  export NETX_TRACCAR_TOKEN="${token}"
  log_ok "Traccar em ${NETX_TRACCAR_URL} — integração via token, devices criados pelo NetX"
  log_dim "Web do Traccar (opcional, inspeção): ssh -L 8082:127.0.0.1:8082 root@<vps> → http://localhost:8082"
}
