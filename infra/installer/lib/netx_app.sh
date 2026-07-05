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
  # Schema RADIUS agora está dentro de uma migration Prisma própria
  # (`20260509115000_radius_schema`), que roda ANTES do radacct_nullability.
  # `prisma migrate deploy` cuida da ordem. Sem essa unificação, um
  # `prisma migrate reset` em dev destruía radius.* silenciosamente.
  #
  # Pré-cria dir de snapshot pré-migration ANTES do db:migrate. Sem isso,
  # o wrapper safe-migrate.sh (rodando como user netx) cai no fallback
  # $HOME/.netx-backups porque /var/backups/netx/ é root-owned. Group=netx
  # com mode 0770 dá write pro netx mantendo restrição pra outros users.
  install -d -o root -g "${NETX_USER}" -m 0770 /var/backups/netx /var/backups/netx/pre-migration
  netx_app_db_migrate
  # Fix de ownership do schema radius é defesa em profundidade: as migrations
  # Prisma rodam como user `netx` (dono), então ownership já fica correto.
  # Mas se um install legado tinha radius criado por outro role (ex.: pacote
  # APT freeradius-postgresql), esse helper conserta retroativamente.
  postgres_fix_radius_ownership
  netx_app_seed_baseline
  netx_app_seed_admin
  netx_app_install_update_command
  netx_app_install_radius_check_command
}

# Cria symlink global /usr/local/bin/netx-update apontando pro script no repo.
# Permite ao operador atualizar versões com `sudo netx-update` (sem precisar
# decorar o caminho completo do installer).
netx_app_install_update_command() {
  local target="${NETX_HOME}/infra/installer/scripts/netx-update.sh"
  local link="/usr/local/bin/netx-update"
  if [[ ! -f "${target}" ]]; then
    log_warn "Script netx-update.sh ausente em ${target} — pulando symlink"
    return
  fi
  ln -sf "${target}" "${link}"
  chmod +x "${target}"
  log_dim "Comando 'sudo netx-update' disponível pra updates futuros"
}

# Symlink pra /usr/local/bin/netx-radius-check — auditoria + reconciliação manual
# entre `contracts` e `radius.radcheck`/`radusergroup`. Defesa em profundidade
# contra bugs que esqueçam de enfileirar `radius_event` (ex.: contracts.update()
# que só checava pppoeUsername antes do fix de 2026-05-21).
netx_app_install_radius_check_command() {
  local target="${NETX_HOME}/infra/installer/scripts/netx-radius-check.sh"
  local link="/usr/local/bin/netx-radius-check"
  if [[ ! -f "${target}" ]]; then
    log_warn "Script netx-radius-check.sh ausente em ${target} — pulando symlink"
    return
  fi
  ln -sf "${target}" "${link}"
  chmod +x "${target}"
  log_dim "Comando 'sudo netx-radius-check' disponível (auditoria RADIUS)"
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
    # FETCH_HEAD (tip recém-buscado), não origin/<branch>: o clone é
    # --single-branch, então o ref de tracking de outro branch não existe.
    git -C "${NETX_HOME}" reset --hard FETCH_HEAD
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
  # Secret separado pro Portal do Cliente (defesa em profundidade: audience-
  # confusion attacks). Não compartilha com JWT_ACCESS_SECRET de operador.
  export NETX_PORTAL_JWT_SECRET
  NETX_PORTAL_JWT_SECRET=$(secret_get_or_create NETX_PORTAL_JWT_SECRET 64)

  # KMS master key — AES-256-GCM pra cifrar credenciais API/SSH de equipamentos.
  # 32 bytes = 64 hex chars. NÃO regerar depois (passwords cifrados ficam ilegíveis).
  # IMPORTANTE: usa `secret_get_or_create_hex` em vez de `secret_get_or_create` —
  # o Zod schema (`packages/config/src/index.ts`) exige hex64, e
  # `gen_secret` (base62 alfanumérico) FALHA na validação no boot do core-service.
  export NETX_KMS_MASTER_KEY
  NETX_KMS_MASTER_KEY=$(secret_get_or_create_hex NETX_KMS_MASTER_KEY 64)

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

  # X-Api-Key do WAHA (canal QR). secret_get_or_create é idempotente: o mesmo
  # valor que waha_setup injeta no container é resolvido aqui, independente da
  # ordem dos steps (netx_app roda antes do waha). render_env roda de novo se
  # necessário — o installer é idempotente.
  export WHATSAPP_API_KEY
  WHATSAPP_API_KEY=$(secret_get_or_create WHATSAPP_API_KEY 48)

  # Defaults pra vars que SÓ são setadas em steps opcionais. Sem isso, envsubst
  # deixa o literal `${VAR}` no .env quando o step é pulado, e qualquer source
  # com `set -u` (safe-migrate.sh, systemd EnvironmentFile) quebra.
  : "${NETX_TRACCAR_URL:=}"
  : "${NETX_TRACCAR_TOKEN:=}"
  # Traccar habilitado (flag ou instalado manualmente): gera/reusa o token de
  # serviço AQUI — mesmo segredo que traccar_setup injeta no traccar.xml. Como
  # secret_get_or_create é idempotente, a ordem dos steps (netx_app roda antes
  # do traccar) não importa: ambos resolvem o mesmo valor.
  if [[ "${NETX_ENABLE_TRACCAR:-1}" == "1" || -d /opt/traccar ]]; then
    NETX_TRACCAR_URL="${NETX_TRACCAR_URL:-http://127.0.0.1:8082}"
    NETX_TRACCAR_TOKEN=$(secret_get_or_create TRACCAR_SERVICE_TOKEN 48)
  fi
  export NETX_TRACCAR_URL NETX_TRACCAR_TOKEN
  : "${NETX_MINIO_ENDPOINT:=http://127.0.0.1:9000}"
  : "${NETX_MINIO_PUBLIC_URL:=}"
  : "${NETX_MINIO_BUCKET:=netx-photos}"
  : "${NETX_MINIO_ACCESS_KEY:=}"
  : "${NETX_MINIO_SECRET_KEY:=}"
  export NETX_MINIO_ENDPOINT NETX_MINIO_PUBLIC_URL NETX_MINIO_BUCKET \
         NETX_MINIO_ACCESS_KEY NETX_MINIO_SECRET_KEY

  # IP de gerência — OLTs/NASes apontam syslog/NTP pra este IP (o OltsService
  # usa como fallback quando NETX_OLT_SYSLOG_HOST/NTP_SERVER não são setados).
  # Detectado uma vez; operador pode sobrescrever via env ou editar o .env.
  export NETX_MANAGEMENT_IP
  NETX_MANAGEMENT_IP="${NETX_MANAGEMENT_IP:-$(detect_public_ip)}"

  # Licenciamento (Hub NetX) — OPCIONAL. Vazio por padrão: enrollment é feito
  # depois (Fase 2). Defaults vazios garantem que envsubst escreve linhas
  # limpas (NETX_HUB_URL=) em vez de deixar o literal ${NETX_HUB_URL} no .env
  # — literal que faz o dotenv-expand recursar (auto-referência) e explodir.
  : "${NETX_HUB_URL:=}"
  : "${NETX_LICENSE_KEY:=}"
  : "${NETX_INSTANCE_ID:=}"
  export NETX_HUB_URL NETX_LICENSE_KEY NETX_INSTANCE_ID

  log_info "Renderizando ${env}"
  # CRÍTICO: TODA `${VAR}` que aparece no env.tmpl precisa estar listada aqui.
  # envsubst deixa o literal `${VAR}` no output se a var não for passada — e
  # depois `source .env` com `set -u` (safe-migrate.sh faz isso) explode com
  # "variável não associada". Audita com:
  #   grep -oE '\$\{[A-Z_][A-Z_0-9]*\}' templates/env.tmpl | sort -u
  # Cada var ali tem que aparecer abaixo (e ter um default acima se vier de
  # step opcional como minio/traccar).
  render_template "${tmpl}" "${env}" \
    NETX_DATABASE_URL NETX_REDIS_URL NETX_RABBITMQ_URL \
    NETX_JWT_ACCESS_SECRET NETX_JWT_REFRESH_SECRET NETX_PORTAL_JWT_SECRET NETX_KMS_MASTER_KEY \
    NETX_PORT_API_GATEWAY NETX_PORT_CORE_SERVICE NETX_PORT_WEB NETX_PORT_CWMP \
    NETX_TENANT_SLUG NETX_CORS_ORIGINS \
    NETX_MINIO_ENDPOINT NETX_MINIO_PUBLIC_URL NETX_MINIO_BUCKET \
    NETX_MINIO_ACCESS_KEY NETX_MINIO_SECRET_KEY \
    NETX_TRACCAR_URL NETX_TRACCAR_TOKEN \
    NETX_HUB_URL NETX_LICENSE_KEY NETX_INSTANCE_ID \
    NETX_MANAGEMENT_IP \
    WHATSAPP_API_KEY

  chown root:"${NETX_USER}" "${env}"
  chmod 640 "${env}"

  # Symlink no NETX_HOME pra Prisma e ferramentas que esperam .env na raiz
  ln -sf "${env}" "${NETX_HOME}/.env"
  chown -h "${NETX_USER}:${NETX_USER}" "${NETX_HOME}/.env"
}

netx_app_install() {
  log_info "npm install (esto pode demorar 2-5 min)"
  #
  # CRÍTICO #1 — `NODE_ENV=development` + `--include=dev`:
  # Precisamos das devDependencies (nx, nest, tsc, dotenv-cli, prisma CLI) pra
  # rodar `nx build`. Se o shell já tiver `NODE_ENV=production` (vem do .env do
  # systemd em re-runs), o npm pula devDeps silenciosamente e o build falha.
  #
  # CRÍTICO #2 — `npm ci` SEM `--legacy-peer-deps`:
  # `npm ci` lê o lockfile estritamente — `--legacy-peer-deps` faz ele
  # IGNORAR conflitos e às vezes escolher uma versão **diferente** do lockfile
  # (vimos Next 16 no lockfile virar Next 9.x instalado). `npm ci` puro é
  # garantido reprodutível. `--legacy-peer-deps` fica só pro fallback de
  # `npm install` quando lockfile ausente.
  #
  # CRÍTICO #3 — limpa node_modules antes:
  # Re-runs em estado parcialmente instalado (npm install que falhou no meio,
  # workspaces sem hoist) deixam binários faltando em .bin/. Limpar garante
  # determinismo. ~30s extra mas vale a previsibilidade.
  #
  # `npm_config_yes=true`: defesa contra `npx` prompts interativos
  # (`npx only-allow npm` no preinstall).
  # `npm install` em vez de `npm ci` — sempre regenera lock se necessário.
  # Trade-off: 30s mais lento, mas elimina classe inteira de erros EUSAGE
  # quando alguém esquece de commitar package-lock atualizado.
  log_dim "Limpando node_modules pra garantir reprodutibilidade"
  as_netx "cd ${NETX_HOME} && rm -rf node_modules apps/*/node_modules packages/*/node_modules"
  as_netx "cd ${NETX_HOME} && NODE_ENV=development npm_config_yes=true npm install --include=dev --no-audit --no-fund"

  # Sanity check — binários críticos pra build.
  #
  # Em npm workspaces, deps são hoisted pro root node_modules/ E pros workspaces
  # individuais. Quando há conflito de peer-deps (ex.: @nestjs/cli usado por
  # 3 apps com mesmas versões), npm às vezes deixa o binário SÓ no workspace
  # local em vez de root/.bin/. Pra build via `nx run X:build` que executa
  # `npm run build` dentro do workspace, isso é OK — node resolve via
  # node_modules walker. Então testamos root OR qualquer workspace.
  _has_bin() {
    local bin=$1
    [[ -x "${NETX_HOME}/node_modules/.bin/${bin}" ]] && return 0
    for ws in "${NETX_HOME}/apps"/*/node_modules/.bin/${bin} \
              "${NETX_HOME}/packages"/*/node_modules/.bin/${bin}; do
      [[ -x "${ws}" ]] && return 0
    done
    return 1
  }
  local missing=()
  _has_bin nx     || missing+=("nx")
  _has_bin nest   || missing+=("nest (@nestjs/cli)")
  _has_bin dotenv || missing+=("dotenv-cli")
  _has_bin prisma || missing+=("prisma")
  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Binários ausentes (root nem workspaces): ${missing[*]}"
    log_error "Provavelmente NODE_ENV=production no shell pulou devDeps."
    log_error "Diagnóstico:"
    log_error "  ls ${NETX_HOME}/node_modules/.bin/ | head -20"
    log_error "  ls ${NETX_HOME}/apps/core-service/node_modules/.bin/ 2>/dev/null | head"
    log_error "Tente: NODE_ENV=development npm install --include=dev (manual)"
    exit 1
  fi

  # Sanity check — versão do Next bate com o lockfile (já vi npm install
  # downgrade silencioso pra Next 9.x quando peer-deps colidem).
  # npm workspaces içam deps pro root node_modules/, mas em caso de conflito
  # de peer-deps podem ficar aninhadas em apps/web/node_modules/. Checa os dois.
  local next_pkg=""
  for candidate in \
    "${NETX_HOME}/node_modules/next/package.json" \
    "${NETX_HOME}/apps/web/node_modules/next/package.json"; do
    if [[ -f "$candidate" ]]; then
      next_pkg="$candidate"
      break
    fi
  done
  local next_installed=""
  if [[ -n "$next_pkg" ]]; then
    # `|| true` defende contra pipefail + set -e caso o sed/grep retornem vazio
    next_installed=$(grep '"version"' "$next_pkg" 2>/dev/null \
      | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/' || true)
  fi
  if [[ -z "${next_installed}" ]]; then
    log_warn "Next.js não foi encontrado em node_modules (root nem apps/web)"
  elif [[ "${next_installed%%.*}" -lt 15 ]]; then
    log_error "Next.js ${next_installed} instalado — esperado 15+ (App Router)"
    log_error "Lockfile pede 16.x. Causa típica: --legacy-peer-deps + conflito de peer dep"
    exit 1
  else
    log_dim "Next.js ${next_installed} OK"
  fi

  log_ok "Dependências instaladas (incluindo devDependencies pra build)"
}

netx_app_build() {
  log_info "npm run build (Nx — todos os apps)"
  # IMPORTANTE: carrega o .env ANTES do build. Vars `NEXT_PUBLIC_*` são
  # injetadas no bundle do Next durante build (build-time), não em runtime.
  # Sem isso, frontend ficaria com URLs/CORS errados gravados no JavaScript
  # entregue ao browser, e o operador teria que rebuildar manualmente.
  #
  # `NODE_ENV=production` é obrigatório no build do Next 16: ele respeita
  # NODE_ENV pra precedência de .env.*, vars públicas e dead-code elimination
  # do React. Com NODE_ENV=development, Next 16 emite warning e gera bundle
  # com hints de dev. DevDeps já foram instaladas no passo anterior com
  # --include=dev, então não há risco de "nx pular devDeps" — elas estão
  # em node_modules independente do NODE_ENV no build.
  #
  # `--skip-nx-cache` na primeira build evita o caso "cache válido mas dist
  # vazio" (acontece quando alguém rm -rf'a o dist sem invalidar cache).
  as_netx "set -a; . /etc/netx/.env; set +a; cd ${NETX_HOME} && NODE_ENV=production npm run build -- --skip-nx-cache"

  # Sanity check — confirma que os main.js foram gerados onde esperamos.
  local core_main="${NETX_HOME}/apps/core-service/dist/apps/core-service/src/main.js"
  local gw_main="${NETX_HOME}/apps/api-gateway/dist/apps/api-gateway/src/main.js"
  local cwmp_main="${NETX_HOME}/apps/cwmp-server/dist/apps/cwmp-server/src/main.js"
  local web_build_id="${NETX_HOME}/apps/web/.next/BUILD_ID"
  if [[ ! -f "${core_main}" ]]; then
    log_error "Build do core-service não gerou ${core_main}"
    exit 1
  fi
  if [[ ! -f "${gw_main}" ]]; then
    log_error "Build do api-gateway não gerou ${gw_main}"
    exit 1
  fi
  if [[ -d "${NETX_HOME}/apps/cwmp-server" ]] && [[ ! -f "${cwmp_main}" ]]; then
    log_error "Build do cwmp-server não gerou ${cwmp_main}"
    exit 1
  fi
  if [[ ! -f "${web_build_id}" ]]; then
    log_error "Build do web (Next.js) não gerou .next/BUILD_ID"
    exit 1
  fi

  # Integridade do build do web: o build-manifest.json lista todos os chunks
  # que o Next.js vai pedir em runtime. Se algum desses não existir em disco,
  # o browser pega ChunkLoadError 500 ao carregar a primeira página.
  #
  # Já vi cenários onde build "succeeded" mas alguns chunks faltavam:
  #   - OOM no meio do build (especialmente Turbopack)
  #   - `rm -rf .next` parcial + rebuild incompleto
  #   - Race condition entre build e systemd ler .next
  #
  # Validamos amostralmente — pega 10 chunks aleatórios do manifest e
  # confere existência. Suficiente pra pegar inconsistências sem custo alto.
  local manifest="${NETX_HOME}/apps/web/.next/build-manifest.json"
  if [[ -f "${manifest}" ]]; then
    local missing_chunks
    missing_chunks=$(node -e "
      const m = require('${manifest}');
      const all = new Set();
      const collect = (obj) => {
        if (Array.isArray(obj)) obj.forEach(v => typeof v === 'string' && all.add(v));
        else if (obj && typeof obj === 'object') Object.values(obj).forEach(collect);
      };
      collect(m);
      const fs = require('fs');
      const path = require('path');
      const root = '${NETX_HOME}/apps/web/.next';
      const sample = [...all].slice(0, 50);
      const missing = sample.filter(c => !fs.existsSync(path.join(root, c)));
      if (missing.length) {
        console.error('MISSING:' + missing.slice(0, 5).join(','));
        process.exit(1);
      }
    " 2>&1 || true)
    if [[ "${missing_chunks}" == MISSING:* ]]; then
      log_error "Build do web está INCONSISTENTE — chunks faltando no .next:"
      log_error "  ${missing_chunks#MISSING:}"
      log_error "Possíveis causas: OOM durante build, rebuild interrompido."
      log_error "Fix: rm -rf ${NETX_HOME}/apps/web/.next && rode o installer de novo"
      exit 1
    fi
    log_dim "Build integrity OK — chunks do manifest existem em disco"
  fi

  # Garante ownership/perms dos artefatos pro user netx (runtime).
  # Build roda como netx via as_netx, mas se houver retomada de install antigo
  # com root no meio, isso conserta retroativamente. Sem isso, systemd com
  # User=netx + ProtectSystem=strict não consegue ler chunks de outro owner.
  chown -R "${NETX_USER}:${NETX_USER}" \
    "${NETX_HOME}/apps/web/.next" \
    "${NETX_HOME}/apps/core-service/dist" \
    "${NETX_HOME}/apps/api-gateway/dist" \
    "${NETX_HOME}/apps/cwmp-server/dist" 2>/dev/null || true

  # Restart dos serviços systemd APÓS build — sem isso o systemd continua
  # servindo .next do build anterior em memória, mesmo com chunks novos em
  # disco. Causa ChunkLoadError no browser: HTML novo aponta pra hash A,
  # service em memória só conhece hash B.
  # `is-active` evita warning quando systemd ainda não foi instalado (1º run).
  for svc in netx-core-service netx-api-gateway netx-web; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      log_dim "Restart ${svc} (build novo no disco)"
      systemctl restart "$svc"
    fi
  done

  log_ok "Build concluído (core + gateway + web)"
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
  # Seed canônico — sempre roda. O `prisma/seed.ts` é idempotente:
  # upsert de permissões (por code), upsert de roles (por nome), upsert de
  # tenant default (por slug). Sem duplicação.
  #
  # ATENÇÃO: ANTES esta função tinha guard `.seed-baseline-done` pra rodar
  # uma única vez. Bug de design: quando adicionávamos novas permissões ao
  # seed.ts (ex.: módulo de estoque), installs antigos NUNCA aplicavam as
  # perms novas — usuários ficavam sem ver os menus correspondentes.
  # Mantemos o marker pra compat (re-runs antigos ainda funcionam), mas
  # o seed SEMPRE roda.
  log_info "Rodando seed (permissões, roles, tenant default — idempotente)"
  as_netx "cd ${NETX_HOME} && npm run -w apps/core-service db:seed"
  # Referência nacional de municípios IBGE (módulo de endereços BR). Idempotente
  # e offline (SQL versionado). Base do cadastro de cidades e da NFCom.
  log_info "Rodando seed IBGE (municípios — idempotente, offline)"
  as_netx "cd ${NETX_HOME} && npm run -w apps/core-service db:seed:ibge:sql"
  # Marker mantido só pra debug ("já rodou ao menos 1 vez").
  touch "${NETX_VAR}/.seed-baseline-done"
  chown "${NETX_USER}:${NETX_USER}" "${NETX_VAR}/.seed-baseline-done"
}

# Cria o usuário admin inicial via script Node (argon2 + Prisma upsert).
#
# COMPORTAMENTO DE RE-RUN: por padrão SÓ roda 1x (marca .admin-bootstrapped).
# Em re-runs subsequentes, NÃO toca no admin existente — preserva senhas
# trocadas pelo user via UI, customizações de role, etc.
#
# Pra forçar reset da senha do admin (ex.: esqueci a senha):
#   NETX_ADMIN_RESET=1 sudo bash /opt/netx/infra/installer/install.sh
# Isso sobrescreve passwordHash com o valor de NETX_ADMIN_PASSWORD em .secrets.
netx_app_seed_admin() {
  if [[ -z "${NETX_ADMIN_EMAIL}" || -z "${NETX_ADMIN_PASSWORD}" ]]; then
    log_warn "Admin email/senha vazios — pulando criação de admin"
    return
  fi

  if [[ -f "${NETX_VAR}/.admin-bootstrapped" && "${NETX_ADMIN_RESET:-0}" != "1" ]]; then
    log_dim "Admin já criado em install anterior. Pra resetar senha: NETX_ADMIN_RESET=1 sudo bash install.sh"
    return
  fi

  if [[ "${NETX_ADMIN_RESET:-0}" == "1" ]]; then
    log_warn "NETX_ADMIN_RESET=1 — sobrescrevendo senha do admin ${NETX_ADMIN_EMAIL}"
  else
    log_info "Criando admin ${NETX_ADMIN_EMAIL} no tenant ${NETX_TENANT_NAME}"
  fi

  # Usa um script Node ad-hoc dentro do core-service pra reusar argon2 + Prisma.
  # `dotenv -e ../../.env --` injeta o `.env` raiz (DATABASE_URL, ARGON2_*) no processo.
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
  log_ok "Admin pronto"
}
