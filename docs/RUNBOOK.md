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

## Processos PM2 em produção

| Processo PM2 | App (workspace) | CWD na VPS | Porta |
|--------------|-----------------|------------|-------|
| `netx-core` | `core-service` | `/home/netx/apps/netx/apps/core-service` | 3101 |
| `netx-gateway` | `api-gateway` | `/home/netx/apps/netx/apps/api-gateway` | 3000 |
| `netx-web` | `web` | `/home/netx/apps/netx/apps/web` | 3200 |

> **Importante.** O nome do processo no PM2 (`netx-*`) é diferente do nome do
> workspace npm (`core-service`, `api-gateway`, `web`). Sempre use os nomes da
> tabela acima em `pm2 reload <name>` / `pm2 logs <name>`.

## Mapa de prefixos npm

| Tipo | Prefixo | Exemplos |
|------|---------|----------|
| Apps (`apps/*`) | **sem** prefixo | `core-service`, `api-gateway`, `web` |
| Packages (`packages/*`) | `@netx/` | `@netx/shared`, `@netx/database`, `@netx/auth`, `@netx/config`, `@netx/logger` |

Use sempre `npm run <script> --workspace <name>` com o **nome literal** acima.

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

## Pré-push obrigatório (local)

Antes de `git push`, rode esses comandos. Eles fazem o que o CI também faz, mas
muito mais barato — você pega o erro em segundos em vez de descobrir 5 minutos
depois no build da VPS.

```bash
# 1) lockfile coerente com package.json
npm install                              # idempotente; só atualiza se algo mudou

# 2) build do shared (apps consomem o JS emitido)
npm run build --workspace @netx/shared

# 3) build de cada app que você tocou
npm run build --workspace web            # se mexeu em apps/web
npm run build --workspace core-service   # se mexeu em apps/core-service
npm run build --workspace api-gateway    # se mexeu em apps/api-gateway

# 4) lint
npm run lint
```

> **Atalho:** `npm run preflight` (ver `package.json`) faz install + build do
> shared + build do app que você tocou + lint.

Se algum passo falhar, **resolva antes do push**. O Next 14 com
`experimental.typedRoutes: true` faz typecheck **depois** do "Compiled
successfully" — nunca confie no log do webpack sozinho.

## Deploy completo (back + front + DB) em VPS

Use quando há mudanças em `apps/core-service`, `apps/api-gateway`, schema Prisma
ou pacotes compartilhados.

```bash
ssh netx@<host>
cd /home/netx/apps/netx
git pull origin main

# Lockfile sempre atualizado pelo dev — npm ci é idempotente e estrito
npm ci

# Pacotes compartilhados primeiro (TS emitido consumido pelos apps)
npm run build --workspace @netx/shared

# Regenerar Prisma client (npm ci reinstala node_modules; .prisma/client fica stale)
npm run db:generate

# Migrations: deploy só aplica o que já está commitado em prisma/migrations
npm run -w core-service db:migrate:deploy
npm run db:seed                          # idempotente — popula permissões novas

# Build dos apps (nomes sem @netx/)
npm run build --workspace core-service
npm run build --workspace api-gateway
npm run build --workspace web

# Reload PM2 (zero-downtime; --update-env recarrega variáveis do ecosystem)
pm2 reload ecosystem.config.js --update-env && pm2 save
pm2 status
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

## Deploy frontend-only

Use quando a mudança é **só em `apps/web/`** (sem migration Prisma, sem alterar
`core-service`, `api-gateway` ou packages). Bem mais rápido.

```bash
ssh netx@<host>
cd /home/netx/apps/netx
git pull origin main

# Se você atualizou deps do web, o lockfile DEVE estar atualizado no commit.
# npm ci é estrito; se quebrar com EUSAGE, leia "Lockfile fora de sincronia" abaixo.
npm ci

# Garante NEXT_PUBLIC_* estão setados antes do build (são bakeadas no bundle).
grep NEXT_PUBLIC /home/netx/apps/netx/apps/web/.env.production || \
  echo "AVISO: .env.production sem NEXT_PUBLIC_API_URL — confira antes de continuar"

npm run build --workspace web
pm2 reload netx-web
pm2 status
pm2 logs netx-web --lines 30
```

Atalho one-liner:
```bash
cd /home/netx/apps/netx && \
git pull origin main && \
npm ci && \
npm run build --workspace web && \
pm2 reload netx-web && \
pm2 status
```

## Rollback rápido

```bash
cd /home/netx/apps/netx
git log --oneline -10                    # pega o SHA bom anterior
git checkout <sha-anterior>
npm ci
npm run build --workspace @netx/shared   # se o pacote mudou
npm run build --workspace web            # ou core-service / api-gateway
pm2 reload netx-web                      # ou netx-core / netx-gateway
pm2 status
```

Para voltar à `main` depois: `git checkout main && git pull && <rebuild + reload>`.

## Erros comuns no deploy

### `npm ci` falha com `EUSAGE: lock file ... out of sync`

Causa: alguém adicionou/removeu deps em `package.json` mas esqueceu de regerar
o `package-lock.json`. Mensagem típica: `Missing: <pacote>@<versão> from lock file`.

**Correção definitiva (no laptop do dev):**
```bash
npm install                              # regenera o lockfile
git add package-lock.json
git commit -m "chore: update lockfile"
git push origin main
```

**Workaround imediato na VPS** (use só para destravar deploy quente — sempre
volte ao fluxo correto depois):
```bash
npm install                              # também sincroniza, mas pode mexer em deps transitivas
```

### `Module not found: Can't resolve '<pacote>'` no `next build`

Geralmente é consequência do problema acima. Resolva o lockfile, rode `npm ci`
de novo (ou `npm install` em emergência), e refaça o build.

### `Type error: ... is not assignable to type 'RouteImpl<string>'`

Causa: alguém passou uma string montada em runtime para `router.push` /
`router.replace` / `<Link href>`. O `experimental.typedRoutes: true` em
`next.config.mjs` exige rotas analisáveis estaticamente.

**Correto:** use template literal cuja base é uma rota conhecida.
```ts
router.replace(`/customers/${id}?${qs.toString()}`);
```

**Errado:** concatenação opaca.
```ts
router.replace(url.pathname + url.search);   // ❌ TS não consegue provar
```

Veja `docs/CONVENTIONS-FRONTEND.md` para a regra completa.

### `Type 'Promise<void> | null' is not assignable to type 'void | Promise<void>'`

Causa: callback `onConfirm`/`onClick` definido como `() => cond && fn()`. Quando
`cond` é falsa, a expressão devolve `null`/`false` e o tipo do retorno vira
`null | Promise<void>` ou `false | Promise<void>`, que não casa com a assinatura
do prop.

**Correto:**
```tsx
onConfirm={() => {
  if (cond) return fn();          // retorno é Promise<void> | undefined  → ok
}}
```

**Errado:**
```tsx
onConfirm={() => cond && fn()}    // ❌ retorna null | Promise<void>
```

Veja `docs/CONVENTIONS-FRONTEND.md` para o padrão completo.

### `pm2 reload web` retorna `Process or Namespace web not found`

O processo se chama `netx-web`, não `web`. Veja a tabela "Processos PM2" no
topo deste runbook. Em caso de dúvida: `pm2 status`.

### Bundle do Next aponta para o backend errado em produção

`NEXT_PUBLIC_*` é **bakeada** no bundle no momento do `next build`. Mudar o
`.env.production` depois do build **não tem efeito**. Sempre:

1. Edite `.env.production`.
2. Rode `npm run build --workspace web`.
3. `pm2 reload netx-web`.

### `next build` reclama de `_next/static` 404 depois do reload

PM2 às vezes mantém um worker antigo apontando para `.next` que foi sobrescrito.
Force restart:
```bash
pm2 delete netx-web
pm2 start ecosystem.config.js --only netx-web
pm2 save
```

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
