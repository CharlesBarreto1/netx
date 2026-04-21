#!/usr/bin/env bash
# Diagnostica 400 "Invalid query parameters" em GET /v1/customers na VPS.
#
# Uso (na VPS como usuário `netx`):
#   bash scripts/diagnose-customers-400.sh <email> <senha> <tenantSlug>
#
# Exemplo:
#   bash scripts/diagnose-customers-400.sh admin@netx.local 'ChangeMe!2026' default
#
# O script:
#   1. Faz login e pega um accessToken
#   2. Chama GET /api/v1/customers?page=1&pageSize=20 com o token
#   3. Exibe o corpo da resposta — em caso de 400, o array `errors[]` diz
#      exatamente qual campo o Zod rejeitou.
#
set -euo pipefail

EMAIL="${1:?uso: $0 <email> <senha> <tenantSlug>}"
PASS="${2:?uso: $0 <email> <senha> <tenantSlug>}"
SLUG="${3:?uso: $0 <email> <senha> <tenantSlug>}"

BASE="${BASE:-https://netx.zux.net.br}"

echo "==> Login em $BASE ..."
LOGIN_BODY=$(curl -sS -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"tenantSlug\":\"$SLUG\"}")

TOKEN=$(echo "$LOGIN_BODY" | jq -r '.accessToken // empty')
if [[ -z "$TOKEN" ]]; then
  echo "Falha no login:"
  echo "$LOGIN_BODY" | jq .
  exit 1
fi
echo "   OK (token length=${#TOKEN})"

echo
echo "==> GET /api/v1/customers?page=1&pageSize=20 ..."
curl -sS -w "\nHTTP %{http_code}\n" \
  "$BASE/api/v1/customers?page=1&pageSize=20" \
  -H "Authorization: Bearer $TOKEN" | tee /tmp/netx-customers-response.json
echo

echo "==> GET no gateway local (bypass Nginx) ..."
curl -sS -w "\nHTTP %{http_code}\n" \
  "http://localhost:3000/api/v1/customers?page=1&pageSize=20" \
  -H "Authorization: Bearer $TOKEN"
echo

echo "==> GET no core-service local (bypass gateway) ..."
curl -sS -w "\nHTTP %{http_code}\n" \
  "http://localhost:3101/v1/customers?page=1&pageSize=20" \
  -H "Authorization: Bearer $TOKEN"
echo

echo
echo "Se o campo \"errors\" da primeira resposta apontar para 'page' ou 'pageSize',"
echo "o build de @netx/shared na VPS está desatualizado. Rode:"
echo
echo "  cd /home/netx/apps/netx"
echo "  npm run build --workspace @netx/shared"
echo "  npm run build --workspace core-service"
echo "  pm2 reload netx-core"
echo
