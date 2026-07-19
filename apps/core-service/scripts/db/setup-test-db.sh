#!/usr/bin/env bash
# Prepara o banco dos testes de integração.
#
# Precisa de superuser do Postgres: as extensões (postgis, citext, ...) só podem
# ser criadas por superuser, e as migrations falham sem elas. Roda uma vez por
# máquina; depois disso `npm run test:e2e` se vira sozinho.
#
# Uso:  npm run db:test:setup
set -euo pipefail

DB_NAME="${TEST_DB_NAME:-netx_test}"
DB_OWNER="${TEST_DB_OWNER:-netx}"
PSQL_SUPER="${PSQL_SUPER:-sudo -u postgres psql}"

case "$DB_NAME" in
  *_test) ;;
  *)
    echo "ERRO: TEST_DB_NAME='$DB_NAME' não termina em '_test'." >&2
    echo "Este script derruba e recria o banco. Recusando por segurança." >&2
    exit 1
    ;;
esac

echo "==> recriando banco '$DB_NAME' (dono: $DB_OWNER)"
$PSQL_SUPER -q -c "DROP DATABASE IF EXISTS ${DB_NAME};"
$PSQL_SUPER -q -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_OWNER};"

echo "==> criando extensões (exigem superuser)"
for ext in "uuid-ossp" pgcrypto citext pg_trgm postgis; do
  $PSQL_SUPER -d "$DB_NAME" -q -c "CREATE EXTENSION IF NOT EXISTS \"${ext}\";"
  echo "    - ${ext}"
done

echo
echo "Pronto. O schema é aplicado automaticamente pelo globalSetup do Jest."
echo "Rode:  npm run test:e2e"
