#!/usr/bin/env bash
#
# install-vps.sh — preparar uma VPS Debian/Ubuntu para rodar o NetX em
# bare-metal (sem Docker em prod). Idempotente: pode rodar de novo.
#
# Cobre:
#   1. Postgres client 16 (alinhar versão com o servidor)
#   2. Node 20 (via NodeSource)
#   3. PM2 global
#   4. Diretório de backups (`BACKUP_DIR`)
#   5. update-alternatives apontando pg_dump → 16
#
# Não cobre (decisão por VPS):
#   - Postgres SERVER (use cloud gerenciado ou container separado)
#   - Nginx/proxy reverso (depende do setup)
#   - Firewall/IP allowlist (gerenciado externo, pedido do user)
#
# Uso:  sudo bash scripts/install-vps.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Rode com sudo." >&2
  exit 1
fi

NETX_USER="${NETX_USER:-netx}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/netx}"

echo "════════════════════════════════════════════════════════════"
echo "  NetX — preparação de VPS"
echo "  user:        $NETX_USER"
echo "  backup_dir:  $BACKUP_DIR"
echo "════════════════════════════════════════════════════════════"

# ── 1. Postgres client 16 ────────────────────────────────────────────────────
echo ""
echo "[1/5] Postgres client 16 (do PGDG)…"
apt-get update -y
apt-get install -y curl ca-certificates gnupg lsb-release

install -d /usr/share/postgresql-common/pgdg
if [[ ! -f /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc ]]; then
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc
fi

CODENAME="$(lsb_release -cs)"
cat > /etc/apt/sources.list.d/pgdg.list <<EOF
deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main
EOF

apt-get update -y
apt-get install -y postgresql-client-16

# ── 2. update-alternatives: pg_dump default = 16 ─────────────────────────────
echo ""
echo "[2/5] Apontando pg_dump default → versão 16…"
PG16_DUMP="/usr/lib/postgresql/16/bin/pg_dump"
if [[ -x "$PG16_DUMP" ]]; then
  update-alternatives --install /usr/bin/pg_dump pg_dump "$PG16_DUMP" 100 || true
  update-alternatives --set pg_dump "$PG16_DUMP" || true
  echo "    pg_dump --version: $(pg_dump --version)"
else
  echo "    AVISO: $PG16_DUMP não encontrado." >&2
fi

# ── 3. Node 20 ───────────────────────────────────────────────────────────────
echo ""
echo "[3/5] Node 20…"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "^v20\."; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "    node: $(node -v)   npm: $(npm -v)"

# ── 4. PM2 global ────────────────────────────────────────────────────────────
echo ""
echo "[4/5] PM2 global…"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
echo "    pm2: $(pm2 -v)"

# ── 5. Diretório de backups ──────────────────────────────────────────────────
echo ""
echo "[5/5] Diretório de backups…"
mkdir -p "$BACKUP_DIR"
if id "$NETX_USER" >/dev/null 2>&1; then
  chown -R "$NETX_USER:$NETX_USER" "$BACKUP_DIR"
fi
chmod 750 "$BACKUP_DIR"
echo "    $BACKUP_DIR pronto (owner $NETX_USER)"

echo ""
echo "════════════════════════════════════════════════════════════"
echo " OK. Próximos passos manuais:"
echo "   - clonar o repo em ~$NETX_USER (ou onde preferir)"
echo "   - .env (DATABASE_URL, JWT_SECRET, BACKUP_DIR=$BACKUP_DIR, etc.)"
echo "   - npm install && npx nx run-many --target=build --all"
echo "   - npx prisma db push --schema apps/core-service/prisma/schema.prisma"
echo "   - npm run db:seed"
echo "   - pm2 start ecosystem.config.js && pm2 save && pm2 startup"
echo "════════════════════════════════════════════════════════════"
