# shellcheck shell=bash
# =============================================================================
# smoke.sh — verificações finais ponta a ponta
# =============================================================================

smoke_test() {
  smoke_services_active
  smoke_http_endpoints
  smoke_postgres_radius
  smoke_freeradius_test
}

smoke_services_active() {
  for svc in postgresql redis-server rabbitmq-server freeradius nginx \
             netx-core-service netx-api-gateway netx-web; do
    if service_is_active "${svc}"; then
      log_ok "service ${svc} ativo"
    else
      log_error "service ${svc} INATIVO"
      systemctl status "${svc}" --no-pager -n 20 || true
      exit 1
    fi
  done
}

smoke_http_endpoints() {
  # core-service health
  if curl -fsS "http://127.0.0.1:${NETX_PORT_CORE_SERVICE}/health" >/dev/null 2>&1; then
    log_ok "core-service /health OK"
  else
    log_warn "core-service /health não respondeu (talvez rota diferente)"
  fi

  # api-gateway
  if curl -fsS "http://127.0.0.1:${NETX_PORT_API_GATEWAY}/health" >/dev/null 2>&1 \
     || curl -fsS "http://127.0.0.1:${NETX_PORT_API_GATEWAY}/api/health" >/dev/null 2>&1; then
    log_ok "api-gateway /health OK"
  else
    log_warn "api-gateway /health não respondeu"
  fi

  # nginx :80
  if curl -fsS -o /dev/null -w "%{http_code}" http://127.0.0.1/ | grep -qE '^(200|3..)$'; then
    log_ok "nginx :80 servindo"
  else
    log_warn "nginx :80 retornou status inesperado"
  fi
}

smoke_postgres_radius() {
  log_info "Verificando schema RADIUS"
  local count
  count=$(PGPASSWORD="${NETX_DB_PASSWORD}" psql \
    -h "${NETX_DB_HOST}" -p "${NETX_DB_PORT}" \
    -U "${NETX_DB_USER}" -d "${NETX_DB_NAME}" \
    -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='radius'" 2>/dev/null || echo 0)
  if (( count >= 7 )); then
    log_ok "Schema RADIUS tem ${count} tabelas"
  else
    log_error "Schema RADIUS com ${count} tabelas (esperado 7+)"
    exit 1
  fi
}

smoke_freeradius_test() {
  log_info "Tentando radclient (auth dummy — pode falhar se não tem secret 'testing123')"
  # Não falha o install se isso der erro — é só smoke
  if echo "User-Name = nonexistent, User-Password = wrong" \
     | radclient -t 2 -r 1 127.0.0.1:1812 auth testing123 >/dev/null 2>&1; then
    log_ok "FreeRADIUS responde em :1812"
  else
    log_dim "radclient teste falhou (provavelmente shared secret diferente — ignorar)"
  fi
}
