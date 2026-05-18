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

  # `enable --now` em vez de enable+restart separados: cobre o caso (raro)
  # do serviço estar `masked` em fresh install — o restart sozinho falharia.
  systemctl unmask nginx 2>/dev/null || true
  systemctl enable --now nginx
  systemctl reload nginx 2>/dev/null || systemctl restart nginx
  if ! systemctl is-active --quiet nginx; then
    log_error "nginx não subiu"
    journalctl -u nginx -n 30 --no-pager >&2 || true
    exit 1
  fi
  log_ok "nginx ativo (porta 80)"

  # HTTPS automático via Let's Encrypt — só se domínio + email setados E
  # DNS já resolvendo pra este servidor (best effort, não trava o install).
  nginx_letsencrypt
}

# Roda certbot --nginx se NETX_DOMAIN e NETX_LETSENCRYPT_EMAIL setados.
# Não falha o install se o cert não sair — operador pode rodar manualmente:
#   certbot --nginx -d $NETX_DOMAIN -m $email --agree-tos --redirect
nginx_letsencrypt() {
  if [[ -z "${NETX_DOMAIN}" ]]; then
    log_dim "NETX_DOMAIN vazio — pulando HTTPS (servidor acessível só via IP)"
    return 0
  fi
  if [[ -z "${NETX_LETSENCRYPT_EMAIL:-}" ]]; then
    log_dim "NETX_LETSENCRYPT_EMAIL vazio — HTTPS não configurado automaticamente"
    log_dim "Pra ativar depois: certbot --nginx -d ${NETX_DOMAIN} -m EMAIL --agree-tos --redirect"
    return 0
  fi

  # DNS check — se o domínio não aponta pra este host, certbot vai falhar
  # de qualquer jeito, então adianta o aviso.
  local resolved server_ip
  resolved=$(getent hosts "${NETX_DOMAIN}" 2>/dev/null | awk '{print $1}' | head -1)
  server_ip=$(detect_public_ip)
  if [[ -z "${resolved}" ]]; then
    log_warn "DNS de ${NETX_DOMAIN} não resolve — pulando certbot."
    log_warn "Configure o A record apontando pra ${server_ip} e rode:"
    log_warn "  certbot --nginx -d ${NETX_DOMAIN} -m ${NETX_LETSENCRYPT_EMAIL} --agree-tos --redirect"
    return 0
  fi
  if [[ "${resolved}" != "${server_ip}" ]]; then
    log_warn "DNS de ${NETX_DOMAIN} aponta pra ${resolved}, esperado ${server_ip}"
    log_warn "Pulando certbot. Pra reconfigurar depois:"
    log_warn "  certbot --nginx -d ${NETX_DOMAIN} -m ${NETX_LETSENCRYPT_EMAIL} --agree-tos --redirect"
    return 0
  fi

  log_info "Instalando certbot + obtendo cert Let's Encrypt"
  apt-get install -y -qq certbot python3-certbot-nginx
  if certbot --nginx -d "${NETX_DOMAIN}" \
      --non-interactive --agree-tos \
      -m "${NETX_LETSENCRYPT_EMAIL}" \
      --redirect; then
    log_ok "HTTPS ativo em https://${NETX_DOMAIN}"
  else
    log_warn "certbot falhou — verifique /var/log/letsencrypt/letsencrypt.log"
    log_warn "Pra tentar de novo: certbot --nginx -d ${NETX_DOMAIN} -m ${NETX_LETSENCRYPT_EMAIL} --agree-tos --redirect"
  fi
}
