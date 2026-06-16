#!/usr/bin/env bash
# chrony.sh — NetX como servidor NTP pros equipamentos cadastrados.
#
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
#
# Por que ter NTP local:
#   - Mikrotiks com clock zoado (1970-XX) ferram Acct-Timestamp no RADIUS
#     accounting (vimos isso em prod — `acctstarttime: 1970-01-02 23:59:13`).
#   - Confiar em NTP público (pool.ntp.org) requer rotas pra Internet em todos
#     os NASes — em muitos ISPs o BNG está em LAN privada.
#   - Tendo o NetX como NTP local, basta os NASes acharem o NetX (que já é
#     necessário pra RADIUS).
#
# Allowlist:
#   - Default-deny: chrony só serve a clients explicitamente listados.
#   - Lista gerada a partir de `network_equipment.ip_address` (todos tipos —
#     BNG, OLT, Router, Switch — todos podem se beneficiar de NTP).
#   - Regenerada via `scripts/sync-ntp.sh` quando equipamento é cadastrado.
#
# Firewall:
#   - `firewall.sh` já libera UDP 123 do NTP via mesmo mecanismo de allowlist.

CHRONY_CONF="/etc/chrony/chrony.conf"
CHRONY_ALLOWS_FILE="/etc/chrony/conf.d/netx-allows.conf"

chrony_setup() {
  log_info "Configurando chrony como servidor NTP local"

  # Instala chrony se ainda não tiver
  if ! command -v chronyd >/dev/null 2>&1; then
    log_info "Instalando chrony"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chrony >/dev/null
  fi

  # Garante conf.d/ existe (algumas instalações antigas não trazem)
  mkdir -p /etc/chrony/conf.d
  if ! grep -q "include /etc/chrony/conf.d" "${CHRONY_CONF}" 2>/dev/null; then
    {
      echo ""
      echo "# NetX — drop-in pra allowlist dinâmica de clients NTP"
      echo "include /etc/chrony/conf.d/*.conf"
    } >> "${CHRONY_CONF}"
  fi

  # Gera allowlist inicial baseado em network_equipment
  chrony_sync_allowlist

  systemctl enable chrony >/dev/null 2>&1 || true
  systemctl restart chrony

  # Confirma que está rodando + listening em 123
  sleep 2
  if ss -ulnp 2>/dev/null | grep -q ':123 '; then
    log_ok "chrony ativo em :123 (allowlist gerada a partir de network_equipment)"
  else
    log_warn "chrony pode não ter subido — verifique 'systemctl status chrony'"
  fi
}

# Regenera /etc/chrony/conf.d/netx-allows.conf a partir do banco. Idempotente.
chrony_sync_allowlist() {
  if [[ ! -d /etc/chrony/conf.d ]]; then
    return 0
  fi

  local ips
  ips=$(PGPASSWORD="${NETX_DB_PASSWORD}" psql \
    -h "${NETX_DB_HOST}" -p "${NETX_DB_PORT}" \
    -U "${NETX_DB_USER}" -d "${NETX_DB_NAME}" \
    -t -A -c "SELECT DISTINCT ip_address FROM network_equipment WHERE deleted_at IS NULL AND is_active = true" \
    2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)

  {
    echo "# Auto-gerado por chrony_sync_allowlist - NÃO EDITAR MANUALMENTE."
    echo "# Lista populada a partir de network_equipment.ip_address."
    echo "# Re-gerar via: sudo /opt/netx/infra/installer/scripts/sync-ntp.sh"
    echo ""
    # Default deny pra clients NTP (chrony só serve com 'allow' explícito).
    # Loopback sempre liberado pra testes locais.
    echo "allow 127.0.0.1"
    if [[ -n "${ips}" ]]; then
      local ip
      for ip in ${ips}; do
        echo "allow ${ip}/32"
      done
    fi
  } > "${CHRONY_ALLOWS_FILE}"
  chmod 644 "${CHRONY_ALLOWS_FILE}"

  # RESTART (não reload): as diretivas `allow` do conf.d só são lidas no
  # startup do chronyd. `systemctl reload chrony` roda `chronyc reload sources`
  # — relê fontes de tempo, NÃO relê a allowlist. Sem restart, o cliente NTP
  # recém-adicionado continua negado mesmo com a porta 123 aberta no UFW
  # (mesma classe de bug do FreeRADIUS reload×restart).
  if systemctl is-active --quiet chrony 2>/dev/null; then
    systemctl restart chrony 2>/dev/null || true
  fi
}
