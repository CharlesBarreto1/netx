#!/usr/bin/env bash
# =============================================================================
# NetX — Uninstaller
# =============================================================================
# Para o NetX e remove serviços/configs/dados.
#
# Modos:
#   sudo bash uninstall.sh              # remove app, mantém DB e segredos
#   sudo bash uninstall.sh --purge      # remove TUDO incluindo DB e dados
#
# Não remove pacotes APT (postgres, redis, rabbitmq, freeradius, nginx) —
# eles podem estar em uso por outras coisas.
# =============================================================================

set -Eeuo pipefail

PURGE=0
for arg in "$@"; do
  case "${arg}" in
    --purge) PURGE=1 ;;
    --help|-h)
      grep -E '^# ' "$0" | sed 's/^# //'
      exit 0
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Precisa rodar como root (sudo)" >&2
  exit 1
fi

echo "==> Parando serviços NetX"
systemctl stop netx-web netx-api-gateway netx-core-service 2>/dev/null || true
systemctl disable netx-web netx-api-gateway netx-core-service 2>/dev/null || true

echo "==> Parando Evolution API (Docker)"
if [ -d /opt/netx-evolution ]; then
  (cd /opt/netx-evolution && docker compose down -v 2>/dev/null) || true
fi

echo "==> Removendo unidades systemd"
rm -f /etc/systemd/system/netx-{web,api-gateway,core-service}.service
systemctl daemon-reload

echo "==> Removendo nginx site"
rm -f /etc/nginx/sites-enabled/netx /etc/nginx/sites-available/netx
nginx -t && systemctl reload nginx || true

echo "==> Restaurando FreeRADIUS"
if [[ -f /etc/freeradius/3.0/mods-available/sql.netx-orig ]]; then
  mv /etc/freeradius/3.0/mods-available/sql.netx-orig /etc/freeradius/3.0/mods-available/sql
fi
if [[ -f /etc/freeradius/3.0/sites-available/default.netx-orig ]]; then
  mv /etc/freeradius/3.0/sites-available/default.netx-orig /etc/freeradius/3.0/sites-available/default
fi
systemctl restart freeradius || true

echo "==> Removendo /opt/netx"
rm -rf /opt/netx

echo "==> Removendo /var/log/netx"
rm -rf /var/log/netx

if (( PURGE == 1 )); then
  echo "==> --purge: removendo DB e segredos"
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS netx" || true
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS evolution" || true
  sudo -u postgres psql -c "DROP ROLE IF EXISTS netx" || true
  sudo -u postgres psql -c "DROP ROLE IF EXISTS evolution" || true

  rabbitmqctl delete_user netx 2>/dev/null || true
  rabbitmqctl delete_vhost netx 2>/dev/null || true

  rm -rf /etc/netx /var/lib/netx /opt/netx-evolution
  userdel -r netx 2>/dev/null || true

  echo "==> Tudo removido."
else
  echo "==> NetX desinstalado. Para remover dados também: sudo bash uninstall.sh --purge"
fi
