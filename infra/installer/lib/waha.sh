# shellcheck shell=bash
# =============================================================================
# waha.sh — WAHA (WhatsApp HTTP API) em Docker
# =============================================================================
# Motor do canal QR do módulo Call (substitui o Evolution API, que virou
# licença paga na v2.4.0). Grátis, open-source, multi-sessão.
#
# Roda na mesma VPS em localhost:3000 (network_mode=host).
# Engine NOWEB (WebSocket, sem Chromium) — leve, cabe muitas sessões.
# Sessões persistidas em /var/lib/netx/waha (/app/.sessions no container).
# Auth: header X-Api-Key = WHATSAPP_API_KEY (gerada pelo installer; o admin
# cola essa chave em /settings/whatsapp ao criar a instância QR).
# Webhook é configurado POR SESSÃO pelo core-service (HMAC), não global aqui.
# =============================================================================

WAHA_DIR=/opt/netx-waha
# 3010 e não 3000: o api-gateway já ocupa :3000 no host (network_mode=host).
WAHA_PORT=3010

waha_setup() {
  WAHA_DOCKER_FAILED=0
  waha_install_docker
  # Se Docker não rolou, pula sem quebrar o install — o resto do NetX segue.
  if [[ "${WAHA_DOCKER_FAILED}" == "1" ]]; then
    log_warn "WAHA skipped (Docker indisponível). NetX core/web/gateway continuam OK."
    return 0
  fi
  waha_render_compose
  waha_start
  waha_wait_ready
}

waha_install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log_dim "Docker + compose v2 já instalados"
    return 0
  fi
  log_info "Instalando Docker (docker.io) + Compose v2 plugin"
  if ! apt-get install -y -qq docker.io docker-compose-v2 2>/dev/null; then
    log_warn "Pacote compose v2 ausente no APT default — usando repo oficial Docker"
    apt-get install -y -qq ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
      curl -fsSL https://download.docker.com/linux/debian/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
    fi
    local codename
    codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${codename} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    if ! apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
      log_warn "Docker install falhou — WAHA (WhatsApp QR) será PULADO."
      log_warn "NetX core continua funcionando. Pra habilitar depois: vide docs/whatsapp.md"
      WAHA_DOCKER_FAILED=1
      return 0
    fi
  fi
  systemctl enable --now docker 2>/dev/null || true

  if ! docker compose version >/dev/null 2>&1; then
    log_warn "Compose v2 não disponível — WAHA será PULADO. Resto do install continua."
    WAHA_DOCKER_FAILED=1
    return 0
  fi
  log_ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) + Compose $(docker compose version --short)"
}

waha_render_compose() {
  install -d -m 0750 "${WAHA_DIR}"
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0750 "${NETX_VAR}/waha"
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0750 "${NETX_VAR}/whatsapp/media"

  local apikey
  apikey=$(secret_get_or_create WHATSAPP_API_KEY 48)
  export WHATSAPP_API_KEY="${apikey}"

  # network_mode: host — o container fala com o core-service em 127.0.0.1 e o
  # core-service alcança o WAHA em http://localhost:3000 sem bridge.
  cat > "${WAHA_DIR}/docker-compose.yml" <<EOF
# Gerado pelo installer NetX. Não edite manualmente — re-rode o installer.
services:
  waha:
    image: devlikeapro/waha:latest
    container_name: netx-waha
    restart: always
    network_mode: "host"
    environment:
      # Auth da API — clientes enviam header X-Api-Key com este valor.
      WHATSAPP_API_KEY: "${WHATSAPP_API_KEY}"
      # Porta interna (host network) — 3010 evita colisão com o api-gateway:3000.
      WHATSAPP_API_PORT: "${WAHA_PORT}"
      # Engine NOWEB (WebSocket, sem Chromium) — leve p/ VPS.
      WHATSAPP_DEFAULT_ENGINE: "NOWEB"
      WAHA_PRINT_QR: "false"
      WHATSAPP_RESTART_ALL_SESSIONS: "true"
      # Baixa e expõe mídia (o core-service busca via URL com X-Api-Key).
      WHATSAPP_DOWNLOAD_MEDIA: "true"
      WAHA_LOG_LEVEL: "warn"
      TZ: "America/Sao_Paulo"
    volumes:
      - ${NETX_VAR}/waha:/app/.sessions
      - ${NETX_VAR}/whatsapp/media:/app/.media
EOF

  chmod 640 "${WAHA_DIR}/docker-compose.yml"
  log_ok "docker-compose.yml gerado em ${WAHA_DIR}"
}

waha_start() {
  log_info "Subindo container netx-waha"
  (cd "${WAHA_DIR}" && docker compose up -d)
}

waha_wait_ready() {
  log_info "Aguardando WAHA responder em :${WAHA_PORT}"
  if ! wait_port 127.0.0.1 "${WAHA_PORT}" 90; then
    log_error "WAHA não abriu porta ${WAHA_PORT}"
    docker logs --tail 80 netx-waha >&2 || true
    exit 1
  fi
  # Sanity: /ping responde sem auth.
  if ! curl -fsS "http://127.0.0.1:${WAHA_PORT}/ping" >/dev/null 2>&1; then
    log_warn "WAHA respondeu na porta mas /ping não retornou 200 — pode ser versão diferente"
  fi
  log_ok "WAHA rodando em http://127.0.0.1:${WAHA_PORT}"
  log_dim "→ X-Api-Key salva em ${NETX_ETC}/.secrets (WHATSAPP_API_KEY). Cole em /settings/whatsapp."
}
