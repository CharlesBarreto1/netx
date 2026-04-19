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
4. **Abra PR** para `develop`; revisão mínima de 1 reviewer (2 para módulos críticos)
5. **Squash-merge** após aprovação

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

## Definition of Done

Uma tarefa está pronta quando:

- [ ] Código passa em `npm run lint` e `npm run test`
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
