#!/usr/bin/env bash
# NetX NMS — atualizador automatizado. Roda do diretório de instalação (ou passe NETX_DIR).
#
# Uso:
#   ./update.sh            # atualiza para a última release
#   ./update.sh v1.4.0     # atualiza para uma versão específica
#
# Variáveis: NETX_DIR, NETX_REPO, GITHUB_TOKEN (privado), NETX_VERSION (=$1).
#
# Fluxo: resolve a versão alvo → backup do banco → atualiza arquivos de deploy (preserva .env)
# → puxa imagens → up -d (a API roda `prisma migrate deploy` no boot) → healthcheck.
# Em falha de saúde, faz ROLLBACK da tag das imagens automaticamente.
set -euo pipefail

NETX_DIR="${NETX_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"
NETX_REPO="${NETX_REPO:-CharlesBarreto1/NetX-NMS}"
NETX_VERSION="${1:-${NETX_VERSION:-latest}}"

log()  { printf '\033[36m[update]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[update]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[update] ERRO:\033[0m %s\n' "$*" >&2; exit 1; }

cd "$NETX_DIR"
[ -f .env ] || die "Não achei .env em $NETX_DIR. Rode no diretório de instalação ou defina NETX_DIR."
[ -f docker-compose.yml ] || die "Não achei docker-compose.yml em $NETX_DIR."

# Privilégio: prefixa o docker com sudo se não for root e o usuário não estiver no grupo docker.
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
DOCKER=($SUDO docker)
if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  DC="$SUDO docker compose"
  COMPOSE=("${DOCKER[@]}" compose --env-file .env -f docker-compose.yml)
else
  DC="$SUDO docker-compose"
  COMPOSE=($SUDO docker-compose --env-file .env -f docker-compose.yml)
fi

get_kv() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
set_tag() { sed -i.bak -E "s|^IMAGE_TAG=.*|IMAGE_TAG=$1|" .env && rm -f .env.bak; }

PREV_TAG="$(get_kv IMAGE_TAG)"; PREV_TAG="${PREV_TAG:-latest}"
WEB_PORT="$(get_kv WEB_PORT)"; WEB_PORT="${WEB_PORT:-8080}"

# ── 1. Resolver versão alvo ──────────────────────────────────────────────────
AUTH=(); [ -n "${GITHUB_TOKEN:-}" ] && AUTH=(-H "Authorization: token ${GITHUB_TOKEN}")
if [ "$NETX_VERSION" = "latest" ]; then
  log "Resolvendo última release de $NETX_REPO…"
  NEW_TAG="$(curl -fsSL "${AUTH[@]}" "https://api.github.com/repos/${NETX_REPO}/releases/latest" \
    | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
  [ -n "$NEW_TAG" ] || die "Não consegui resolver a última release (privado? defina GITHUB_TOKEN)."
else
  NEW_TAG="$NETX_VERSION"
fi

log "Versão atual: $PREV_TAG  →  alvo: $NEW_TAG"
if [ "$NEW_TAG" = "$PREV_TAG" ]; then
  log "Já está em $NEW_TAG. Nada a fazer (use ./update.sh <versão> para forçar outra)."
  exit 0
fi

# ── 2. Backup do banco (best-effort) ─────────────────────────────────────────
mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo manual)"
PG_USER="$(get_kv POSTGRES_USER)"; PG_DB="$(get_kv POSTGRES_DB)"
log "Backup do banco em backups/db-${STAMP}.sql.gz…"
if "${COMPOSE[@]}" exec -T timescaledb pg_dump -U "${PG_USER:-netx}" "${PG_DB:-netx_nms}" \
     | gzip > "backups/db-${STAMP}.sql.gz" 2>/dev/null; then
  log "Backup OK."
else
  warn "Não consegui fazer backup do banco (banco no ar?). Continuando assim mesmo."
  rm -f "backups/db-${STAMP}.sql.gz"
fi

# ── 3. Atualizar arquivos de deploy (preservando .env) ───────────────────────
# A estrutura do compose pode mudar entre versões; trazemos o bundle novo, exceto o .env.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
LOCAL_INFRA=""
if [ -f "$SCRIPT_DIR/../infra/docker-compose.prod.yml" ]; then
  LOCAL_INFRA="$(cd "$SCRIPT_DIR/.." && pwd)/infra"
fi
if [ -n "$LOCAL_INFRA" ]; then
  log "Atualizando arquivos de deploy a partir do repo local…"
  cp "$LOCAL_INFRA/docker-compose.prod.yml" docker-compose.yml
  cp "$LOCAL_INFRA/telegraf/telegraf.prod.conf" telegraf/telegraf.prod.conf 2>/dev/null || true
elif command -v curl >/dev/null 2>&1; then
  log "Baixando bundle $NEW_TAG…"
  TMP="$(mktemp -d)"
  if curl -fL "${AUTH[@]}" -o "$TMP/stack.tgz" \
       "https://github.com/${NETX_REPO}/releases/download/${NEW_TAG}/netx-nms-stack.tar.gz"; then
    tar -C "$TMP" -xzf "$TMP/stack.tgz"
    cp "$TMP/netx-nms/docker-compose.yml" docker-compose.yml
    cp -r "$TMP/netx-nms/initdb" . 2>/dev/null || true
    cp "$TMP/netx-nms/telegraf/telegraf.prod.conf" telegraf/telegraf.prod.conf 2>/dev/null || true
    cp "$TMP/netx-nms/update.sh" update.sh.new 2>/dev/null || true # aplicado no próximo run
    chmod +x update.sh.new 2>/dev/null || true
  else
    warn "Não baixei o bundle; mantendo o compose atual e só trocando a tag das imagens."
  fi
  rm -rf "$TMP"
fi

# ── 4. Aplicar nova versão ───────────────────────────────────────────────────
set_tag "$NEW_TAG"
log "Puxando imagens $NEW_TAG…"
"${COMPOSE[@]}" pull
log "Aplicando (up -d; a API roda as migrations no boot)…"
"${COMPOSE[@]}" up -d

# ── 5. Healthcheck + rollback automático ─────────────────────────────────────
log "Verificando saúde da API…"
OK=""
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 3
done

if [ -n "$OK" ]; then
  [ -f update.sh.new ] && mv update.sh.new update.sh
  log "✅ Atualizado para $NEW_TAG. (backup do banco em backups/db-${STAMP}.sql.gz)"
else
  warn "API não ficou saudável em $NEW_TAG. Fazendo ROLLBACK para $PREV_TAG…"
  rm -f update.sh.new
  set_tag "$PREV_TAG"
  "${COMPOSE[@]}" up -d
  die "Rollback feito para $PREV_TAG. Investigue: $DC logs api  (backup: backups/db-${STAMP}.sql.gz)"
fi
