#!/usr/bin/env bash
# =============================================================================
# adopt-existing-db.sh — adota a baseline `0_init` em DB que já tem o schema.
#
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
# Provenance: MDg0NzI5Njg5MDE=
#
# Cenário: o servidor já está em produção, o DB tem dados, e a empresa quer
# começar a usar versionamento Prisma sem resetar.
#
# Uso:
#   cd /opt/netx/apps/core-service        # ou onde o app está instalado
#   DATABASE_URL='postgresql://...' bash scripts/db/adopt-existing-db.sh
#
# O que faz:
#   1. Verifica que a migration `0_init` existe (gerada por generate-baseline).
#   2. Roda `prisma migrate resolve --applied 0_init` — apenas marca a migration
#      como "já aplicada" na tabela `_prisma_migrations`. NÃO toca o schema.
#   3. Daí em diante, `prisma migrate deploy` aplica apenas migrations posteriores.
#
# Idempotente: pode rodar múltiplas vezes; Prisma reconhece marcação prévia.
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/../.."   # apps/core-service

INIT_DIR="prisma/migrations/0_init"
INIT_SQL="$INIT_DIR/migration.sql"

if [[ ! -f "$INIT_SQL" ]]; then
  echo "[adopt] FALHA: $INIT_SQL não existe."
  echo "        Rode primeiro: bash scripts/db/generate-baseline.sh"
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[adopt] FALHA: DATABASE_URL não definido."
  echo "        Use:  DATABASE_URL='postgresql://...' bash $0"
  exit 1
fi

echo "[adopt] Marcando 0_init como aplicada em $DATABASE_URL"
npx prisma migrate resolve --applied 0_init

echo
echo "[adopt] OK — daqui pra frente:"
echo "        npm run db:migrate:deploy   # aplica migrations posteriores"
