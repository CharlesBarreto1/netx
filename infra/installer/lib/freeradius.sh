# shellcheck shell=bash
# =============================================================================
# freeradius.sh — configura mods-available/sql + clients via SQL
# =============================================================================

FR_DIR=/etc/freeradius/3.0
FR_MODS_AVAIL="${FR_DIR}/mods-available"
FR_MODS_ENABLED="${FR_DIR}/mods-enabled"
FR_SITES_AVAIL="${FR_DIR}/sites-available"
FR_SITES_ENABLED="${FR_DIR}/sites-enabled"

freeradius_setup() {
  freeradius_render_sql_module
  freeradius_enable_sql
  freeradius_enable_default_site
  freeradius_validate_config
  freeradius_restart
}

freeradius_render_sql_module() {
  local tmpl="${INSTALLER_DIR}/templates/freeradius-sql.tmpl"
  local dst="${FR_MODS_AVAIL}/sql"

  if [[ ! -f "${tmpl}" ]]; then
    log_error "Template ausente: ${tmpl}"
    exit 1
  fi

  backup_file "${dst}"
  log_info "Renderizando ${dst}"
  render_template "${tmpl}" "${dst}" \
    NETX_DB_HOST NETX_DB_PORT NETX_DB_NAME NETX_DB_USER NETX_DB_PASSWORD

  chown freerad:freerad "${dst}"
  chmod 640 "${dst}"
}

freeradius_enable_sql() {
  if [[ ! -L "${FR_MODS_ENABLED}/sql" ]]; then
    log_info "Habilitando módulo sql"
    ln -sf "../mods-available/sql" "${FR_MODS_ENABLED}/sql"
  fi
}

# O site default precisa ter sql habilitado em authorize/accounting/post-auth.
# A config padrão do Debian já tem -sql comentado em algumas seções; descomenta
# de forma idempotente.
freeradius_enable_default_site() {
  local site="${FR_SITES_AVAIL}/default"
  if [[ ! -f "${site}" ]]; then
    log_warn "site default ausente — instalação incompleta?"
    return
  fi
  backup_file "${site}"

  # Remove o "-" antes de sql (ignora-erros) em authorize/accounting/post-auth
  # Padrão: linhas com whitespace + "-sql" → "        sql"
  sed -i 's/^\(\s*\)-sql/\1sql/g' "${site}"

  # Comenta `auth_log` e `reply_log` se estiverem ativos (ruído desnecessário)
  # — opcional, pode comentar ou deixar.

  # Garante que existe link no sites-enabled
  if [[ ! -L "${FR_SITES_ENABLED}/default" ]]; then
    ln -sf "../sites-available/default" "${FR_SITES_ENABLED}/default"
  fi
}

freeradius_validate_config() {
  log_info "Validando config (freeradius -CX)"
  if ! freeradius -CX > /tmp/freeradius-validate.log 2>&1; then
    log_error "Config FreeRADIUS inválida. Veja /tmp/freeradius-validate.log"
    tail -30 /tmp/freeradius-validate.log >&2
    exit 1
  fi
  log_ok "Config FreeRADIUS válida"
}

freeradius_restart() {
  systemctl enable freeradius
  systemctl restart freeradius
  if ! systemctl is-active --quiet freeradius; then
    log_error "FreeRADIUS não subiu. Veja: journalctl -u freeradius -n 50"
    journalctl -u freeradius -n 50 >&2 || true
    exit 1
  fi
  log_ok "FreeRADIUS rodando em :1812 (auth) e :1813 (accounting)"
}
