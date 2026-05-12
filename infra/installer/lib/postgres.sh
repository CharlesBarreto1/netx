# shellcheck shell=bash
# =============================================================================
# postgres.sh — cria role + DB + search_path; aplica radius schema
# =============================================================================

postgres_setup() {
  postgres_ensure_running
  postgres_create_role
  postgres_create_db
  postgres_search_path
  postgres_enable_extensions
  # Schema RADIUS é aplicado depois do build do app (pra Prisma migrate primeiro).
  # Veja netx_app.sh — postgres_apply_radius_schema é chamado de lá.
}

postgres_ensure_running() {
  systemctl enable --now postgresql
  if ! systemctl is-active --quiet postgresql; then
    log_error "PostgreSQL não subiu. Confere: journalctl -u postgresql"
    exit 1
  fi

  # Garante que o cluster 16-main escuta em ${NETX_DB_PORT}. Quando o pacote
  # foi instalado com OUTRO processo segurando 5432 (docker-proxy, postgres
  # antigo, etc), o `pg_createcluster` escala pra 5433/5434/etc — e o resto
  # do NetX espera 5432. Detecta e normaliza.
  if command -v pg_lsclusters >/dev/null 2>&1; then
    local current_port
    current_port=$(pg_lsclusters -h 2>/dev/null | awk '$1=="16" && $2=="main" {print $3}')
    if [[ -n "${current_port}" && "${current_port}" != "${NETX_DB_PORT}" ]]; then
      log_warn "Cluster 16-main em :${current_port}, esperado :${NETX_DB_PORT} — corrigindo"
      pg_conftool 16 main set port "${NETX_DB_PORT}"
      systemctl restart postgresql@16-main
      sleep 2
    fi
  fi

  log_ok "PostgreSQL ativo em :${NETX_DB_PORT}"
}

postgres_create_role() {
  local pwd
  pwd=$(secret_get_or_create NETX_DB_PASSWORD 32)
  export NETX_DB_PASSWORD="${pwd}"

  local exists
  exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${NETX_DB_USER}'" || true)
  if [[ "${exists}" == "1" ]]; then
    log_dim "Role ${NETX_DB_USER} já existe — atualizando senha"
    psql_super -c "ALTER ROLE ${NETX_DB_USER} WITH LOGIN PASSWORD '${NETX_DB_PASSWORD}'"
  else
    log_info "Criando role ${NETX_DB_USER}"
    psql_super -c "CREATE ROLE ${NETX_DB_USER} WITH LOGIN PASSWORD '${NETX_DB_PASSWORD}' CREATEDB"
  fi
}

postgres_create_db() {
  local exists
  exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${NETX_DB_NAME}'" || true)
  if [[ "${exists}" == "1" ]]; then
    log_dim "Database ${NETX_DB_NAME} já existe"
  else
    log_info "Criando database ${NETX_DB_NAME}"
    psql_super -c "CREATE DATABASE ${NETX_DB_NAME} OWNER ${NETX_DB_USER} ENCODING 'UTF8' TEMPLATE template0"
  fi
}

# search_path = radius, public — necessário pro FreeRADIUS achar radacct/radcheck
# sem prefixo "radius." nas queries default.
postgres_search_path() {
  log_info "Configurando search_path da role ${NETX_DB_USER}"
  psql_super -c "ALTER ROLE ${NETX_DB_USER} SET search_path TO radius, public"
}

postgres_enable_extensions() {
  log_info "Habilitando extensions (pgcrypto, citext)"
  psql_super -d "${NETX_DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"
  psql_super -d "${NETX_DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS citext"
}

# Aplica o schema RADIUS (chamado por netx_app_setup depois do prisma migrate)
postgres_apply_radius_schema() {
  local schema="${NETX_HOME}/apps/core-service/prisma/radius-schema.sql"
  if [[ ! -f "${schema}" ]]; then
    log_error "radius-schema.sql não encontrado em ${schema}"
    exit 1
  fi
  log_info "Aplicando schema RADIUS"
  # PGPASSWORD pq psql -h localhost força md5 auth (peer só funciona pra peer user)
  PGPASSWORD="${NETX_DB_PASSWORD}" psql \
    -h "${NETX_DB_HOST}" -p "${NETX_DB_PORT}" \
    -U "${NETX_DB_USER}" -d "${NETX_DB_NAME}" \
    -v ON_ERROR_STOP=1 \
    -f "${schema}"
  log_ok "Schema RADIUS aplicado"

  # Aplica migration de fix de nullability (idempotente)
  local fix="${NETX_HOME}/apps/core-service/prisma/migrations/fix_radacct_nullability.sql"
  if [[ -f "${fix}" ]]; then
    log_info "Aplicando fix de nullability radacct"
    PGPASSWORD="${NETX_DB_PASSWORD}" psql \
      -h "${NETX_DB_HOST}" -p "${NETX_DB_PORT}" \
      -U "${NETX_DB_USER}" -d "${NETX_DB_NAME}" \
      -v ON_ERROR_STOP=1 \
      -f "${fix}"
  fi
}
