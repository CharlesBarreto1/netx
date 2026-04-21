# Runbook — NetX

Procedimentos operacionais para o time de plantão e engenharia.

## Serviços e portas (dev)

| Serviço | Porta | Stack |
|---------|-------|-------|
| API Gateway | 3000 | NestJS |
| Core Service | 3101 | NestJS |
| Web | 3200 | Next.js |
| Postgres | 5432 | 16 |
| Redis | 6379 | 7 |
| RabbitMQ AMQP | 5672 | 3.13 |
| RabbitMQ UI | 15672 | — |
| MailHog | 1025/8025 | — |
| Adminer | 8080 | — |

## Problemas comuns em desenvolvimento

### `DATABASE_URL not set` ao rodar `db:migrate`
Copie `.env.example` para `.env` e certifique-se que o valor tem o formato `postgresql://netx:netx_dev_password@localhost:5432/netx?schema=public`.

### "Tenant not found" no login
Rode `npm run db:seed` para criar o tenant `default` e o usuário admin.

### Porta 3000 ou 5432 ocupada
```bash
lsof -i :3000   # macOS/Linux
netstat -ano | findstr :3000   # Windows
```
Mate o processo ou mude `API_GATEWAY_PORT` no `.env`.

### Prisma client desatualizado
```bash
npm run db:generate
```

### Reset completo do ambiente
```bash
npm run infra:reset && npm run db:migrate && npm run db:seed
```

## Deploy do Módulo 02 (CRM) em VPS já produtivo

Assumindo usuário `netx`, código em `/home/netx/apps/netx` e PM2 sob systemd.

> **Importante sobre nomes de workspaces:** apenas os pacotes em `packages/*` usam o prefixo `@netx/` (ex.: `@netx/shared`, `@netx/auth`). Os apps em `apps/*` são `core-service`, `api-gateway`, `web` — sem prefixo.

```bash
ssh netx@<host>
cd /home/netx/apps/netx
git pull
npm ci

# Pacotes compartilhados primeiro (TS emitido consumido pelos apps)
npm run build --workspace @netx/shared

# Regenerar o Prisma Client (npm ci reinstala node_modules; .prisma/client fica defasado)
npm run db:generate

# Criar + aplicar a migration CRM
npm run -w core-service db:migrate -- --name crm_foundation
# (alternativa com revisão manual do SQL antes de aplicar:)
# npm run -w core-service db:migrate -- --name crm_foundation --create-only
# npm run -w core-service db:migrate:deploy

# Popula permissões CRM (idempotente)
npm run db:seed

# Build dos apps (nomes sem @netx/)
npm run build --workspace core-service
npm run build --workspace api-gateway
npm run build --workspace web

# Reload PM2
pm2 reload ecosystem.config.js --update-env && pm2 save
```
Smoke test:
```bash
TOKEN=$(curl -s -X POST https://<dominio>/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@netx.local","password":"ChangeMe!2026","tenantSlug":"default"}' \
  | jq -r .accessToken)

curl -s https://<dominio>/api/v1/customers \
  -H "Authorization: Bearer $TOKEN" | jq
```
Esperado: lista vazia (`{ data: [], pagination: ... }`) logo após o deploy.

## Produção (preview — será preenchido na Fase 5)

### Rotação de secrets
Todos os secrets vivem no Secret Manager (AWS/GCP/Azure). Rotação:
1. Gere novo secret
2. Suba via ExternalSecrets (SealedSecrets)
3. Rolling restart dos pods
4. Revogue o secret antigo após 24h

### Incident response — Core Service down
1. Verificar `/health` de cada pod
2. Checar logs em Loki: `{service="core-service", level="error"}`
3. Se DB: conferir status da instância RDS/CloudSQL e connection pool
4. Se RabbitMQ: verificar filas com DLQ crescendo
5. Rollback via `helm rollback netx <rev>` se a última release for suspeita

### Restaurar tenant de backup
1. Identificar o backup (snapshot de volume + export Prisma)
2. Restaurar em schema temporário `tenant_restore_<date>`
3. `INSERT ... SELECT` filtrando por `tenant_id` para o schema público
4. Validar integridade com o cliente antes do cutover

## Observabilidade

- **Dashboards Grafana** (a criar): SLO por serviço, latência p99, error budget
- **Alertas PagerDuty**: erro 5xx > 1% por 5min, DLQ RabbitMQ > 100 mensagens
- **Logs Loki**: retenção 30 dias (hot), 1 ano (cold em S3)
- **Traces Tempo**: amostragem 10% em prod, 100% em staging

## Contatos

| Área | Responsável | Canal |
|------|-------------|-------|
| Plataforma | `@netx/platform-team` | Slack `#plataforma` |
| Segurança | `@netx/security-team` | `security@netx.<dominio>` |
| DevOps / SRE | `@netx/devops-team` | Slack `#sre` |
| Data / BI | `@netx/data-team` | Slack `#data` |
