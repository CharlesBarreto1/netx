# shellcheck shell=bash
# =============================================================================
# nginx.sh — reverse proxy: 80 → web (3200) + /api/ → api-gateway (3000)
# =============================================================================

NGINX_AVAIL=/etc/nginx/sites-available
NGINX_ENABLED=/etc/nginx/sites-enabled

nginx_setup() {
  local server_name="${NETX_DOMAIN:-_}"
  export NETX_NGINX_SERVER_NAME="${server_name}"

  local tmpl="${INSTALLER_DIR}/templates/nginx-netx.tmpl"
  local dst="${NGINX_AVAIL}/netx"

  if [[ ! -f "${tmpl}" ]]; then
    log_error "Template ausente: ${tmpl}"
    exit 1
  fi

  log_info "Renderizando ${dst} (server_name=${server_name})"
  render_template "${tmpl}" "${dst}" \
    NETX_NGINX_SERVER_NAME NETX_PORT_WEB NETX_PORT_API_GATEWAY

  if [[ ! -L "${NGINX_ENABLED}/netx" ]]; then
    ln -sf "${NGINX_AVAIL}/netx" "${NGINX_ENABLED}/netx"
  fi
  # Remove default só se não foi customizado
  if [[ -L "${NGINX_ENABLED}/default" ]]; then
    rm -f "${NGINX_ENABLED}/default"
  fi

  log_info "Validando config do nginx"
  if ! nginx -t 2>/tmp/nginx-validate.log; then
    log_error "nginx config inválida. Veja /tmp/nginx-validate.log"
    cat /tmp/nginx-validate.log >&2
    exit 1
  fi

  systemctl enable nginx
  systemctl restart nginx
  if ! systemctl is-active --quiet nginx; then
    log_error "nginx não subiu"
    exit 1
  fi
  log_ok "nginx ativo (porta 80)"
}
