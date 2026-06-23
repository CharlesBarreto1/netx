#!/usr/bin/env bash
# NetX NMS — instalador automatizado (on-prem, por cliente).
#
# Uso típico (uma linha):
#   curl -fsSL https://raw.githubusercontent.com/CharlesBarreto1/NetX-NMS/main/scripts/install.sh | bash
#
# Variáveis de ambiente (todas opcionais):
#   NETX_DIR        diretório de instalação (default: /opt/netx-nms)
#   NETX_VERSION    versão a instalar: vX.Y.Z ou "latest" (default: latest)
#   NETX_REPO       owner/repo no GitHub (default: CharlesBarreto1/NetX-NMS)
#   GITHUB_TOKEN    token (necessário só se o repo/release for privado)
#   WEB_PORT        porta HTTP do painel (default: 8080)
#
# O que faz: baixa o bundle de deploy versionado, gera segredos aleatórios no .env (se ainda
# não existir), puxa as imagens do GHCR, sobe a stack e espera a API ficar saudável.
set -euo pipefail

NETX_DIR="${NETX_DIR:-/opt/netx-nms}"
NETX_VERSION="${NETX_VERSION:-latest}"
NETX_REPO="${NETX_REPO:-CharlesBarreto1/NetX-NMS}"
WEB_PORT="${WEB_PORT:-8080}"

log()  { printf '\033[36m[netx-nms]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[netx-nms]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[netx-nms] ERRO:\033[0m %s\n' "$*" >&2; exit 1; }

# ── 0. Privilégio e confirmação ──────────────────────────────────────────────
# Comandos privilegiados (apt, docker, escrita em /opt) passam por $SUDO ("" se já for root).
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "Rode como root, ou instale o sudo (preciso de privilégio para instalar o Docker e escrever em $NETX_DIR)."
  SUDO="sudo"
fi

confirm() { # pergunta sim/não; em pipe (curl|bash) lê de /dev/tty, ou aceita NETX_YES=1
  [ "${NETX_YES:-}" = "1" ] && return 0
  if [ -r /dev/tty ]; then
    local ans; printf '%s [s/N] ' "$1" >/dev/tty; read -r ans </dev/tty
    case "$ans" in [sSyY]*) return 0 ;; *) return 1 ;; esac
  fi
  die "Confirmação necessária mas a entrada não é interativa. Rode num terminal ou passe NETX_YES=1."
}

install_docker_debian() { # repo oficial da Docker (Debian/Ubuntu, inclui Trixie)
  . /etc/os-release 2>/dev/null || die "Não consegui ler /etc/os-release."
  case "${ID:-}" in debian | ubuntu) : ;; *)
    die "Auto-instalação do Docker só é suportada em Debian/Ubuntu (detectado: ${ID:-?}). Instale o Docker manualmente." ;;
  esac
  [ -n "${VERSION_CODENAME:-}" ] || die "Não detectei o codinome do SO (VERSION_CODENAME)."
  log "Instalando Docker Engine + Compose (repo oficial, $ID $VERSION_CODENAME)…"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq ca-certificates curl
  $SUDO install -m 0755 -d /etc/apt/keyrings
  $SUDO curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  $SUDO chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO systemctl enable --now docker
}

# ── 1. Pré-requisitos ────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker não encontrado."
  if command -v apt-get >/dev/null 2>&1; then
    confirm "Instalar o Docker Engine + Compose agora (repo oficial via apt)?" \
      && install_docker_debian || die "Docker é necessário. Instale-o e rode de novo."
  else
    die "Docker não encontrado e este SO não usa apt. Instale o Docker Engine manualmente."
  fi
fi
command -v docker >/dev/null 2>&1 || die "Docker indisponível mesmo após a instalação."

if $SUDO docker compose version >/dev/null 2>&1; then
  DC="$SUDO docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="$SUDO docker-compose"
else
  die "Docker Compose (v2) não encontrado (instale o docker-compose-plugin)."
fi

# Daemon no ar? Tenta iniciar antes de desistir.
if ! $SUDO docker info >/dev/null 2>&1; then
  $SUDO systemctl start docker >/dev/null 2>&1 || true
  $SUDO docker info >/dev/null 2>&1 || die "Docker instalado mas o daemon não respondeu."
fi

gen_secret() { # bytes -> base64 url-safe sem padding
  if command -v openssl >/dev/null 2>&1; then openssl rand -base64 "${1:-32}" | tr -d '\n=' | tr '+/' '-_'
  else head -c "${1:-32}" /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_'; fi
}

# ── 2. Obter os arquivos de deploy ───────────────────────────────────────────
# Modo local: rodando de dentro de um checkout do repo (testes / air-gapped).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
LOCAL_INFRA=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../infra/docker-compose.prod.yml" ]; then
  LOCAL_INFRA="$(cd "$SCRIPT_DIR/.." && pwd)/infra"
fi

log "Instalando em: $NETX_DIR"
$SUDO mkdir -p "$NETX_DIR"
# Se rodando via sudo, passa a posse ao usuário para as escritas seguintes (.env, configs).
[ -n "$SUDO" ] && $SUDO chown "$(id -u):$(id -g)" "$NETX_DIR"

if [ -n "$LOCAL_INFRA" ]; then
  log "Usando arquivos locais do repo ($LOCAL_INFRA)"
  cp "$LOCAL_INFRA/docker-compose.prod.yml" "$NETX_DIR/docker-compose.yml"
  cp "$LOCAL_INFRA/.env.prod.example"      "$NETX_DIR/.env.example"
  cp -r "$LOCAL_INFRA/initdb"              "$NETX_DIR/initdb"
  mkdir -p "$NETX_DIR/telegraf"
  cp "$LOCAL_INFRA/telegraf/telegraf.prod.conf" "$NETX_DIR/telegraf/telegraf.prod.conf"
  cp "$SCRIPT_DIR/update.sh" "$NETX_DIR/update.sh" 2>/dev/null || true
  RESOLVED_TAG="${NETX_VERSION}"
else
  # Modo download: baixa o bundle do Release no GitHub.
  command -v curl >/dev/null 2>&1 || die "curl é necessário para baixar o bundle."
  command -v tar  >/dev/null 2>&1 || die "tar é necessário para extrair o bundle."
  AUTH=(); [ -n "${GITHUB_TOKEN:-}" ] && AUTH=(-H "Authorization: token ${GITHUB_TOKEN}")

  if [ "$NETX_VERSION" = "latest" ]; then
    log "Resolvendo última release de $NETX_REPO…"
    RESOLVED_TAG="$(curl -fsSL "${AUTH[@]}" \
      "https://api.github.com/repos/${NETX_REPO}/releases/latest" \
      | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
    [ -n "$RESOLVED_TAG" ] || die "Não consegui resolver a última release (repo privado? defina GITHUB_TOKEN)."
  else
    RESOLVED_TAG="$NETX_VERSION"
  fi
  log "Baixando bundle $RESOLVED_TAG…"
  URL="https://github.com/${NETX_REPO}/releases/download/${RESOLVED_TAG}/netx-nms-stack.tar.gz"
  TMP="$(mktemp -d)"
  curl -fL "${AUTH[@]}" -o "$TMP/stack.tgz" "$URL" || die "Falha ao baixar $URL"
  tar -C "$TMP" -xzf "$TMP/stack.tgz"
  cp -r "$TMP/netx-nms/." "$NETX_DIR/"
  rm -rf "$TMP"
fi

# ── 3. Gerar .env com segredos (idempotente: não sobrescreve se já existir) ───
cd "$NETX_DIR"
if [ -f .env ]; then
  warn ".env já existe — preservando segredos atuais (instalação/upgrade)."
else
  log "Gerando .env com segredos aleatórios…"
  cp .env.example .env
  PG_PWD="$(gen_secret 24)"
  JWT="$(gen_secret 48)"
  MK="$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)"
  ADMIN_PWD="$(gen_secret 12)"
  TAG="$RESOLVED_TAG"; [ "$TAG" = "latest" ] && TAG="latest"

  set_kv() { # chave valor — substitui a linha KEY=... no .env
    local k="$1" v="$2"
    # escapa & e / para o sed
    local esc; esc="$(printf '%s' "$v" | sed -e 's/[&/\]/\\&/g')"
    if grep -q "^${k}=" .env; then sed -i.bak -E "s|^${k}=.*|${k}=${esc}|" .env && rm -f .env.bak
    else printf '%s=%s\n' "$k" "$v" >> .env; fi
  }
  set_kv POSTGRES_PASSWORD "$PG_PWD"
  set_kv JWT_SECRET        "$JWT"
  set_kv MASTER_KEY        "$MK"
  set_kv ADMIN_PASSWORD    "$ADMIN_PWD"
  set_kv IMAGE_TAG         "$TAG"
  set_kv WEB_PORT          "$WEB_PORT"
  chmod 600 .env
  GENERATED_ADMIN="$ADMIN_PWD"
fi

# ── 4. Subir a stack ─────────────────────────────────────────────────────────
log "Puxando imagens do GHCR…"
$DC --env-file .env -f docker-compose.yml pull
log "Subindo serviços…"
$DC --env-file .env -f docker-compose.yml up -d

# ── 5. Esperar a API ficar saudável ──────────────────────────────────────────
log "Aguardando a API ficar saudável…"
OK=""
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 3
done

echo
if [ -n "$OK" ]; then
  log "✅ NetX NMS no ar:  http://localhost:${WEB_PORT}"
else
  warn "A stack subiu mas a API ainda não respondeu. Veja: cd $NETX_DIR && $DC logs -f api"
fi
ADMIN_USER="$(grep -E '^ADMIN_USERNAME=' .env | cut -d= -f2-)"; ADMIN_USER="${ADMIN_USER:-admin}"
if [ -n "${GENERATED_ADMIN:-}" ]; then
  echo
  log "Credenciais do admin inicial (guarde — mostradas só agora):"
  printf '      usuário: %s\n      senha:   %s\n' "$ADMIN_USER" "$GENERATED_ADMIN"
else
  log "Admin já configurado anteriormente (ADMIN_PASSWORD no .env / log da API)."
fi
echo
log "Gerência: cd $NETX_DIR  (logs: $DC logs -f | atualizar: ./update.sh)"
