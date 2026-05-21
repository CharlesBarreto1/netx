# NetX

**Plataforma SaaS multinacional para provedores de internet (ISP).**

Sistema modular, multi-tenant e event-driven que integra as operações administrativas, técnicas, fiscais, comerciais e de atendimento de um ISP em um único ecossistema, com IA nativa.

> **Estado atual** — Fase 1 do MVP em produção. Já implementados: Core (auth + MFA TOTP, multi-tenant, RBAC, audit), CRM completo (clientes PF/PJ BR+PY, pipeline/deals, endereços, contatos, consentimentos LGPD), Contratos + faturas + RADIUS (PPPoE/IPoE, CoA), Financeiro (caixas, cobranças avulsas), Service Orders, Portal do Cliente, Estoque (produtos/compras/serial/comodato), Rede (POPs + equipamentos multi-vendor), WhatsApp (Evolution), SIFEN (PY), Backups. Detalhes em `docs/ROADMAP.md`.

> **Software proprietário** — Copyright © 2024-2026 **NETX DESENVOLVIMENTO E TECNOLOGIA LTDA**
> CNPJ 57.118.236/0001-44 — Av. Paulista, 1471, Sala 511 — São Paulo / SP — Brasil
> Contato comercial: charles@camponet.com.br · +55 (44) 9131-9175
> Distribuição não autorizada. Veja [`LICENSE`](./LICENSE) e [`NOTICE.md`](./NOTICE.md).
> <!-- pv:Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE= -->

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js 24 + NestJS 11 + TypeScript 5.9 |
| Frontend Web | Next.js 16 (App Router, typedRoutes) + React 19 + Tailwind CSS 4 + primitivos caseiros + SWR |
| Validação | Zod 4 |
| ORM | Prisma 6 (PostgreSQL 16) |
| Cache / Fila | Redis 7 + RabbitMQ |
| Monorepo | Nx 22 |
| Qualidade | ESLint 9 (flat config) + Prettier + Husky + Conventional Commits |
| CI/CD | GitHub Actions (actions @v5, Node 24 runtime) |

---

## Estrutura

```
netx/
├── apps/
│   ├── api-gateway/       # BFF + gateway (NestJS)
│   ├── core-service/      # Backend principal (NestJS) — agrega todos os módulos
│   │   └── src/modules/   # audit, auth, backups, contracts, crm, crypto,
│   │                      # disconnect, finance, health, network, portal,
│   │                      # prisma, radius, reports, roles, service-orders,
│   │                      # sifen, stock, tenants, users, whatsapp
│   └── web/               # Frontend operacional (Next.js 16 + App Router)
│       └── src/app/
│           ├── (protected)/   # dashboard, customers, contracts, deals,
│           │                  # finance, invoices, stock, network,
│           │                  # service-orders, reports, chat, settings
│           ├── portal/        # portal self-service do cliente
│           └── receipts/      # impressão (matricial, fatura, etc.)
├── packages/
│   ├── shared/            # DTOs, contratos, tipos compartilhados (Zod)
│   ├── database/          # Prisma client centralizado
│   ├── auth/              # Utils JWT, hashing, policies
│   ├── config/            # Config tipada (Zod)
│   └── logger/            # Logger estruturado (Pino)
├── infra/
│   ├── docker/            # docker-compose para dev local
│   └── k8s/               # Manifestos Kubernetes (stubs)
├── docs/                  # Arquitetura, multi-tenancy, runbook, conventions
├── scripts/               # Preflight, install-vps, utilitários
└── .github/workflows/     # CI
```

---

## Quickstart

**Pré-requisitos:** Node.js 24.x, npm 10+, Docker, Docker Compose.

```bash
# 1. Instalar dependências
npm install

# 2. Subir infra local (Postgres, Redis, RabbitMQ, MailHog)
npm run infra:up

# 3. Configurar variáveis de ambiente
cp .env.example .env

# 4. Gerar Prisma client e rodar migrations
npm run db:generate
npm run db:migrate

# 5. Popular dados iniciais (tenant default, admin, permissões)
npm run db:seed

# 6. Rodar tudo em paralelo
npm run dev
```

Serviços expostos:

| Serviço | URL |
|---------|-----|
| API Gateway (Swagger) | http://localhost:3000/api/docs |
| Core Service | http://localhost:3101 |
| Web (Next.js) | http://localhost:3200 |
| PostgreSQL (Adminer) | http://localhost:8080 |
| RabbitMQ Management | http://localhost:15672 |
| MailHog (SMTP web) | http://localhost:8025 |

---

## Scripts principais

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | Sobe todos os apps em modo desenvolvimento |
| `npm run build` | Build de todos os projetos |
| `npm run test` | Roda todos os testes |
| `npm run lint` | ESLint em todo o monorepo |
| `npm run format` | Prettier em todo o código |
| `npm run infra:up` / `infra:down` | Sobe / derruba containers |
| `npm run db:migrate` | Aplica migrations Prisma |
| `npm run db:studio` | Abre Prisma Studio |
| `npm run preflight:web` | Checa lockfile + build + lint do web (pré-push) |
| `npm run preflight:core` | Idem para `core-service` |
| `npm run preflight:gateway` | Idem para `api-gateway` |
| `npm run preflight` | Roda preflight completo (todos os apps) |

---

## Multi-tenancy

A plataforma é multi-tenant desde o dia um. A estratégia de isolamento default é **tenant_id em todas as tabelas + Row-Level Security no Postgres**. Leia `docs/MULTI-TENANCY.md` antes de criar qualquer entidade nova.

---

## Documentação

| Doc | Conteúdo |
|-----|----------|
| `docs/ARCHITECTURE.md` | Visão de arquitetura do monorepo |
| `docs/MULTI-TENANCY.md` | Design e RLS de multi-tenancy |
| `docs/RUNBOOK.md` | Deploy, troubleshooting, PM2, rollback |
| `docs/CONTRIBUTING.md` | Workflow, commits, preflight, DoD |
| `docs/CONVENTIONS-FRONTEND.md` | **Obrigatório** para qualquer mudança em `apps/web` — typedRoutes, callbacks, lockfile, env vars |
| `docs/SECURITY.md` | Modelo de ameaças e práticas |
| `docs/ROADMAP.md` | Fases e entregas |
| `docs/modules/02-crm.md` | Documentação do Módulo 02 (CRM) |
| `docs/adr/` | Architecture Decision Records |

## Contribuindo

Siga `docs/CONTRIBUTING.md`. Usamos **Conventional Commits** e `husky` roda `lint-staged` antes de cada commit. Rode `npm run preflight:<app>` antes de `git push`.

---

## Licença

Proprietária — © 2026 NetX. Todos os direitos reservados.
