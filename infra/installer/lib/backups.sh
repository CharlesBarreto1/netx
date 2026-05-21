# shellcheck shell=bash
# =============================================================================
# backups.sh — instala backup automatizado + off-host opcional
# =============================================================================
# Cria:
#   /etc/systemd/system/netx-backup.service
#   /etc/systemd/system/netx-backup.timer
#   /var/backups/netx (dir)
#   /var/log/netx (dir)
#   /etc/logrotate.d/netx-backup
#
# Habilita o timer pra rodar diariamente. Script real fica em
# /opt/netx/infra/installer/scripts/backup/netx-backup.sh (via git).

backups_setup() {
  backups_install_dirs
  backups_install_units
  backups_install_logrotate
  backups_install_rclone_optional
  backups_enable_timer
  backups_show_summary
}

backups_install_dirs() {
  # /var/backups/netx — root-owned, grupo netx pode ler pra restaurar via UI.
  install -d -o root  -g netx -m 0750 /var/backups/netx
  # Subdir pra pre-migration snapshots — mode 0770 porque safe-migrate.sh roda
  # como user netx e precisa WRITE aqui. (auto/ é 0750 porque só root cron grava.)
  install -d -o root  -g netx -m 0770 /var/backups/netx/pre-migration
  install -d -o root  -g netx -m 0750 /var/log/netx
  install -d -o root  -g root -m 0755 /var/lock
}

backups_install_units() {
  local svc_src="${INSTALLER_DIR}/templates/systemd/timers/netx-backup.service"
  local tmr_src="${INSTALLER_DIR}/templates/systemd/timers/netx-backup.timer"
  local svc_dst="/etc/systemd/system/netx-backup.service"
  local tmr_dst="/etc/systemd/system/netx-backup.timer"

  if [[ ! -f "${svc_src}" || ! -f "${tmr_src}" ]]; then
    log_error "Templates de backup ausentes em ${INSTALLER_DIR}/templates/systemd/timers/"
    exit 1
  fi

  log_info "Instalando systemd units de backup"
  install -m 0644 "${svc_src}" "${svc_dst}"
  install -m 0644 "${tmr_src}" "${tmr_dst}"
  systemctl daemon-reload
}

backups_install_logrotate() {
  # Rotaciona /var/log/netx/backup.log semanalmente, mantém 4 semanas.
  cat > /etc/logrotate.d/netx-backup <<'EOF'
/var/log/netx/backup.log {
    weekly
    rotate 4
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root netx
}
EOF
  chmod 0644 /etc/logrotate.d/netx-backup
}

# rclone é OPCIONAL. Só instala se NETX_BACKUP_REMOTE estiver setado E o admin
# também rodou `rclone config` manualmente pra criar o remote. Sem isso,
# `rclone copy` falha graciosamente e o backup fica só local (warning no log).
backups_install_rclone_optional() {
  if [[ -z "${NETX_BACKUP_REMOTE:-}" ]]; then
    log_dim "NETX_BACKUP_REMOTE vazio — backup será só local (configure rclone + setá-lo pra off-host)"
    return 0
  fi
  if command -v rclone >/dev/null 2>&1; then
    log_dim "rclone já instalado ($(rclone --version | head -1))"
    return 0
  fi
  log_info "Instalando rclone (pra off-host backup)"
  apt-get install -y -qq rclone || {
    log_warn "rclone não pôde ser instalado — backup ficará só local"
    return 0
  }
  log_warn "rclone instalado mas SEM remote configurado."
  log_warn "Pra ativar off-host: 'sudo rclone config' (interativo) e configure o remote."
  log_warn "Doc: https://rclone.org/docs/#configure"
}

backups_enable_timer() {
  log_info "Habilitando netx-backup.timer (diário, ~03:17)"
  systemctl enable --now netx-backup.timer

  # Confere que o timer está armado pra próxima execução.
  if systemctl is-active --quiet netx-backup.timer; then
    local next
    next=$(systemctl show netx-backup.timer --property=NextElapseUSecRealtime --value 2>/dev/null || echo "?")
    log_ok "Timer ativo — próximo backup: ${next}"
  else
    log_warn "Timer não ficou active — verifique 'systemctl status netx-backup.timer'"
  fi
}

backups_show_summary() {
  log_dim ""
  log_dim "──────────────── BACKUP CONFIG ────────────────"
  log_dim " Local dir:          /var/backups/netx"
  log_dim " Log:                /var/log/netx/backup.log"
  log_dim " Retenção local:     ${BACKUP_RETENTION_DAYS:-30} dias"
  log_dim " Off-host (rclone):  ${NETX_BACKUP_REMOTE:-(não configurado)}"
  log_dim " Disparo manual:     sudo systemctl start netx-backup.service"
  log_dim " Ver status:         systemctl status netx-backup.timer"
  log_dim " Ver últimos logs:   journalctl -u netx-backup.service -n 50"
  log_dim "───────────────────────────────────────────────"
}
