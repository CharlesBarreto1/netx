# shellcheck shell=bash
# =============================================================================
# packages.sh — instala pacotes APT (postgres 16 via PGDG, node 20 via NodeSource)
# =============================================================================

packages_install() {
  packages_apt_update
  packages_pgdg_repo
  packages_nodesource_repo
  packages_apt_install
  packages_npm_globals
}

packages_apt_update() {
  log_info "apt update"
  apt-get update -qq
}

# Adiciona repositório oficial do PostgreSQL Global Development Group.
# Debian 13 (Trixie) por default ship com PG 17, mas o NetX foi homologado
# em PG 16. PGDG mantém todas as versões em paralelo.
packages_pgdg_repo() {
  local list=/etc/apt/sources.list.d/pgdg.list
  if [[ -f "${list}" ]]; then
    log_dim "Repositório PGDG já configurado"
    return 0
  fi

  log_info "Adicionando repositório PostgreSQL (PGDG)"
  apt-get install -y -qq lsb-release gnupg
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /etc/apt/keyrings/pgdg.gpg
  local codename
  codename=$(lsb_release -cs)
  # PGDG ainda não tem repo "trixie" estável em alguns mirrors — fallback pra bookworm.
  if ! curl -fsI "https://apt.postgresql.org/pub/repos/apt/dists/${codename}-pgdg/Release" >/dev/null 2>&1; then
    log_warn "PGDG sem ${codename}-pgdg ainda; usando bookworm-pgdg como fallback"
    codename=bookworm
  fi
  echo "deb [signed-by=/etc/apt/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt/ ${codename}-pgdg main" \
    > "${list}"
  apt-get update -qq
}

# Node 20 LTS via NodeSource (Debian 13 ainda pode shipar Node 18)
packages_nodesource_repo() {
  if command -v node >/dev/null 2>&1; then
    local current
    current=$(node -v | sed 's/^v//' | cut -d. -f1)
    if (( current >= 20 )); then
      log_dim "Node ${current} já instalado"
      return 0
    fi
    log_warn "Node ${current} encontrado — substituindo por Node 20 (NodeSource)"
  fi

  local list=/etc/apt/sources.list.d/nodesource.list
  if [[ ! -f "${list}" ]]; then
    log_info "Adicionando repositório NodeSource (Node 20)"
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
      > "${list}"
    apt-get update -qq
  fi
}

packages_apt_install() {
  log_info "Instalando pacotes APT (postgres, redis, rabbitmq, freeradius, nginx, node, etc)"
  apt-get install -y -qq \
    postgresql-16 \
    postgresql-client-16 \
    postgresql-contrib-16 \
    redis-server \
    rabbitmq-server \
    freeradius \
    freeradius-postgresql \
    freeradius-utils \
    nginx \
    nodejs \
    git \
    build-essential \
    python3 \
    pkg-config \
    jq \
    whiptail \
    gettext-base \
    sudo \
    rsync \
    cron \
    logrotate \
    fail2ban \
    ufw

  log_ok "Pacotes instalados"
}

packages_npm_globals() {
  # NetX usa npm como package manager (workspaces). Garante npm>=10.
  local npm_v
  npm_v=$(npm -v 2>/dev/null | cut -d. -f1) || npm_v=0
  if (( npm_v < 10 )); then
    log_info "Atualizando npm para 10+"
    npm install -g npm@10
  fi
  log_ok "npm $(npm -v)"
}
