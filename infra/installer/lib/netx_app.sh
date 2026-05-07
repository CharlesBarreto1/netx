# shellcheck shell=bash
# =============================================================================
# netx_app.sh — clone/atualiza repo, build, .env, prisma migrate, seed admin
# =============================================================================

netx_app_setup() {
  netx_app_user
  netx_app_dirs
  netx_app_clone_or_update
  netx_app_render_env
  netx_app_install
  netx_app_build
  netx_app_db_migrate
  postgres_apply_radius_schema
  netx_app_seed_baseline
  netx_app_seed_admin
}

netx_app_user() {
  if id -u "${NETX_USER}" >/dev/null 2>&1; then
    log_dim "user ${NETX_USER} já existe"
    return
  fi
  log_info "Criando system user ${NETX_USER}"
  useradd -r -d "${NETX_HOME}" -s /usr/sbin/nologin "${NETX_USER}"
}

netx_app_dirs() {
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0755 "${NETX_HOME}"
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0750 "${NETX_LOG}"
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0750 "${NETX_VAR}"
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0750 "${NETX_VAR}/backups"
  install -d -o root           -g "${NETX_USER}" -m 0750 "${NETX_ETC}"
}

netx_app_clone_or_update() {
  if [[ -d "${NETX_HOME}/.git" ]]; then
    log_info "Atualizando repo (${NETX_REPO_BRANCH})"
    git -C "${NETX_HOME}" fetch --depth=1 origin "${NETX_REPO_BRANCH}"
    git -C "${NETX_HOME}" reset --hard "origin/${NETX_REPO_BRANCH}"
  elif [[ -d "${NETX_HOME}" && -n "$(ls -A "${NETX_HOME}" 2>/dev/null)" ]]; then
    log_dim "Diretório ${NETX_HOME} existe e não é git — assumindo cópia local"
  else
    log_info "Clonando ${NETX_REPO_URL} (${NETX_REPO_BRANCH}) em ${NETX_HOME}"
    git clone --depth=1 --branch "${NETX_REPO_BRANCH}" "${NETX_REPO_URL}" "${NETX_HOME}"
  fi
  chown -R "${NETX_USER}:${NETX_USER}" "${NETX_HOME}"
}

netx_app_render_env() {
  local env="${NETX_ETC}/.env"
  local tmpl="${INSTALLER_DIR}/templates/env.tmpl"

  # Garante segredos JWT (32+ bytes cada)
  export NETX_JWT_ACCESS_SECRET
  NETX_JWT_ACCESS_SECRET=$(secret_get_or_create NETX_JWT_ACCESS_SECRET 64)
  export NETX_JWT_REFRESH_SECRET
  NETX_JWT_REFRESH_SECRET=$(secret_get_or_create NETX_JWT_REFRESH_SECRET 64)

  # Recupera senhas de Postgres/RabbitMQ (já criadas em postgres.sh / rabbitmq.sh)
  export NETX_DB_PASSWORD
  NETX_DB_PASSWORD=$(secret_get_or_create NETX_DB_PASSWORD 32)
  export NETX_RABBIT_PASSWORD
  NETX_RABBIT_PASSWORD=$(secret_get_or_create NETX_RABBIT_PASSWORD 32)

  export NETX_DATABASE_URL="postgresql://${NETX_DB_USER}:${NETX_DB_PASSWORD}@${NETX_DB_HOST}:${NETX_DB_PORT}/${NETX_DB_NAME}?schema=public"
  export NETX_REDIS_URL="${NETX_REDIS_URL:-redis://localhost:6379}"
  export NETX_RABBITMQ_URL="${NETX_RABBITMQ_URL:-amqp://${NETX_RABBIT_USER}:${NETX_RABBIT_PASSWORD}@localhost:5672/${NETX_RABBIT_VHOST}}"

  log_info "Renderizando ${env}"
  render_template "${tmpl}" "${env}" \
    NETX_DATABASE_URL NETX_REDIS_URL NETX_RABBITMQ_URL \
    NETX_JWT_ACCESS_SECRET NETX_JWT_REFRESH_SECRET \
    NETX_PORT_API_GATEWAY NETX_PORT_CORE_SERVICE NETX_PORT_WEB

  chown root:"${NETX_USER}" "${env}"
  chmod 640 "${env}"

  # Symlink no NETX_HOME pra Prisma e ferramentas que esperam .env na raiz
  ln -sf "${env}" "${NETX_HOME}/.env"
  chown -h "${NETX_USER}:${NETX_USER}" "${NETX_HOME}/.env"
}

netx_app_install() {
  log_info "npm install (esto pode demorar 2-5 min)"
  as_netx "cd ${NETX_HOME} && npm ci --prefer-offline --no-audit --no-fund"
  log_ok "Dependências instaladas"
}

netx_app_build() {
  log_info "npm run build (Nx — todos os apps)"
  as_netx "cd ${NETX_HOME} && npm run build"
  log_ok "Build concluído"
}

netx_app_db_migrate() {
  log_info "prisma migrate deploy"
  as_netx "cd ${NETX_HOME} && npm run -w apps/core-service db:generate"
  as_netx "cd ${NETX_HOME} && npm run -w apps/core-service db:migrate:deploy"
  log_ok "Migrações Prisma aplicadas"
}

netx_app_seed_baseline() {
  # Seed de permissões + roles + tenant default + tudo que o seed canônico faz
  if [[ -f "${NETX_VAR}/.seed-baseline-done" ]]; then
    log_dim "Seed baseline já executado anteriormente"
    return
  fi
  log_info "Rodando seed baseline (permissões, roles, tenant default)"
  as_netx "cd ${NETX_HOME} && npm run -w apps/core-service db:seed"
  touch "${NETX_VAR}/.seed-baseline-done"
  chown "${NETX_USER}:${NETX_USER}" "${NETX_VAR}/.seed-baseline-done"
}

# Cria o usuário admin inicial via SQL (independente do seed pra garantir
# senha definida pelo wizard). Usa tabelas Prisma.
netx_app_seed_admin() {
  if [[ -z "${NETX_ADMIN_EMAIL}" || -z "${NETX_ADMIN_PASSWORD}" ]]; then
    log_warn "Admin email/senha vazios — pulando criação de admin"
    return
  fi

  if [[ -f "${NETX_VAR}/.admin-bootstrapped" ]]; then
    log_dim "Admin já bootstrapado anteriormente"
    return
  fi

  log_info "Criando admin ${NETX_ADMIN_EMAIL} no tenant ${NETX_TENANT_NAME}"

  # Usa um script Node ad-hoc dentro do core-service pra reusar argon2 + Prisma.
  # Mais robusto que SQL puro porque respeita os mesmos params de hash do app.
  as_netx "cd ${NETX_HOME}/apps/core-service && \
    NETX_ADMIN_EMAIL='${NETX_ADMIN_EMAIL}' \
    NETX_ADMIN_PASSWORD='${NETX_ADMIN_PASSWORD}' \
    NETX_TENANT_NAME='${NETX_TENANT_NAME}' \
    NETX_TENANT_COUNTRY='${NETX_TENANT_COUNTRY}' \
    NETX_TENANT_LOCALE='${NETX_TENANT_LOCALE}' \
    NETX_TENANT_CURRENCY='${NETX_TENANT_CURRENCY}' \
    npx ts-node ${INSTALLER_DIR}/scripts/seed-admin.ts"

  touch "${NETX_VAR}/.admin-bootstrapped"
  chown "${NETX_USER}:${NETX_USER}" "${NETX_VAR}/.admin-bootstrapped"
  log_ok "Admin criado"
}
