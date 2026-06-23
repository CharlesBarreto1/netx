#!/usr/bin/env bash
# Baixa as MIBs padrão para o receptor de traps do Telegraf resolver OIDs.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/mibs"
mkdir -p "$DIR"
docker run --rm -v "$DIR":/out ubuntu:22.04 bash -c '
  apt-get update -qq >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq snmp snmp-mibs-downloader >/dev/null
  download-mibs >/dev/null 2>&1 || true
  cp -rn /var/lib/mibs/ietf/. /out/ 2>/dev/null || true
  cp -rn /var/lib/mibs/iana/. /out/ 2>/dev/null || true
  cp -rn /usr/share/snmp/mibs/. /out/ 2>/dev/null || true'
echo "MIBs em $DIR: $(ls "$DIR" | wc -l)"
