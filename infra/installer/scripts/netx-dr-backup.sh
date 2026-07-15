#!/usr/bin/env bash
# =============================================================================
# netx-dr-backup.sh — bundle de Disaster Recovery CIFRADO (core + NMS + segredos).
#
# Roda como ROOT (lê /etc/netx/.secrets, .env.netx, faz docker exec no Timescale).
# Usado pela UI (via sudo -n, allowlist) e pelo operador/timer.
# Cifra com `age` para recipient(s) do operador → o box cifra mas NÃO decifra.
#   uso: sudo netx-dr-backup.sh [dir_saida]
# =============================================================================
set -Eeuo pipefail

NETX_ETC="${NETX_ETC:-/etc/netx}"
NETX_HOME="${NETX_HOME:-/opt/netx}"
NMS_ENV="${NETX_NMS_ENV:-$NETX_HOME/apps/nms/infra/.env.netx}"
OUT_DIR="${1:-${NETX_DR_OUT_DIR:-/var/backups/netx/dr}}"
RECIP_FILE="${NETX_DR_AGE_RECIPIENTS:-$NETX_ETC/dr-recipients.txt}"
PG_DUMP_BIN="${PG_DUMP_BIN:-/usr/lib/postgresql/16/bin/pg_dump}"
[[ -x "$PG_DUMP_BIN" ]] || PG_DUMP_BIN=pg_dump

log(){ echo "[dr-backup] $*"; }
[[ $EUID -eq 0 ]] || { echo "root only"; exit 1; }
command -v age >/dev/null || { echo "age nao instalado (apt install age)"; exit 1; }
[[ -s "$RECIP_FILE" ]] || { echo "sem recipients age em $RECIP_FILE (age-keygen -> pubkey)"; exit 1; }

getval(){ grep -m1 -E "^$1=" "$2" 2>/dev/null | cut -d= -f2- || true; }

TS="$(date +%Y%m%dT%H%M%S)"
HOST="$(hostname)"
WORK="$(mktemp -d /tmp/netx-dr.XXXXXX)"; chmod 700 "$WORK"
cleanup(){ find "$WORK" -type f -exec shred -u {} + 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

# 1) Core DB (pg_dump -Fc via peer postgres; stdout → root escreve o arquivo)
DB_NAME="$(getval DATABASE_URL "$NETX_ETC/.env" | sed -E 's|.*/([^/?]+)(\?.*)?$|\1|')"; DB_NAME="${DB_NAME:-netx}"
log "core: pg_dump $DB_NAME"
sudo -u postgres "$PG_DUMP_BIN" -Fc --no-owner --no-acl "$DB_NAME" > "$WORK/core.dump"

# 2) NMS TimescaleDB + volume config-backups (best-effort)
NMS_PRESENT=false
NMS_CT="$(docker ps --filter name=timescaledb --format '{{.Names}}' 2>/dev/null | head -1 || true)"
if [[ -n "$NMS_CT" && -f "$NMS_ENV" ]]; then
  NMS_DB="$(getval POSTGRES_DB "$NMS_ENV")";   NMS_DB="${NMS_DB:-netx_nms}"
  NMS_USER="$(getval POSTGRES_USER "$NMS_ENV")"; NMS_USER="${NMS_USER:-netx}"
  log "nms: pg_dump $NMS_DB (container $NMS_CT)"
  if docker exec "$NMS_CT" pg_dump -Fc --no-owner --no-acl -U "$NMS_USER" "$NMS_DB" > "$WORK/nms.dump" 2>/dev/null; then
    NMS_PRESENT=true
    CB_VOL="$(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -i 'config-backups' | head -1 || true)"
    if [[ -n "$CB_VOL" ]]; then
      log "nms: volume $CB_VOL → tar"
      docker run --rm -v "$CB_VOL":/d:ro -v "$WORK":/out alpine \
        tar -C /d -czf /out/nms-config-backups.tar.gz . 2>/dev/null || log "  (aviso: tar do volume falhou)"
    fi
  else
    log "  (aviso: dump do NMS falhou — seguindo só com o core)"
    rm -f "$WORK/nms.dump"
  fi
fi

# 3) Segredos CURADOS (só o essencial pra restore fiel)
log "segredos curados"
{
  echo "# NetX DR secrets — $TS — origem $HOST"
  for k in KMS_MASTER_KEY JWT_ACCESS_SECRET JWT_REFRESH_SECRET PORTAL_JWT_SECRET DEFAULT_TENANT_SLUG; do
    echo "$k=$(getval "$k" "$NETX_ETC/.env")"
  done
  if [[ -f "$NMS_ENV" ]]; then
    echo "NMS_MASTER_KEY=$(getval MASTER_KEY "$NMS_ENV")"
    echo "NMS_JWT_SECRET=$(getval JWT_SECRET "$NMS_ENV")"
    echo "NMS_CORE_JWT_SECRET=$(getval CORE_JWT_SECRET "$NMS_ENV")"
  fi
} > "$WORK/secrets.env"

# 4) Manifest
GIT_REV="$(git -C "$NETX_HOME" rev-parse --short HEAD 2>/dev/null || echo '?')"
cat > "$WORK/manifest.json" <<JSON
{"tool":"netx-dr","schema":1,"created":"$TS","hostname":"$HOST","git":"$GIT_REV","core_db":"$DB_NAME","nms":$NMS_PRESENT,"default_tenant_slug":"$(getval DEFAULT_TENANT_SLUG "$NETX_ETC/.env")"}
JSON

# 5) Empacota + cifra (age → só o operador decifra)
BUNDLE="$WORK/bundle.tar"
( cd "$WORK" && tar -cf "bundle.tar" core.dump secrets.env manifest.json \
    $([[ -f nms.dump ]] && echo nms.dump) \
    $([[ -f nms-config-backups.tar.gz ]] && echo nms-config-backups.tar.gz) )
mkdir -p "$OUT_DIR"; chmod 700 "$OUT_DIR"
OUT="$OUT_DIR/netx-dr-$HOST-$TS.tar.age"
age -R "$RECIP_FILE" -o "$OUT" "$BUNDLE"
chmod 600 "$OUT"
log "OK → $OUT ($(du -h "$OUT" | cut -f1))  [nms=$NMS_PRESENT]"
echo "$OUT"
