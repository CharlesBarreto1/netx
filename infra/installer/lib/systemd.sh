# shellcheck shell=bash
# =============================================================================
# systemd.sh — instala e habilita unidades systemd dos serviços NetX
# =============================================================================

SYSTEMD_DIR=/etc/systemd/system

systemd_setup() {
  systemd_install_units
  systemd_reload
  systemd_enable_start
}

systemd_install_units() {
  local units=(netx-core-service netx-api-gateway netx-web)
  for u in "${units[@]}"; do
    local src="${INSTALLER_DIR}/templates/systemd/${u}.service"
    local dst="${SYSTEMD_DIR}/${u}.service"
    if [[ ! -f "${src}" ]]; then
      log_error "Unit template ausente: ${src}"
      exit 1
    fi
    log_info "Instalando ${dst}"
    # As unidades não usam variáveis substituíveis (caminhos são fixos via env file)
    install -m 0644 "${src}" "${dst}"
  done
}

systemd_reload() {
  systemctl daemon-reload
}

systemd_enable_start() {
  local units=(netx-core-service netx-api-gateway netx-web)
  for u in "${units[@]}"; do
    log_info "Habilitando + iniciando ${u}"
    systemctl enable "${u}"
    systemctl restart "${u}"
  done

  # Espera serviços ficarem ready (porta TCP)
  log_info "Aguardando serviços bootarem..."
  if ! wait_port 127.0.0.1 "${NETX_PORT_CORE_SERVICE}" 60; then
    log_error "core-service não abriu porta ${NETX_PORT_CORE_SERVICE}"
    journalctl -u netx-core-service -n 50 --no-pager >&2 || true
    exit 1
  fi
  log_ok "core-service em :${NETX_PORT_CORE_SERVICE}"

  if ! wait_port 127.0.0.1 "${NETX_PORT_API_GATEWAY}" 60; then
    log_error "api-gateway não abriu porta ${NETX_PORT_API_GATEWAY}"
    journalctl -u netx-api-gateway -n 50 --no-pager >&2 || true
    exit 1
  fi
  log_ok "api-gateway em :${NETX_PORT_API_GATEWAY}"

  if ! wait_port 127.0.0.1 "${NETX_PORT_WEB}" 90; then
    log_error "web não abriu porta ${NETX_PORT_WEB}"
    journalctl -u netx-web -n 50 --no-pager >&2 || true
    exit 1
  fi
  log_ok "web em :${NETX_PORT_WEB}"
}
