#!/usr/bin/env bash
# sync-ntp.sh — regenera /etc/chrony/conf.d/netx-allows.conf após mudança em
# NetworkEquipment.
#
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
#
# Pode ser chamado pelo backend após create/update/delete de equipment:
#   sudo /opt/netx/infra/installer/scripts/sync-ntp.sh
#
# Requer sudoers (vide install do core-service):
#   netx ALL=(root) NOPASSWD: /opt/netx/infra/installer/scripts/sync-ntp.sh
set -euo pipefail

INSTALLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETX_ETC="${NETX_ETC:-/etc/netx}"

# shellcheck source=../lib/common.sh
source "${INSTALLER_DIR}/lib/common.sh"

# shellcheck disable=SC1091
[[ -f "${NETX_ETC}/.secrets" ]] && source "${NETX_ETC}/.secrets"
# shellcheck disable=SC1091
[[ -f "${NETX_ETC}/.env" ]] && set -a && source "${NETX_ETC}/.env" && set +a

NETX_DB_HOST="${NETX_DB_HOST:-localhost}"
NETX_DB_PORT="${NETX_DB_PORT:-5432}"
NETX_DB_NAME="${NETX_DB_NAME:-netx}"
NETX_DB_USER="${NETX_DB_USER:-netx}"

if [[ -z "${NETX_DB_PASSWORD:-}" && -n "${DATABASE_URL:-}" ]]; then
  NETX_DB_PASSWORD=$(echo "${DATABASE_URL}" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
fi

# shellcheck source=../lib/chrony.sh
source "${INSTALLER_DIR}/lib/chrony.sh"

chrony_sync_allowlist
log_ok "NTP allowlist sincronizada com network_equipment"
