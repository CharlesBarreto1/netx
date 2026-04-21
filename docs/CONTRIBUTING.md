# Guia de Contribuição — NetX

## Setup local

```bash
git clone <repo>
cd netx
nvm use                 # usa a versão em .nvmrc
npm install
cp .env.example .env
npm run infra:up
npm run db:generate && npm run db:migrate && npm run db:seed
npm run dev
```

## Workflow

1. **Crie uma branch** a partir de `develop`: `feat/<escopo>-<resumo>`, `fix/<escopo>-<resumo>`
2. **Faça commits pequenos** seguindo Conventional Commits
3. **Rode testes locais**: `npm run lint && npm run test`
4. **Rode o preflight** antes de push (ver seção "Pré-push obrigatório" abaixo)
5. **Abra PR** para `develop`; revisão mínima de 1 reviewer (2 para módulos críticos)
6. **Squash-merge** após aprovação

## Pré-push obrigatório

Antes de `git push`, rode o preflight para pegar localmente os mesmos erros que
quebrariam o deploy na VPS:

```bash
npm run preflight:web          # se tocou apps/web
npm run preflight:core         # se tocou apps/core-service
npm run preflight:gateway      # se tocou apps/api-gateway
npm run preflight              # tudo (mais lento — roda todos os apps)
```

O script (`scripts/preflight.sh`) verifica:

1. Lockfile em sincronia (se você adicionou dep sem rodar `npm install`, avisa).
2. Build do `@netx/shared`.
3. Build do app alvo (`next build` faz tipecheck estrito — pega typedRoutes,
   retorno de handlers, `any`, etc.).
4. Lint do monorepo.

Falhou algum? **Resolva antes do push.** Ver `docs/CONVENTIONS-FRONTEND.md`
para os padrões que previnem os erros mais comuns do frontend.

## Conventional Commits

Formato: `<type>(<scope>): <subject>`

**Types aceitos:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Scopes (ver `commitlint.config.js`):** `core`, `api-gateway`, `web`, `auth`, `tenants`, `users`, `rbac`, `audit`, `crm`, `billing`, `fiscal`, `radius`, `ipam`, `olt`, `tr069`, `ftth`, `voip`, `chatbot`, `ai`, `inventory`, `tickets`, `noc`, `portal`, `bi`, `infra`, `ci`, `docs`, `deps`

Exemplos:
- `feat(auth): adicionar MFA TOTP com backup codes`
- `fix(rbac): evitar escalonamento ao editar próprio papel`
- `docs(multi-tenancy): detalhar RLS em queries raw`

## Padrões de código

- **TypeScript strict** em todo código
- **Zod** para toda validação de entrada (body, query, env)
- **Prisma** para acesso a dados — **nunca** SQL inline sem revisão de 2 engenheiros
- **Todas as entidades** com `tenantId` (ver `docs/MULTI-TENANCY.md`)
- **Logs estruturados** via `nestjs-pino` — nunca `console.log`
- **Imports** ordenados (ESLint `import/order`)
- **Frontend**: siga `docs/CONVENTIONS-FRONTEND.md` (typedRoutes, callbacks,
  lockfile, env vars, permissões) — não é sugestão, é obrigatório

## Adicionando dependências

Sempre que mudar um `package.json` (raiz ou workspace):

```bash
npm install                              # regenera o package-lock.json
git add package.json package-lock.json   # commite os DOIS no mesmo commit
```

Motivo: a VPS usa `npm ci`, que é estrito. Se o lockfile não refletir o
`package.json`, o deploy falha com `EUSAGE: lock file ... out of sync`. Ver
`docs/RUNBOOK.md#erros-comuns-no-deploy` para o workaround emergencial.

## Definition of Done

Uma tarefa está pronta quando:

- [ ] Código passa em `npm run lint` e `npm run test`
- [ ] `npm run preflight:<app>` passa localmente (inclui build estrito)
- [ ] Lockfile atualizado no mesmo commit quando deps mudam
- [ ] Cobertura de testes da mudança ≥ 70%
- [ ] DTOs validados por Zod
- [ ] Logs de auditoria adicionados para ações sensíveis
- [ ] Permissões RBAC configuradas
- [ ] Swagger/OpenAPI atualizado
- [ ] Documentação (`docs/`) atualizada quando aplicável
- [ ] Testado manualmente em ambiente local
- [ ] PR aprovada por pelo menos 1 reviewer

## Segurança

Vulnerabilidades devem ser reportadas em privado para `security@netx.<dominio>`. **Nunca** abra uma issue pública.

Nunca comite:
- Secrets (JWT, DB passwords, API keys)
- `.env` ou `.env.local`
- Dumps de dados de clientes
- Screenshots com PII
