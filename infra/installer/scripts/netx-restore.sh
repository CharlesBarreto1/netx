#!/usr/bin/env bash
# =============================================================================
# netx-restore.sh — restaura um bundle DR (.tar.age): core + NMS + segredos.
# Roda como ROOT. Precisa da chave privada age do operador pra decifrar.
#   uso: sudo netx-restore.sh <bundle.tar.age> [--identity /etc/netx/dr-operator.key]
# Destrutivo: recria os bancos. Faz snapshot do core antes.
# =============================================================================
set -Eeuo pipefail

BUNDLE="${1:?uso: netx-restore.sh <bundle.tar.age> [--identity key]}"; shift || true
IDENTITY="${NETX_DR_AGE_IDENTITY:-/etc/netx/dr-operator.key}"
while [[ $# -gt 0 ]]; do case "$1" in --identity) IDENTITY="${2:?}"; shift 2;; *) shift;; esac; done

NETX_ETC="${NETX_ETC:-/etc/netx}"; NETX_HOME="${NETX_HOME:-/opt/netx}"
NMS_INFRA="$NETX_HOME/apps/nms/infra"; NMS_ENV="$NMS_INFRA/.env.netx"
NMS_COMPOSE="$NMS_INFRA/docker-compose.netx.yml"
SERVICES="netx-core-service netx-api-gateway netx-web netx-cwmp-server"
PG_DUMP_BIN="${PG_DUMP_BIN:-/usr/lib/postgresql/16/bin/pg_dump}"; [[ -x "$PG_DUMP_BIN" ]] || PG_DUMP_BIN=pg_dump

log(){ echo "[restore] $*"; }
[[ $EUID -eq 0 ]] || { echo root only; exit 1; }
[[ -f "$BUNDLE" ]]   || { echo "bundle nao existe: $BUNDLE"; exit 1; }
[[ -f "$IDENTITY" ]] || { echo "chave age nao existe: $IDENTITY"; exit 1; }
command -v age >/dev/null || { echo "age nao instalado"; exit 1; }
getval(){ grep -m1 -E "^$1=" "$2" 2>/dev/null | cut -d= -f2- || true; }

WORK="$(mktemp -d)"; chmod 700 "$WORK"
cleanup(){ find "$WORK" -type f -exec shred -u {} + 2>/dev/null||true; rm -rf "$WORK"; }
trap cleanup EXIT

log "1) decifra + extrai bundle"
age -d -i "$IDENTITY" "$BUNDLE" | tar -C "$WORK" -xf -
[[ -f "$WORK/core.dump" && -f "$WORK/secrets.env" ]] || { echo "bundle invalido (falta core.dump/secrets.env)"; exit 1; }
SEC="$WORK/secrets.env"

log "2) para serviços do core"
systemctl stop $SERVICES 2>/dev/null || true

log "3) aplica segredos portáveis no $NETX_ETC/.env"
cp -a "$NETX_ETC/.env" "/root/.env.bak.dr.$(date +%s)"
apply_env(){ local k="$1" v; v="$(getval "$k" "$SEC")"; [[ -z "$v" ]] && return 0
  if grep -q "^$k=" "$NETX_ETC/.env"; then sed -i "s|^$k=.*|$k=$v|" "$NETX_ETC/.env"; else echo "$k=$v" >> "$NETX_ETC/.env"; fi; }
for k in KMS_MASTER_KEY JWT_ACCESS_SECRET JWT_REFRESH_SECRET PORTAL_JWT_SECRET DEFAULT_TENANT_SLUG; do apply_env "$k"; done

log "4) restaura core DB"
DB_NAME="$(getval DATABASE_URL "$NETX_ETC/.env" | sed -E 's|.*/([^/?]+)(\?.*)?$|\1|')"; DB_NAME="${DB_NAME:-netx}"
PW="$(getval NETX_DB_PASSWORD "$NETX_ETC/.secrets")"
mkdir -p /var/backups/netx
sudo -u postgres "$PG_DUMP_BIN" -Fc "$DB_NAME" > "/var/backups/netx/pre-restore-$(date +%Y%m%dT%H%M%S).dump" 2>/dev/null \
  && log "   snapshot do core ok" || log "   (snapshot falhou/DB vazio — seguindo)"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME' AND pid<>pg_backend_pid();
DROP DATABASE IF EXISTS $DB_NAME;
CREATE DATABASE $DB_NAME OWNER netx ENCODING 'UTF8' TEMPLATE template0;
SQL
for ext in pgcrypto citext postgis pg_trgm uuid-ossp; do sudo -u postgres psql -q -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS \"$ext\""; done
PGPASSWORD="$PW" pg_restore -h 127.0.0.1 -U netx -d "$DB_NAME" --no-owner --no-acl -j2 "$WORK/core.dump" 2>/tmp/dr-core.err || true
CORE_ERR="$(grep -iE 'error:' /tmp/dr-core.err | grep -viE 'must be owner of extension|COMMENT ON EXTENSION|spatial_ref_sys' || true)"
[[ -n "$CORE_ERR" ]] && { log "   !! erros core:"; echo "$CORE_ERR" | head -10; } || log "   core restore ok (só ruído benigno)"

log "5) migrate deploy (forward)"
sudo -u netx -H bash -lc "cd $NETX_HOME && set -a; . $NETX_ETC/.env; set +a; npm run -w apps/core-service db:migrate:raw" 2>&1 | tail -4

# ---- NMS ----
if [[ -f "$WORK/nms.dump" && -f "$NMS_ENV" && -f "$NMS_COMPOSE" ]] && command -v docker >/dev/null; then
  log "6) NMS: aplica segredos no .env.netx"
  cp -a "$NMS_ENV" "/root/.env.netx.bak.dr.$(date +%s)"
  set_nms(){ local dst="$1" v; v="$(getval "$2" "$SEC")"; [[ -z "$v" ]] && return 0
    if grep -q "^$dst=" "$NMS_ENV"; then sed -i "s|^$dst=.*|$dst=$v|" "$NMS_ENV"; else echo "$dst=$v" >> "$NMS_ENV"; fi; }
  set_nms MASTER_KEY NMS_MASTER_KEY; set_nms JWT_SECRET NMS_JWT_SECRET; set_nms CORE_JWT_SECRET NMS_CORE_JWT_SECRET
  NMS_DB="$(getval POSTGRES_DB "$NMS_ENV")"; NMS_DB="${NMS_DB:-netx_nms}"
  NMS_USER="$(getval POSTGRES_USER "$NMS_ENV")"; NMS_USER="${NMS_USER:-netx}"

  log "6b) sobe só o timescaledb; para consumidores (api/gateway/telegraf)"
  ( cd "$NMS_INFRA" && docker compose -f "$NMS_COMPOSE" --env-file .env.netx up -d timescaledb >/dev/null 2>&1 || true )
  ( cd "$NMS_INFRA" && docker compose -f "$NMS_COMPOSE" --env-file .env.netx stop api device-gateway telegraf web >/dev/null 2>&1 || true )
  CT="$(docker ps --filter name=timescaledb --format '{{.Names}}' | head -1)"
  for i in $(seq 1 30); do docker exec "$CT" pg_isready -U "$NMS_USER" >/dev/null 2>&1 && break; sleep 1; done

  log "6c) recria $NMS_DB + timescaledb_pre_restore → pg_restore → post_restore"
  docker exec "$CT" psql -U "$NMS_USER" -d postgres -v ON_ERROR_STOP=1 -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$NMS_DB' AND pid<>pg_backend_pid();" >/dev/null 2>&1 || true
  docker exec "$CT" psql -U "$NMS_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $NMS_DB" >/dev/null
  docker exec "$CT" psql -U "$NMS_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $NMS_DB OWNER $NMS_USER" >/dev/null
  docker exec "$CT" psql -U "$NMS_USER" -d "$NMS_DB" -c "CREATE EXTENSION IF NOT EXISTS timescaledb" >/dev/null 2>&1
  docker exec "$CT" psql -U "$NMS_USER" -d "$NMS_DB" -c "SELECT timescaledb_pre_restore();" >/dev/null
  docker exec -i "$CT" pg_restore -U "$NMS_USER" -d "$NMS_DB" --no-owner --no-acl < "$WORK/nms.dump" 2>/tmp/dr-nms.err || true
  docker exec "$CT" psql -U "$NMS_USER" -d "$NMS_DB" -c "SELECT timescaledb_post_restore();" >/dev/null
  NMS_ERR="$(grep -iE 'error:' /tmp/dr-nms.err | grep -viE 'must be owner|already exists|extension .timescaledb' || true)"
  [[ -n "$NMS_ERR" ]] && { log "   !! erros nms:"; echo "$NMS_ERR" | head -10; } || log "   nms restore ok (só ruído benigno)"

  if [[ -f "$WORK/nms-config-backups.tar.gz" ]]; then
    CB_VOL="$(docker volume ls --format '{{.Name}}' | grep -i config-backups | head -1 || true)"
    [[ -n "$CB_VOL" ]] && docker run --rm -v "$CB_VOL":/d -v "$WORK":/in:ro alpine \
      sh -c "cd /d && tar -xzf /in/nms-config-backups.tar.gz" 2>/dev/null && log "   config-backups restaurado"
  fi

  log "6d) sobe a stack NMS completa (pega MASTER_KEY novo)"
  ( cd "$NMS_INFRA" && docker compose -f "$NMS_COMPOSE" --env-file .env.netx up -d >/dev/null 2>&1 || true )
else
  log "6) NMS: sem nms.dump/compose/docker no bundle ou box — pulando"
fi

log "7) restart serviços do core"
systemctl start $SERVICES
sleep 4
for s in $SERVICES; do printf "   %-24s %s\n" "$s" "$(systemctl is-active "$s")"; done
log "FIM"
