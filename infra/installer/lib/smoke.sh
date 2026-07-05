# shellcheck shell=bash
# =============================================================================
# smoke.sh — verificações finais ponta a ponta
# =============================================================================

smoke_test() {
  smoke_services_active
  smoke_http_endpoints
  smoke_postgres_radius
  smoke_freeradius_test
  smoke_waha
}

smoke_waha() {
  if curl -fsS "http://127.0.0.1:3010/ping" >/dev/null 2>&1; then
    log_ok "WAHA responde em :3010"
  else
    log_warn "WAHA não respondeu (admin pode subir manualmente: cd /opt/netx-waha && docker compose up -d)"
  fi
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

  # Serviços não-fatais: cwmp (TR-069 é opcional pra operação básica), minio
  # (uploads) e traccar (frota GPS, opt-out). Inativo = warn, não derruba.
  for svc in netx-cwmp-server minio traccar; do
    if ! systemctl cat "${svc}" >/dev/null 2>&1; then
      log_dim "service ${svc} não instalado (opcional) — skip"
    elif service_is_active "${svc}"; then
      log_ok "service ${svc} ativo"
    else
      log_warn "service ${svc} INATIVO (não-fatal) — journalctl -u ${svc}"
    fi
  done

  # Timer de backup — sem ele o pg_dump diário não roda.
  if systemctl is-active --quiet netx-backup.timer 2>/dev/null; then
    log_ok "netx-backup.timer armado"
  else
    log_warn "netx-backup.timer inativo — backup automático diário NÃO vai rodar"
  fi
}

smoke_http_endpoints() {
  # core-service health
  if curl -fsS "http://127.0.0.1:${NETX_PORT_CORE_SERVICE}/health" >/dev/null 2>&1; then
    log_ok "core-service /health OK"
  else
    log_warn "core-service /health não respondeu (talvez rota diferente)"
  fi

  # api-gateway — gateway ainda não tem endpoint /health (TODO v1.1).
  # Por enquanto checamos só que a porta responde (qualquer HTTP, incluindo 404).
  local gateway_status
  gateway_status=$(curl -sS -o /dev/null -w "%{http_code}" \
    "http://127.0.0.1:${NETX_PORT_API_GATEWAY}/api/v1/auth/login" 2>/dev/null \
    --connect-timeout 5 || echo "000")
  if [[ "${gateway_status}" =~ ^[1-5][0-9]{2}$ ]]; then
    log_ok "api-gateway respondendo em :${NETX_PORT_API_GATEWAY} (HTTP ${gateway_status})"
  else
    log_error "api-gateway NÃO RESPONDE em :${NETX_PORT_API_GATEWAY}"
    journalctl -u netx-api-gateway -n 40 --no-pager >&2 || true
    exit 1
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
  # `NETX_DB_PASSWORD` é gerado por `secret_get_or_create` em postgres.sh e
  # persistido em /etc/netx/.secrets — não está disponível no env do shell em
  # re-runs (smoke é um step independente). Lê do file de secrets aqui.
  local db_password
  db_password=$(secret_get_or_create NETX_DB_PASSWORD 32)
  local count
  count=$(PGPASSWORD="${db_password}" psql \
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
