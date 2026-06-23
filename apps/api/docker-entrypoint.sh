#!/bin/sh
# Entrypoint da API: aplica migrations (idempotente) e sobe o servidor.
# Roda de /repo/apps/api. Falha cedo se a migration falhar.
set -e

echo "[netx-nms-api] aplicando migrations (prisma migrate deploy)…"
pnpm exec prisma migrate deploy

echo "[netx-nms-api] iniciando API…"
exec node dist/main.js
