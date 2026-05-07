# shellcheck shell=bash
# =============================================================================
# rabbitmq.sh — vhost + user + permissões
# =============================================================================

rabbitmq_setup() {
  systemctl enable --now rabbitmq-server

  # rabbitmq-server demora a bootar — espera
  local i=0
  while ! rabbitmqctl status >/dev/null 2>&1; do
    i=$((i + 1))
    if (( i >= 60 )); then
      log_error "RabbitMQ não respondeu em 60s. Confere: journalctl -u rabbitmq-server"
      exit 1
    fi
    sleep 1
  done
  log_ok "RabbitMQ ativo"

  local pwd
  pwd=$(secret_get_or_create NETX_RABBIT_PASSWORD 32)
  export NETX_RABBIT_PASSWORD="${pwd}"

  # vhost
  if rabbitmqctl list_vhosts -q | grep -qx "${NETX_RABBIT_VHOST}"; then
    log_dim "vhost ${NETX_RABBIT_VHOST} já existe"
  else
    log_info "Criando vhost ${NETX_RABBIT_VHOST}"
    rabbitmqctl add_vhost "${NETX_RABBIT_VHOST}"
  fi

  # user
  if rabbitmqctl list_users -q | awk '{print $1}' | grep -qx "${NETX_RABBIT_USER}"; then
    log_dim "user ${NETX_RABBIT_USER} já existe — atualizando senha"
    rabbitmqctl change_password "${NETX_RABBIT_USER}" "${NETX_RABBIT_PASSWORD}"
  else
    log_info "Criando user ${NETX_RABBIT_USER}"
    rabbitmqctl add_user "${NETX_RABBIT_USER}" "${NETX_RABBIT_PASSWORD}"
  fi
  rabbitmqctl set_user_tags "${NETX_RABBIT_USER}" management
  rabbitmqctl set_permissions -p "${NETX_RABBIT_VHOST}" "${NETX_RABBIT_USER}" '.*' '.*' '.*'

  # Habilita management plugin (UI em :15672) — útil pra debug
  if ! rabbitmq-plugins list -e -q | grep -q rabbitmq_management; then
    log_info "Habilitando rabbitmq_management plugin"
    rabbitmq-plugins enable rabbitmq_management
  fi

  export NETX_RABBITMQ_URL="amqp://${NETX_RABBIT_USER}:${NETX_RABBIT_PASSWORD}@localhost:5672/${NETX_RABBIT_VHOST}"
  log_ok "RabbitMQ em ${NETX_RABBITMQ_URL}"
}
