# shellcheck shell=bash
# =============================================================================
# redis.sh — Redis bind localhost + senha opcional + maxmemory policy
# =============================================================================

redis_setup() {
  systemctl enable --now redis-server
  if ! systemctl is-active --quiet redis-server; then
    log_error "Redis não subiu. Confere: journalctl -u redis-server"
    exit 1
  fi

  # Garante bind só em loopback (já é o default no Debian, mas reforça)
  local conf=/etc/redis/redis.conf
  if [[ -f "${conf}" ]]; then
    backup_file "${conf}"
    sed -i 's/^# maxmemory-policy .*/maxmemory-policy allkeys-lru/' "${conf}" || true
    sed -i 's/^maxmemory-policy .*/maxmemory-policy allkeys-lru/' "${conf}" || true
    if ! grep -qE '^bind 127\.0\.0\.1' "${conf}"; then
      echo "bind 127.0.0.1 ::1" >> "${conf}"
    fi
    systemctl restart redis-server
  fi
  log_ok "Redis em redis://localhost:6379"
  export NETX_REDIS_URL="redis://localhost:6379"
}
