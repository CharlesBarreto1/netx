# shellcheck shell=bash
# =============================================================================
# evolution.sh — Evolution API (WhatsApp/Baileys) em Docker
# =============================================================================
# Roda na mesma VPS do NetX em localhost:8080.
# Persiste sessões em /var/lib/netx/evolution.
# Roda numa subdb 'evolution' do mesmo Postgres do NetX (separada de 'netx').
# =============================================================================

EVOLUTION_DIR=/opt/netx-evolution
EVOLUTION_DB=evolution
EVOLUTION_DB_USER=evolution
EVOLUTION_PORT=8080
EVOLUTION_REDIS_DB=6

evolution_setup() {
  EVOLUTION_DOCKER_FAILED=0
  evolution_install_docker
  # Se Docker não rolou (ex.: Debian 13 sem pacotes compose), pula tudo sem
  # quebrar o install. Operador pode habilitar Evolution depois manualmente.
  if [[ "${EVOLUTION_DOCKER_FAILED}" == "1" ]]; then
    log_warn "Evolution skipped (Docker indisponível). NetX core/web/gateway continuam OK."
    return 0
  fi
  evolution_create_db
  evolution_render_compose
  evolution_start
  evolution_wait_ready
}

evolution_install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log_dim "Docker + compose v2 já instalados"
    return 0
  fi
  log_info "Instalando Docker (docker.io) + Compose v2 plugin"
  # Em Debian 13 nenhum dos pacotes APT default tem o plugin compose v2.
  # Adiciona o repo oficial Docker (sempre disponível) — único caminho
  # estável pra obter docker-compose-plugin.
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
      log_warn "Docker install falhou — Evolution (WhatsApp) será PULADO."
      log_warn "NetX core continua funcionando. Pra habilitar depois: vide docs/whatsapp.md"
      EVOLUTION_DOCKER_FAILED=1
      return 0
    fi
  fi
  systemctl enable --now docker 2>/dev/null || true

  if ! docker compose version >/dev/null 2>&1; then
    log_warn "Compose v2 não disponível — Evolution será PULADO. Reste do install continua."
    EVOLUTION_DOCKER_FAILED=1
    return 0
  fi
  log_ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) + Compose $(docker compose version --short)"
}

evolution_create_db() {
  log_info "Criando DB '${EVOLUTION_DB}' e role '${EVOLUTION_DB_USER}'"
  local pwd
  pwd=$(secret_get_or_create EVOLUTION_DB_PASSWORD 32)
  export EVOLUTION_DB_PASSWORD="${pwd}"

  local exists
  exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${EVOLUTION_DB_USER}'" || true)
  if [[ "${exists}" != "1" ]]; then
    psql_super -c "CREATE ROLE ${EVOLUTION_DB_USER} WITH LOGIN PASSWORD '${EVOLUTION_DB_PASSWORD}'"
  else
    psql_super -c "ALTER ROLE ${EVOLUTION_DB_USER} WITH LOGIN PASSWORD '${EVOLUTION_DB_PASSWORD}'"
  fi

  exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${EVOLUTION_DB}'" || true)
  if [[ "${exists}" != "1" ]]; then
    psql_super -c "CREATE DATABASE ${EVOLUTION_DB} OWNER ${EVOLUTION_DB_USER}"
  fi
}

evolution_render_compose() {
  install -d -m 0750 "${EVOLUTION_DIR}"
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0750 "${NETX_VAR}/evolution"
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0750 "${NETX_VAR}/whatsapp/media"

  local apikey
  apikey=$(secret_get_or_create EVOLUTION_API_KEY 48)
  export EVOLUTION_API_KEY="${apikey}"

  # network_mode: host — container compartilha namespace de rede do host.
  # Postgres + Redis ficam acessíveis em 127.0.0.1 sem precisar de bridge.
  # Side-effect: NÃO PUBLICAR ports — o container já escuta direto no host.
  cat > "${EVOLUTION_DIR}/docker-compose.yml" <<EOF
# Gerado pelo installer NetX. Não edite manualmente — re-rode o installer.
services:
  evolution:
    image: atendai/evolution-api:v2.1.1
    container_name: netx-evolution
    restart: always
    network_mode: "host"
    environment:
      AUTHENTICATION_API_KEY: "${EVOLUTION_API_KEY}"
      SERVER_PORT: "${EVOLUTION_PORT}"
      DATABASE_PROVIDER: "postgresql"
      DATABASE_CONNECTION_URI: "postgresql://${EVOLUTION_DB_USER}:${EVOLUTION_DB_PASSWORD}@127.0.0.1:5432/${EVOLUTION_DB}"
      DATABASE_CONNECTION_CLIENT_NAME: "evolution_exchange"
      CACHE_REDIS_ENABLED: "true"
      CACHE_REDIS_URI: "redis://127.0.0.1:6379/${EVOLUTION_REDIS_DB}"
      CACHE_REDIS_PREFIX_KEY: "netx-evolution"
      WEBHOOK_GLOBAL_ENABLED: "false"
      LOG_LEVEL: "ERROR,WARN"
      DEL_INSTANCE: "false"
      QRCODE_LIMIT: "5"
      LANGUAGE: "pt-BR"
    volumes:
      - ${NETX_VAR}/evolution:/evolution/instances
EOF

  chmod 640 "${EVOLUTION_DIR}/docker-compose.yml"
  log_ok "docker-compose.yml gerado em ${EVOLUTION_DIR}"
}

evolution_start() {
  log_info "Subindo container netx-evolution"
  (cd "${EVOLUTION_DIR}" && docker compose up -d)
}

evolution_wait_ready() {
  log_info "Aguardando Evolution responder em :${EVOLUTION_PORT}"
  if ! wait_port 127.0.0.1 "${EVOLUTION_PORT}" 60; then
    log_error "Evolution não abriu porta ${EVOLUTION_PORT}"
    docker logs --tail 80 netx-evolution >&2 || true
    exit 1
  fi
  # Sanity: GET / deve retornar 200 com banner
  if ! curl -fsS "http://127.0.0.1:${EVOLUTION_PORT}/" >/dev/null 2>&1; then
    log_warn "Evolution responde mas / não retornou 200 — pode ser versão diferente"
  fi
  log_ok "Evolution rodando em http://127.0.0.1:${EVOLUTION_PORT}"
}
