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
  evolution_install_docker
  evolution_create_db
  evolution_render_compose
  evolution_start
  evolution_wait_ready
}

evolution_install_docker() {
  if command -v docker >/dev/null 2>&1; then
    log_dim "Docker já instalado"
    return 0
  fi
  log_info "Instalando Docker (docker.io do Debian)"
  apt-get install -y -qq docker.io docker-compose-v2
  systemctl enable --now docker
  log_ok "Docker pronto"
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

  # Postgres roda em localhost (host); o container Evolution acessa via
  # bridge "host" ou pelo IP do host. Usamos `host.docker.internal` mapeando.
  cat > "${EVOLUTION_DIR}/docker-compose.yml" <<EOF
# Gerado pelo installer NetX. Não edite manualmente — re-rode o installer.
version: "3.8"
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
