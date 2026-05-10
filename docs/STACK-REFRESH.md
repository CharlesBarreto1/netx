# Stack Refresh — pré-v1.0

> Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.

Pré-lançamento da v1.0 fizemos um refresh do stack pra sair com versões da
"geração 2024 H2" em vez da "2024 H1". Isso evita que entremos em produção
com ESLint 8 (EOL out/2024) e estoquemos dívida que vira urgência depois de
ter cliente real.

## O que mudou

| Categoria | Antes | Agora |
|-----------|-------|-------|
| Node.js (runtime + engines) | 20 | **22 LTS** |
| TypeScript | 5.5 | **5.7** |
| @types/node | 20 | **22** |
| NestJS (`@nestjs/*`) | 10.3 | **11.0** |
| @nestjs/throttler | 5 | **6** |
| @nestjs/swagger | 7 | **11** |
| @nestjs/schedule | 4 | **5** |
| @nestjs/config | 3 | **4** |
| @nestjs/axios | 3 | **4** |
| @types/express | 4 | **5** (Express 5 é default no Nest 11) |
| Prisma + @prisma/client | 5.15 | **6.2** |
| Helmet | 7 | **8** |
| nestjs-cls | 4 | **5** |
| Nx | 19 | **21** |
| ESLint | 8 (EOL) | **9 (flat config)** |
| @typescript-eslint | 7 (separado) | **typescript-eslint 8 (unificado)** |
| eslint-config-prettier | 9 | **10** |
| dotenv-cli | 7 | **8** |
| date-fns | 3 | **4** |
| lucide-react | 0.400 | **0.469** |
| Vários `@radix-ui/*` | 1.1.x antigo | **1.1.x atual** |
| `@dnd-kit/sortable` | 8 | **10** |
| pino-pretty | 11 | **13** |
| argon2 | 0.40 | **0.41** (compat Node 22 native binding) |
| zod | 3.23 | **3.24** |
| GitHub Actions | @v4 (Node 20) | **@v5 (Node 24)** |

## O que NÃO mudou (com motivo)

- **Next.js 14 + React 18.** Bumpar pra 15 + 19 introduz async params em route handlers + mudanças em forwardRef que afetam shadcn/ui. Custo: 2 dias de polimento. Decidido pra v1.1.
- **Tailwind 3.** Tailwind 4 mudou pra config CSS-first (`@theme` em globals.css). Refactor sem benefício funcional pro usuário ISP. v1.1+.
- **cache-manager** (removido inteiro). Estava nas deps mas não era usado em código nenhum.

## O que precisa rodar localmente

A regeneração de lockfile e baseline Prisma 6 são manuais — sandbox sem registry npm.

```bash
# 1. Mac, no repo
cd ~/dev/netx
rm -rf node_modules package-lock.json    # garante tabula rasa
npm install                                # gera package-lock.json novo

# 2. Apaga configs ESLint legados (flat config substitui)
git rm .eslintrc.json .eslintignore apps/web/.eslintrc.json

# 3. Regenera baseline Prisma em 6.x
rm -rf apps/core-service/prisma/migrations/0_init
npm run db:baseline                        # gera prisma/migrations/0_init/migration.sql
npm run db:generate                        # cliente Prisma 6 com novos tipos

# 4. Build + lint
npm run build
npm run lint                               # ESLint 9 flat config

# 5. Commit
git add -A
git commit -m "chore(stack): refresh — Nest 11, Prisma 6, ESLint 9, Node 22, etc"
git push

# 6. Servidor de dev (PM2)
ssh netx@servidor
cd ~/apps/netx
git pull
rm -rf node_modules
npm install
npm run db:generate
npm run db:adopt                           # marca a baseline 0_init como aplicada
npm run db:migrate:deploy                  # aplica migrations posteriores (radacct + must_change_password)
npm run build
pm2 restart netx-core netx-gateway netx-web
pm2 logs netx-core --lines 50              # validar boot
```

## O que pode dar errado e como resolver

### `npm install` falha em `argon2`
Argon2 0.41 tem prebuild pra Node 22. Se o `node-gyp` rebuild explodir,
instale `build-essential python3 make g++` no servidor. PM2 + Node via NVM
costuma já ter.

### `prisma migrate deploy` reclama de drift
Se a tabela `_prisma_migrations` ainda não existe no DB, rode `db:adopt`
**antes** do migrate deploy. Adopt cria a tabela e marca `0_init` como
aplicada — tudo subsequente flui normal.

### ESLint 9 reclama de regras antigas
Erros tipo "Cannot find module '@typescript-eslint/parser'" significam que
o `node_modules` ainda tem cache antigo. `rm -rf node_modules
package-lock.json && npm install` resolve.

### NestJS 11 + algum guard custom dá erro de tipo
`ExecutionContext.switchToHttp().getRequest<Request>()` continua igual.
Se algum guard do projeto fazia cast pra `express.Request` antigo, o tipo
agora vem do `@types/express@5` — verifique o build mas não devem haver
breaking changes em código de aplicação.

### Helmet 8 muda `crossOriginResourcePolicy` default
Em Helmet 8 esse header agora é `same-origin` por default em vez de
`same-site`. Já passamos `'same-site'` explícito no `main.ts` então não
afeta.

### Prisma 6 + `postgresqlExtensions` warning
Continua sendo preview em 6.0/6.1 e estabilizado em alguma 6.x posterior.
Se aparecer warning "preview feature stabilized", remova de
`previewFeatures` em schema.prisma e rode `db:generate` de novo.

## Pós-lançamento (v1.1)

Próxima janela de upgrade:

- **Onda D — Frontend modernization (3-4 dias)**
  - React 18 → 19 + Next 14 → 15
  - Re-gerar componentes shadcn/ui afetados por mudanças em `forwardRef`
  - Codemod Next 15 (`npx @next/codemod@latest`)
  - Async params em route handlers (`params: Promise<{ id: string }>`)
- **Onda E — Tailwind 4 (2 dias)**
  - Migrar `tailwind.config.js` → `@theme` no globals.css
  - Validar visualmente cada página
- **Onda F — Sentry / error reporting (1 dia)**
  - Adicionar `@sentry/node` no core e `@sentry/nextjs` no web
  - Cobre P2-E identificado na auditoria pré-v1.0
