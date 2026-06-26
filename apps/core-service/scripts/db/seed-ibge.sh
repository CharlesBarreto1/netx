#!/usr/bin/env bash
# =============================================================================
# seed-ibge.sh — popula a referência nacional de municípios do IBGE
# (tabela public.ibge_municipalities) a partir do SQL versionado no repo
# (prisma/seed-ibge.sql). Idempotente (ON CONFLICT DO NOTHING) e OFFLINE —
# não depende da API do IBGE em tempo de install.
#
# Chamado automaticamente pelo install (lib/netx_app.sh) e pelo netx-update.sh,
# logo após o seed canônico (db:seed). Uso manual:
#   npm run -w apps/core-service db:seed:ibge:sql
#
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
# =============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)" # apps/core-service
SQL_FILE="${APP_DIR}/prisma/seed-ibge.sql"

# Resolve .env igual ao safe-migrate.sh: raiz do monorepo OU /etc/netx/.env.
ENV_FILE="${APP_DIR}/../../.env"
[[ ! -f "${ENV_FILE}" ]] && ENV_FILE="/etc/netx/.env"
[[ ! -f "${ENV_FILE}" ]] && { echo "[seed-ibge] ERRO: .env não encontrado" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

[[ -z "${DATABASE_URL:-}" ]] && { echo "[seed-ibge] ERRO: DATABASE_URL ausente no .env" >&2; exit 1; }
[[ -f "${SQL_FILE}" ]] || { echo "[seed-ibge] ERRO: ${SQL_FILE} não encontrado" >&2; exit 1; }

# Prisma anexa `?schema=...&connection_limit=...` na URL; o psql/libpq não
# entende esses parâmetros. Corta a query string — a tabela é schema-qualificada
# em public no próprio SQL, então não dependemos do search_path.
DB_URL="${DATABASE_URL%%\?*}"

echo "[seed-ibge] aplicando ${SQL_FILE}"
psql "${DB_URL}" -v ON_ERROR_STOP=1 -q -f "${SQL_FILE}"
echo "[seed-ibge] OK — municípios IBGE garantidos em public.ibge_municipalities"
