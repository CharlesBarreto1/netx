# NetX

**Plataforma SaaS multinacional para provedores de internet (ISP).**

Sistema modular, multi-tenant e event-driven que integra as operações administrativas, técnicas, fiscais, comerciais e de atendimento de um ISP em um único ecossistema, com IA nativa.

> Este repositório contém o **scaffolding + Módulo Core** (autenticação, multi-tenancy, RBAC, auditoria). Os demais 19 módulos serão incorporados seguindo o roadmap em `docs/ROADMAP.md`.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Node.js 20 + NestJS 10 + TypeScript 5 |
| Frontend Web | Next.js 14 (App Router, typedRoutes) + React 18 + TailwindCSS + primitivos caseiros + SWR |
| ORM | Prisma 5 (PostgreSQL 16) |
| Cache / Fila | Redis 7 + RabbitMQ |
| Monorepo | Nx 19 |
| Qualidade | ESLint + Prettier + Husky + Conventional Commits |
| CI/CD | GitHub Actions |

---

## Estrutura

```
netx/
├── apps/
│   ├── api-gateway/       # BFF + gateway (NestJS)
│   ├── core-service/      # Módulo 1 — Core (NestJS)
│   └── web/               # Frontend operacional (Next.js)
├── packages/
│   ├── shared/            # DTOs, contratos, tipos compartilhados
│   ├── database/          # Prisma client centralizado
│   ├── auth/              # Utils JWT, hashing, policies
│   ├── config/            # Config tipada (Zod)
│   └── logger/            # Logger estruturado (Pino)
├── infra/
│   ├── docker/            # docker-compose para dev local
│   └── k8s/               # Manifestos Kubernetes (stubs)
├── docs/                  # Arquitetura, multi-tenancy, runbook
├── scripts/               # Scripts utilitários
└── .github/workflows/     # CI
```

---

## Quickstart

**Pré-requisitos:** Node.js 20.x, npm 10+, Docker, Docker Compose.

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
