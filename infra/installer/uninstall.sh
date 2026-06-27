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

echo "==> Parando WAHA (Docker)"
if [ -d /opt/netx-waha ]; then
  (cd /opt/netx-waha && docker compose down -v 2>/dev/null) || true
fi

echo "==> Parando Evolution API (Docker, legado)"
if [ -d /opt/netx-evolution ]; then
  (cd /opt/netx-evolution && docker compose down -v 2>/dev/null) || true
fi
# Defesa em profundidade: mesmo sem /opt/netx-evolution, containers órfãos
# podem ter sobrevivido a desinstalações anteriores (ex.: VPS dev migrada
# de PM2 pro installer). Containers com porta 5672 conflitam com RabbitMQ.
if command -v docker >/dev/null 2>&1; then
  # Pára qualquer container que esteja publicando 5672 ou 8080 (portas que
  # o NetX usa: AMQP e Evolution). Não remove a imagem por segurança.
  for port in 5672 8080; do
    docker ps -q --filter "publish=${port}" 2>/dev/null | xargs -r docker stop 2>/dev/null || true
  done
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

  # PM2 stale: remove unit de auto-start se sobrou de instalação antiga
  # via PM2 (caso da VPS dev migrada). Não falha se não existir.
  systemctl stop pm2-netx 2>/dev/null || true
  systemctl disable pm2-netx 2>/dev/null || true
  rm -f /etc/systemd/system/pm2-netx.service
  systemctl daemon-reload 2>/dev/null || true

  # Estado/cookie/mnesia do RabbitMQ travam reinstall em hostname novo. Não
  # limpamos /var/lib/rabbitmq aqui em --purge porque outras apps podem usar
  # a mesma instância — quem PRECISA fazer "reset hard" do rabbit faz:
  #   systemctl stop rabbitmq-server
  #   pkill -9 -f beam.smp; pkill -9 -f epmd
  #   rm -rf /var/lib/rabbitmq /var/log/rabbitmq
  #   mkdir -p /var/log/rabbitmq /var/lib/rabbitmq
  #   chown rabbitmq:rabbitmq /var/log/rabbitmq /var/lib/rabbitmq
  #   chmod 750 /var/log/rabbitmq /var/lib/rabbitmq
  #   dpkg --configure -a   # ou apt-get install --reinstall rabbitmq-server
  # ATENÇÃO: o post-install do pacote chown'a /var/log/rabbitmq — se vc apagar
  # o dir sem recriar, dpkg falha. Recriar (mkdir+chown) é obrigatório.

  rm -rf /etc/netx /var/lib/netx /opt/netx-waha /opt/netx-evolution
  userdel -r netx 2>/dev/null || true

  echo "==> Tudo removido."
else
  echo "==> NetX desinstalado. Para remover dados também: sudo bash uninstall.sh --purge"
fi
