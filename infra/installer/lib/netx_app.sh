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
  netx_app_db_generate   # ANTES do build: core-service importa types de @prisma/client
  netx_app_build
  # Schema RADIUS DEVE existir antes das migrations Prisma — algumas migrations
  # (ex.: 20260509120000_radacct_nullability) referenciam tabelas em `radius.*`.
  # Fresh install sem essa ordem falha com `não existe o esquema "radius"`.
  postgres_apply_radius_schema
  netx_app_db_migrate
  netx_app_seed_baseline
  netx_app_seed_admin
}

netx_app_user() {
  if ! id -u "${NETX_USER}" >/dev/null 2>&1; then
    log_info "Criando system user ${NETX_USER}"
    useradd -r -d "${NETX_HOME}" -s /usr/sbin/nologin "${NETX_USER}"
  else
    log_dim "user ${NETX_USER} já existe"
  fi
  # `/home/netx` precisa existir mesmo com home_dir=/opt/netx. O npm/node
  # resolve `~` via `getpwnam` em alguns caminhos (cache, log) e usa o
  # diretório do passwd, mas algumas chamadas internas do npm assumem
  # `$HOME=/home/$USER` quando rodando via `sudo -u`. Criamos o dir vazio
  # com owner certo pra evitar EACCES em `npm install`.
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0750 "/home/${NETX_USER}"
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0755 "/home/${NETX_USER}/.npm"
}

netx_app_dirs() {
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0755 "${NETX_HOME}"
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0750 "${NETX_LOG}"
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0750 "${NETX_VAR}"
  install -d -o "${NETX_USER}" -g "${NETX_USER}" -m 0750 "${NETX_VAR}/backups"
  install -d -o root           -g "${NETX_USER}" -m 0750 "${NETX_ETC}"
}

netx_app_clone_or_update() {
  # Git 2.35+ recusa repos com "dubious ownership" (UID do dono != UID do
  # processo). Aqui o diretório é do user `netx` mas o installer roda como
  # root, então temos que marcá-lo como safe ANTES de qualquer comando git.
  # Idempotente: `--add` não duplica se já existe.
  git config --global --add safe.directory "${NETX_HOME}" 2>/dev/null || true

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

  # Slug do tenant — bate com a slugify() do seed-admin.ts. Sai pro
  # DEFAULT_TENANT_SLUG do .env pra que o backend resolva o tenant correto
  # quando o frontend não envia tenantSlug no /auth/login (caso comum em
  # uma única instância por ISP).
  export NETX_TENANT_SLUG
  NETX_TENANT_SLUG=$(slugify "${NETX_TENANT_NAME}")

  # CORS origins. Em produção precisamos de origins explícitos — wildcard
  # com credentials=true é vetor de CSRF (gateway recusa boot se vier '*').
  # Incluímos SEMPRE: (i) IP público da máquina (acesso direto enquanto DNS
  # não propaga), (ii) https/http do DOMAIN se setado. Operador pode
  # sobrescrever via env.
  export NETX_CORS_ORIGINS
  local _ip
  _ip=$(detect_public_ip)
  local origins="http://${_ip}"
  if [[ -n "${NETX_DOMAIN:-}" ]]; then
    origins="https://${NETX_DOMAIN},http://${NETX_DOMAIN},${origins}"
  fi
  NETX_CORS_ORIGINS="${origins}"

  # Apikey do Evolution já criada (ou ainda vazia se evolution_setup ainda
  # não rodou). Se vazia agora, vai ser preenchida na próxima execução —
  # o installer é idempotente, render_env roda de novo após evolution_setup
  # se necessário.
  export EVOLUTION_API_KEY
  EVOLUTION_API_KEY=$(secret_get_or_create EVOLUTION_API_KEY 48)

  log_info "Renderizando ${env}"
  render_template "${tmpl}" "${env}" \
    NETX_DATABASE_URL NETX_REDIS_URL NETX_RABBITMQ_URL \
    NETX_JWT_ACCESS_SECRET NETX_JWT_REFRESH_SECRET \
    NETX_PORT_API_GATEWAY NETX_PORT_CORE_SERVICE NETX_PORT_WEB \
    NETX_TENANT_SLUG NETX_CORS_ORIGINS \
    EVOLUTION_API_KEY

  chown root:"${NETX_USER}" "${env}"
  chmod 640 "${env}"

  # Symlink no NETX_HOME pra Prisma e ferramentas que esperam .env na raiz
  ln -sf "${env}" "${NETX_HOME}/.env"
  chown -h "${NETX_USER}:${NETX_USER}" "${NETX_HOME}/.env"
}

netx_app_install() {
  log_info "npm install (esto pode demorar 2-5 min)"
  # Usa `npm ci` se tiver lockfile (mais reprodutível) — senão cai pra
  # `npm install --legacy-peer-deps` que gera o lockfile. Em monorepos novos
  # ou após bump pesado (TW4, Next 16, etc), peer-deps em transição justificam
  # --legacy-peer-deps.
  #
  # `npm_config_yes=true`: defesa em profundidade contra prompts interativos
  # de `npx` (ex.: o script `preinstall` usa `npx only-allow npm` e versões
  # antigas do npx prompts "Ok to proceed?"). Mesmo com `npx --yes` no script,
  # garantimos via env que NENHUM npx aqui pausa esperando stdin.
  if [[ -f "${NETX_HOME}/package-lock.json" ]]; then
    as_netx "cd ${NETX_HOME} && npm_config_yes=true npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund"
  else
    log_warn "package-lock.json ausente — usando 'npm install' (mais lento, gera lockfile)"
    as_netx "cd ${NETX_HOME} && npm_config_yes=true npm install --legacy-peer-deps --no-audit --no-fund"
  fi
  log_ok "Dependências instaladas"
}

netx_app_build() {
  log_info "npm run build (Nx — todos os apps)"
  # IMPORTANTE: carrega o .env ANTES do build. Vars `NEXT_PUBLIC_*` são
  # injetadas no bundle do Next durante build (build-time), não em runtime.
  # Sem isso, frontend ficaria com URLs/CORS errados gravados no JavaScript
  # entregue ao browser, e o operador teria que rebuildar manualmente.
  as_netx "set -a; . /etc/netx/.env; set +a; cd ${NETX_HOME} && npm run build"
  log_ok "Build concluído"
}

netx_app_db_generate() {
  # Gera o `@prisma/client` ANTES do build, senão o `nest build` falha com
  # ~200 erros TS2305/TS2694 ("Module '@prisma/client' has no exported member
  # 'AuditLevel'", etc.) — todos os enums e types derivados do schema só ficam
  # disponíveis após o `prisma generate`. Idempotente: roda toda vez sem efeito
  # colateral.
  log_info "prisma generate (gerando types do schema)"
  as_netx "cd ${NETX_HOME} && npm run -w apps/core-service db:generate"
  log_ok "Prisma client gerado"
}

netx_app_db_migrate() {
  log_info "prisma migrate deploy (aplicando migrations no DB)"
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
  #
  # `dotenv -e ../../.env --` injeta o `.env` raiz (DATABASE_URL, ARGON2_*) no
  # processo, mesmo padrão dos scripts `db:generate`, `db:migrate`, `db:seed`.
  # Sem isso, o Prisma falha com "Environment variable not found: DATABASE_URL".
  as_netx "cd ${NETX_HOME}/apps/core-service && \
    NETX_ADMIN_EMAIL='${NETX_ADMIN_EMAIL}' \
    NETX_ADMIN_PASSWORD='${NETX_ADMIN_PASSWORD}' \
    NETX_TENANT_NAME='${NETX_TENANT_NAME}' \
    NETX_TENANT_COUNTRY='${NETX_TENANT_COUNTRY}' \
    NETX_TENANT_LOCALE='${NETX_TENANT_LOCALE}' \
    NETX_TENANT_CURRENCY='${NETX_TENANT_CURRENCY}' \
    npx dotenv -e ../../.env -- npx ts-node ${INSTALLER_DIR}/scripts/seed-admin.ts"

  touch "${NETX_VAR}/.admin-bootstrapped"
  chown "${NETX_USER}:${NETX_USER}" "${NETX_VAR}/.admin-bootstrapped"
  log_ok "Admin criado"
}
