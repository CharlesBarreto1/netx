#!/usr/bin/env bash
# =============================================================================
# generate-baseline.sh — gera a migration `0_init` a partir do schema atual.
#
# Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
# Provenance: Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
#
# Uso:
#   cd apps/core-service
#   ./scripts/db/generate-baseline.sh
#
# Quando rodar:
#   - Apenas UMA vez, para criar a migration de baseline do projeto.
#   - Se a migration `0_init` já existe, o script é idempotente: pergunta antes
#     de sobrescrever.
#
# Como funciona:
#   `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma`
#   gera o SQL completo do estado atual do schema. Esse SQL vira a migration
#   `0_init/migration.sql`. Daí em diante, todo `migrate dev`/`migrate deploy`
#   tem um ponto de referência conhecido.
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/../.."   # apps/core-service

INIT_DIR="prisma/migrations/0_init"
INIT_SQL="$INIT_DIR/migration.sql"

if [[ -f "$INIT_SQL" ]] && [[ -s "$INIT_SQL" ]]; then
  echo "[generate-baseline] $INIT_SQL já existe e não está vazio."
  read -rp "Sobrescrever? [y/N] " ans
  [[ "${ans,,}" == "y" ]] || { echo "Abortado."; exit 0; }
fi

mkdir -p "$INIT_DIR"

echo "[generate-baseline] Gerando SQL via prisma migrate diff..."
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$INIT_SQL"

# Sanidade — diff vazio = schema não bateu, abortar
if [[ ! -s "$INIT_SQL" ]]; then
  echo "[generate-baseline] FALHA: arquivo gerado vazio. Verifique prisma/schema.prisma." >&2
  exit 1
fi

LINES=$(wc -l < "$INIT_SQL")
echo "[generate-baseline] OK — $INIT_SQL ($LINES linhas)"
echo
echo "Próximos passos:"
echo "  - DB de DEV (vazio):    npm run db:migrate:dev"
echo "  - DB já com dados:      bash scripts/db/adopt-existing-db.sh"
