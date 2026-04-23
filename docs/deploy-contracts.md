# Deploy — Módulo Contratos (VPS)

Sequência pronta para copiar e colar no shell da VPS após o `git pull`.
Cobre: migration do schema (`Contract`, `ContractInvoice`, `RadiusEvent` +
enums), instalação do novo pacote `@nestjs/schedule`, rebuild de shared/core/web
e smoke test do fluxo ponta-a-ponta.

## 0. SSH e pull

```bash
ssh netx@<host>
cd /home/netx/apps/netx
git fetch --all
git pull origin main
```

## 1. Instalar dependências

> `package.json` do `core-service` ganhou `@nestjs/schedule`. Como o lockfile
> não foi regerado localmente, usar `npm install` (não `npm ci`) nessa
> primeira passagem para ajustar o lock.

```bash
npm install
```

Se quiser validar que o cron módulo entrou:

```bash
npm ls @nestjs/schedule
```

## 2. Build do pacote compartilhado

```bash
npm run build --workspace @netx/shared
```

## 3. Migration do banco

Se ainda não existir migration para o módulo Contratos, gere agora:

```bash
# Cria a migration a partir do diff do schema.prisma e aplica no banco
npm run -w core-service db:migrate -- --name add_contracts_module
```

> `db:migrate` roda `prisma migrate dev`, que cria o arquivo SQL em
> `apps/core-service/prisma/migrations/<timestamp>_add_contracts_module/` e
> aplica no banco. **Commitar o resultado** no fim do deploy.

Se a migration já foi commitada anteriormente, use o modo deploy (idempotente):

```bash
npm run -w core-service db:migrate:deploy
```

Regerar o Prisma Client com os novos modelos:

```bash
npm run db:generate
```

## 4. Seed (permissões novas)

O seed foi estendido com `contracts.read / write / delete / admin` e associa
aos papéis `admin`, `operator`, `viewer`. Rodar é idempotente:

```bash
npm run db:seed
```

## 5. Build dos apps

```bash
npm run build --workspace core-service
npm run build --workspace api-gateway
npm run build --workspace web
```

## 6. Reload PM2

```bash
pm2 reload ecosystem.config.js --update-env && pm2 save
pm2 status
pm2 logs netx-core --lines 50 --nostream
```

Procurar no log de boot do `netx-core`:

- `Nest application successfully started`
- referência ao `ContractsController` e `ContractInvoicesController` nas rotas
- `ScheduleModule` inicializado

## 7. Smoke test ponta-a-ponta

Defina o domínio e pegue o token:

```bash
export DOMAIN=https://<dominio>

TOKEN=$(curl -s -X POST "$DOMAIN/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@netx.local","password":"ChangeMe!2026","tenantSlug":"default"}' \
  | jq -r .accessToken)

echo "TOKEN length: ${#TOKEN}"
```

### 7.1 Listar clientes (pegar um UUID pra usar)

```bash
CUSTOMER_ID=$(curl -s "$DOMAIN/api/v1/customers?pageSize=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')
echo "CUSTOMER_ID=$CUSTOMER_ID"
```

### 7.2 Criar contrato

```bash
CONTRACT=$(curl -s -X POST "$DOMAIN/api/v1/contracts" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d @- <<JSON
{
  "customerId": "$CUSTOMER_ID",
  "pppoeUsername": "smoketest.$(date +%s)",
  "pppoePassword": "senha123",
  "installationAddress": "Rua de teste, 123 - Bairro - Cidade/UF",
  "monthlyValue": 99.90,
  "bandwidthMbps": 500,
  "dueDay": 10
}
JSON
)
echo "$CONTRACT" | jq

CONTRACT_ID=$(echo "$CONTRACT" | jq -r .id)
echo "CONTRACT_ID=$CONTRACT_ID"
```

Esperado: `status: "ACTIVE"`, `activatedAt` preenchido.

### 7.3 Conferir se a 1ª fatura foi gerada

```bash
curl -s "$DOMAIN/api/v1/contracts/$CONTRACT_ID/invoices" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {id, amount, dueDate, status, reference}'
```

Esperado: 1 fatura `OPEN` com amount `99.90` e `reference` tipo `"Mensalidade 05/2026"` (próximo mês, dia 10).

### 7.4 Simular inadimplência → suspensão automática

Opcionalmente, dispare o scan manualmente (rota admin) — sem esperar o cron das 06:00:

```bash
curl -s -X POST "$DOMAIN/api/v1/contracts/_tasks/run-overdue-scan" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Não vai suspender nada porque a fatura ainda não venceu; só confirma que o endpoint responde `200`.

### 7.5 Dar baixa na fatura

```bash
INVOICE_ID=$(curl -s "$DOMAIN/api/v1/contracts/$CONTRACT_ID/invoices" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

curl -s -X POST "$DOMAIN/api/v1/contract-invoices/$INVOICE_ID/pay" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"note":"smoke test"}' | jq '{id, status, paidAt, paidAmount}'
```

Esperado: `status: "PAID"`, `paidAt` preenchido.

### 7.6 Evento no RADIUS stub

```bash
curl -s "$DOMAIN/api/v1/contracts/$CONTRACT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '{id, status, suspendReason, pppoeUsername}'
```

Para inspecionar a fila de eventos do RADIUS (via psql — só se o usuário tem acesso ao banco):

```bash
psql "$DATABASE_URL" -c "SELECT id, action, status, pool, contract_id, created_at FROM radius_events ORDER BY created_at DESC LIMIT 5;"
```

### 7.7 Limpeza

```bash
curl -s -X POST "$DOMAIN/api/v1/contracts/$CONTRACT_ID/cancel" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"note":"smoke test cleanup"}' | jq '{id, status, cancelledAt}'

curl -s -X DELETE "$DOMAIN/api/v1/contracts/$CONTRACT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

## 8. Commitar migration gerada

Se o passo 3 criou uma nova pasta em `apps/core-service/prisma/migrations/`,
volte pra máquina de dev, faça pull, e commite:

```bash
git add apps/core-service/prisma/migrations
git add package-lock.json
git commit -m "chore(contracts): migration add_contracts_module + lockfile"
git push
```

## 9. Rollback rápido

Se algo der errado:

```bash
# Rollback do código
git reset --hard <commit-anterior>
npm ci
npm run build --workspace @netx/shared
npm run build --workspace core-service
npm run build --workspace api-gateway
npm run build --workspace web
pm2 reload ecosystem.config.js --update-env

# Rollback do schema (destrutivo — apaga tabelas do módulo)
npm run -w core-service db:migrate -- --name rollback_contracts_module
# …ou, em ambiente de staging, prisma migrate reset --force
```

## Notas

- O cron `OverdueScanService` dispara diariamente às **06:00** do fuso do
  container. Confira `TZ` do PM2 / host (`date` deve refletir o horário
  esperado da operação).
- Geração antecipada de faturas usa `LEAD_DAYS = 15`. No primeiro dia que cair
  dentro dessa janela a próxima fatura aparece.
- Carência de inadimplência é `OVERDUE_GRACE_DAYS = 5`. Dá pra tunar via env
  depois; hoje é constante no código.
- RADIUS é stub: grava intenção em `radius_events`. Worker real vem em
  iteração posterior.
