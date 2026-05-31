#!/usr/bin/env bash
# sync-firewall.sh — re-roda firewall_sync_radius_nas após mudança em NetworkEquipment.
#
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
#
# Pode ser chamado pelo NetworkEquipmentService após create/update/delete:
#   sudo /opt/netx/infra/installer/scripts/sync-firewall.sh
#
# Requer sudoers que permita o user `netx` rodar este script sem senha:
#   echo "netx ALL=(root) NOPASSWD: /opt/netx/infra/installer/scripts/sync-firewall.sh" \
#     | sudo tee /etc/sudoers.d/netx-firewall
set -euo pipefail

INSTALLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETX_ETC="${NETX_ETC:-/etc/netx}"

# shellcheck source=../lib/common.sh
source "${INSTALLER_DIR}/lib/common.sh"

# Carrega secrets persistentes
# shellcheck disable=SC1091
[[ -f "${NETX_ETC}/.secrets" ]] && source "${NETX_ETC}/.secrets"
# shellcheck disable=SC1091
[[ -f "${NETX_ETC}/.env" ]] && set -a && source "${NETX_ETC}/.env" && set +a

# DB defaults — fallback se .env não carregou as vars individualmente
NETX_DB_HOST="${NETX_DB_HOST:-localhost}"
NETX_DB_PORT="${NETX_DB_PORT:-5432}"
NETX_DB_NAME="${NETX_DB_NAME:-netx}"
NETX_DB_USER="${NETX_DB_USER:-netx}"

# Se NETX_DB_PASSWORD não estiver setado mas DATABASE_URL sim, extrai
if [[ -z "${NETX_DB_PASSWORD:-}" && -n "${DATABASE_URL:-}" ]]; then
  NETX_DB_PASSWORD=$(echo "${DATABASE_URL}" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
fi

# shellcheck source=../lib/firewall.sh
source "${INSTALLER_DIR}/lib/firewall.sh"

firewall_sync_radius_nas
log_ok "Firewall sincronizado com radius.nas"
