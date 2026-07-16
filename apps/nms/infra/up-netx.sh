#!/usr/bin/env bash
#
# up-netx.sh — sobe a stack do NMS DENTRO do ecossistema NetX (PoC do módulo
# plugável). Gera o .env.netx automaticamente: puxa os segredos do NetX
# (CORE_JWT_SECRET, RabbitMQ) de /etc/netx e gera os do NMS. Idempotente: não
# sobrescreve um .env.netx existente (pra não trocar segredos a cada run).
#
# Uso (na VPS, dentro de apps/nms/infra):
#   sudo bash up-netx.sh
#
# Ver docs/ecosystem/INTEGRATION-RUNBOOK.md §A.
set -euo pipefail
cd "$(dirname "$0")"

SECRETS="${NETX_SECRETS:-/etc/netx/.secrets}"
ENVFILE="${NETX_ENV:-/etc/netx/.env}"
OUT=".env.netx"
COMPOSE="docker-compose.netx.yml"

# Extrai VALOR de KEY=VALOR de um arquivo .env-style (tira aspas).
# Sem pipe (grep|head) de propósito: sob `set -o pipefail`, o head fecharia o
# pipe cedo, o grep levaria SIGPIPE e o script morreria. Usa grep -m1 + || true.
getval() {
  local key="$1" file="$2" line val
  [ -f "$file" ] || { printf ''; return 0; }
  line="$(grep -m1 -E "^${key}=" "$file" 2>/dev/null || true)"
  val="${line#*=}"
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  printf '%s' "$val"
}

# ── Valores DERIVADOS do NetX (recalculados SEMPRE — base da reconciliação) ──
CORE_JWT_SECRET="$(getval JWT_ACCESS_SECRET "$SECRETS")"
[ -z "$CORE_JWT_SECRET" ] && CORE_JWT_SECRET="$(getval JWT_ACCESS_SECRET "$ENVFILE")"

# RabbitMQ do NetX (host bare-metal): o container alcança via host.docker.internal.
RABBIT="$(getval RABBITMQ_URL "$ENVFILE")"
if [ -n "$RABBIT" ]; then
  RABBIT_CT="$(printf '%s' "$RABBIT" | sed -E 's#@(localhost|127\.0\.0\.1)([:/])#@host.docker.internal\2#')"
else
  RABBIT_CT="amqp://guest:guest@host.docker.internal:5672"
fi

# Canal 4 (IA): URL pública do NetX (nginx→gateway; a 443 já está no ar). Deriva
# do API_GATEWAY_CORS_ORIGINS PREFERINDO uma origem https:// (domínio público). A
# 1ª origem pode ser um IP/http cru que o nginx não serve (→ 404 na chamada ao
# core). awk (não grep|head) pra evitar SIGPIPE sob pipefail.
CORE_API="$(getval API_GATEWAY_CORS_ORIGINS "$ENVFILE" | awk -F, '{for(i=1;i<=NF;i++) if($i ~ /^https:\/\//){print $i; exit}}')"
[ -z "$CORE_API" ] && CORE_API="$(getval EFI_PUBLIC_WEBHOOK_BASE "$ENVFILE" | sed -E 's#/api/v1/?$##')"
[ -z "$CORE_API" ] && CORE_API="$(getval API_GATEWAY_CORS_ORIGINS "$ENVFILE" | cut -d, -f1)"
[ -z "$CORE_API" ] && CORE_API="https://CHANGE-ME"

# Adiciona KEY=VALUE ao $OUT só se a KEY ainda não existir (não clobbera manual/segredo).
ensure_kv() { grep -qE "^$1=" "$OUT" 2>/dev/null || printf '%s=%s\n' "$1" "$2" >> "$OUT"; }
# Seta/ATUALIZA a KEY pro valor derivado (upsert) — pra valores não-secretos que
# devem rastrear o NetX (ex.: CORE_API_URL), auto-corrigindo valor stale/errado.
upsert_kv() {
  if grep -qE "^$1=" "$OUT" 2>/dev/null; then sed -i -E "s#^$1=.*#$1=$2#" "$OUT"; else printf '%s=%s\n' "$1" "$2" >> "$OUT"; fi
}

if [ -f "$OUT" ]; then
  # IDEMPOTENTE: preserva segredos/customizações e só INJETA chaves novas que
  # faltarem (ex.: CORE_API_URL num install anterior à IA delegada). É o que faz
  # `netx-update` (passo 11) convergir installs antigos SEM regenerar segredo.
  echo "[nms] $OUT já existe — reconciliando chaves derivadas do NetX (segredos preservados)."
  ensure_kv CORE_JWT_SECRET "$CORE_JWT_SECRET"
  ensure_kv CORE_JWT_ISSUER netx
  ensure_kv CORE_JWT_AUDIENCE netx-api
  ensure_kv RABBITMQ_URL "$RABBIT_CT"
  ensure_kv EVENTBUS_CONSUME true
  ensure_kv EVENTBUS_EXCHANGE netx.events
  # upsert (não ensure): CORE_API_URL é derivado e não-secreto — auto-corrige um
  # valor stale/errado (ex.: IP http de uma derivação antiga) rumo à origem https.
  upsert_kv CORE_API_URL "$CORE_API"
else
  echo "[nms] gerando $OUT a partir dos segredos do NetX…"
  [ -z "$CORE_JWT_SECRET" ] && echo "[nms] AVISO: JWT_ACCESS_SECRET do Core não encontrado — SSO inativo até preencher CORE_JWT_SECRET em $OUT."
  [ "$CORE_API" = "https://CHANGE-ME" ] && echo "[nms] AVISO: URL pública do NetX não encontrada — IA indisponível até preencher CORE_API_URL em $OUT."

  umask 077
  cat > "$OUT" <<EOF
# Gerado por up-netx.sh — NÃO commitar. Segredos do NMS gerados; integração puxada do NetX.
POSTGRES_USER=netx
POSTGRES_PASSWORD=$(openssl rand -hex 16)
POSTGRES_DB=netx_nms

JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
# device-gateway/crypto.py espera base64 de 32 bytes (AES-256), NÃO hex —
# hex-64 decodifica em 48 bytes e crasha o gateway ("chave-mestra deve ter 32 bytes").
MASTER_KEY=$(openssl rand -base64 32 | tr -d '\n')
ADMIN_USERNAME=admin
ADMIN_PASSWORD=

# Canal 1 (SSO) — puxado do Core
CORE_JWT_SECRET=${CORE_JWT_SECRET}
CORE_JWT_ISSUER=netx
CORE_JWT_AUDIENCE=netx-api

# Canal 3 (eventos) — RabbitMQ do NetX via host
RABBITMQ_URL=${RABBIT_CT}
EVENTBUS_CONSUME=true
EVENTBUS_EXCHANGE=netx.events

# Portas
NMS_API_PORT=3300
WEB_PORT=8088
TRAP_PORT=162

# Canal 4 (IA) — delegada ao motor de IA do NetX (URL pública, nginx→gateway). O
# copiloto do NMS NÃO tem chave própria: a IA sai da config do tenant no NetX
# (Configurações › IA), agnóstica de provider. Sem chave à parte pra manter.
CORE_API_URL=${CORE_API}
EOF
  chmod 600 "$OUT"
  echo "[nms] $OUT criado (chmod 600)."
fi

echo "[nms] subindo a stack (build local — primeira vez demora: compila Node + libs Python)…"
docker compose -f "$COMPOSE" --env-file "$OUT" up -d --build

echo ""
echo "[nms] estado:"
docker compose -f "$COMPOSE" --env-file "$OUT" ps
echo ""
echo "[nms] pronto. Próximo: validar os canais —"
echo "  UI NMS:        http://<ip>:$(getval WEB_PORT "$OUT" 2>/dev/null || echo 8088)"
echo "  health /nms:   curl -s http://localhost:3000/api/v1/nms/health"
echo "  logs da api:   docker compose -f $COMPOSE --env-file $OUT logs -f api"
