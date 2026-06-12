#!/usr/bin/env bash
# firewall.sh — UFW: porta HTTP/HTTPS/SSH + RADIUS dinâmico por NAS.
#
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
#
# Estratégia em duas camadas:
#   1) Camada "base" — sempre liberada: SSH (22), HTTP (80), HTTPS (443).
#      Idempotente, roda no install/re-run.
#
#   2) Camada "RADIUS por NAS" — lê `radius.nas` (tabela populada pelos
#      NetworkEquipment cadastrados na UI) e abre 1812/1813/3799 UDP **apenas
#      pros IPs cadastrados**. Re-roda a sync sempre, removendo regras órfãs
#      automaticamente via comment marker "netx-nas:<IP>".
#
# Limitação atual: a sync roda só durante install. Pra atualização realtime
# (operador cadastra novo NAS pela UI → UFW abre porta imediato), criar um
# hook no NetworkEquipmentService.create/update que dispare este script via
# `sudo /opt/netx/infra/installer/scripts/sync-firewall.sh`.

firewall_setup() {
  log_info "Configurando UFW (base + radius por NAS)"

  # Defaults seguros
  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null

  # Camada base — sempre aberta
  ufw allow 22/tcp comment 'netx-base: ssh' >/dev/null 2>&1 || true
  ufw allow 80/tcp comment 'netx-base: http' >/dev/null 2>&1 || true
  ufw allow 443/tcp comment 'netx-base: https' >/dev/null 2>&1 || true

  # TR-069 / CWMP — CPEs Huawei (e outras vendor) abrem conexão TCP pra ACS.
  # Idealmente restringimos por IP/range da rede neutra (Ufinet) ou da OLT,
  # mas pra simplificar no MVP abrimos pra qualquer origem. Trade-off: o ACS
  # NÃO tem auth ainda (TODO), então em produção real seria bom restringir.
  ufw allow 7547/tcp comment 'netx-cwmp: tr-069 acs' >/dev/null 2>&1 || true

  # Traccar — porta de protocolo dos rastreadores GPS (GT06/Concox, família
  # dos X3 Tech NT). Só abre se o Traccar está habilitado/instalado. A web/API
  # (8082) fica FECHADA de propósito: o core-service fala via localhost e
  # inspeção humana é por túnel SSH.
  if [[ "${NETX_ENABLE_TRACCAR:-0}" == "1" || -d /opt/traccar ]]; then
    ufw allow 5023/tcp comment 'netx-traccar: rastreadores gt06' >/dev/null 2>&1 || true
  fi

  # Habilita UFW se ainda não tiver
  if ! ufw status | grep -q "Status: active"; then
    log_info "Habilitando UFW"
    ufw --force enable >/dev/null
  fi

  # Camada NAS — varre radius.nas e libera 1812/1813/3799 por IP
  firewall_sync_radius_nas

  # Sudoers — permite ao user netx rodar os scripts de sync sem senha.
  # Necessário pro backend disparar resync após cadastrar NetworkEquipment.
  firewall_install_sudoers

  log_ok "UFW configurado"
}

# Cria /etc/sudoers.d/netx-infra-sync com NOPASSWD pros scripts de sync.
# Idempotente — usa `visudo -c` pra validar antes de escrever.
#
# Por que sync-firewall.sh precisa de systemctl reload freeradius dentro dele:
# UFW + radius.nas sozinhos não bastam — FreeRADIUS carrega a lista de NAS
# clients em memória no startup e NÃO releé sozinho. Sem reload, NAS recém
# cadastrado pela UI fica "desconhecido" pro FR e pacotes são descartados
# silenciosamente. Por isso o script chama systemctl reload internamente, e
# pra ELE conseguir, autorizamos o user netx a rodar `systemctl reload
# freeradius` direto no sudoers (NOPASSWD restrito só pra esse comando).
firewall_install_sudoers() {
  local sudoers="/etc/sudoers.d/netx-infra-sync"
  local tmp
  tmp=$(mktemp)
  cat > "${tmp}" <<EOF
# Auto-gerado pelo NetX installer. Permite ao user netx rodar resync de
# UFW + NTP allowlist + reload de FreeRADIUS após mudança em NetworkEquipment.
${NETX_USER:-netx} ALL=(root) NOPASSWD: ${NETX_HOME:-/opt/netx}/infra/installer/scripts/sync-firewall.sh
${NETX_USER:-netx} ALL=(root) NOPASSWD: ${NETX_HOME:-/opt/netx}/infra/installer/scripts/sync-ntp.sh
${NETX_USER:-netx} ALL=(root) NOPASSWD: /usr/bin/systemctl reload freeradius
${NETX_USER:-netx} ALL=(root) NOPASSWD: /usr/bin/systemctl restart freeradius
${NETX_USER:-netx} ALL=(root) NOPASSWD: /bin/systemctl reload freeradius
${NETX_USER:-netx} ALL=(root) NOPASSWD: /bin/systemctl restart freeradius
EOF
  chmod 0440 "${tmp}"
  if visudo -c -f "${tmp}" >/dev/null 2>&1; then
    install -o root -g root -m 0440 "${tmp}" "${sudoers}"
    log_dim "Sudoers: ${sudoers} (netx pode rodar sync-firewall.sh + sync-ntp.sh + reload freeradius)"
  else
    log_warn "Sudoers ${sudoers} falhou na validação — backend não conseguirá auto-sync"
  fi
  rm -f "${tmp}"
}

# Lê radius.nas e abre 1812/1813/3799 pros NASes cadastrados. Idempotente.
# Marca cada regra com comment "netx-nas:<IP>" pra permitir cleanup seletivo.
firewall_sync_radius_nas() {
  if ! command -v ufw >/dev/null 2>&1; then
    log_warn "UFW não instalado — pulando sync de firewall RADIUS"
    return 0
  fi

  # Pega lista de IPs cadastrados em radius.nas
  local nas_ips
  nas_ips=$(PGPASSWORD="${NETX_DB_PASSWORD}" psql \
    -h "${NETX_DB_HOST}" -p "${NETX_DB_PORT}" \
    -U "${NETX_DB_USER}" -d "${NETX_DB_NAME}" \
    -t -A -c "SELECT DISTINCT nasname FROM radius.nas WHERE nasname IS NOT NULL AND nasname !~ '/'" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)

  if [[ -z "${nas_ips}" ]]; then
    log_dim "Nenhum NAS cadastrado em radius.nas — UFW só liberará 22/80/443"
    return 0
  fi

  log_info "Liberando 1812/1813/3799/123 pra NASes cadastrados"
  local ip
  for ip in ${nas_ips}; do
    ufw allow from "${ip}" to any port 1812 proto udp comment "netx-nas:${ip} radius-auth" >/dev/null 2>&1 || true
    ufw allow from "${ip}" to any port 1813 proto udp comment "netx-nas:${ip} radius-acct" >/dev/null 2>&1 || true
    # NTP — necessário se equipamento usar NetX como servidor NTP local
    ufw allow from "${ip}" to any port 123 proto udp comment "netx-nas:${ip} ntp" >/dev/null 2>&1 || true
    log_dim "  ✓ ${ip}"
  done
}
