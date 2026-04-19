# Arquitetura — NetX

> Este documento descreve a arquitetura de referência do NetX. Deve ser lido antes de começar qualquer novo módulo.

## 1. Visão geral

O NetX é organizado como um **monorepo (Nx)** contendo múltiplos **microsserviços NestJS** expostos por um **API Gateway**, um **frontend Next.js** e **packages compartilhados**. A comunicação é **API-first**: REST público no Gateway e mensageria assíncrona (RabbitMQ) entre serviços internos.

```
┌────────────┐     ┌──────────────┐     ┌────────────────┐
│  Web (SPA) │──▶──│ API Gateway  │──▶──│ Core Service   │
│  Next.js   │     │   NestJS     │     │    NestJS      │
└────────────┘     └──────┬───────┘     └────┬───────────┘
                          │ HTTP              │ SQL
                          ▼                   ▼
                   ┌────────────┐        ┌──────────┐
                   │  RabbitMQ  │◀──────▶│ Postgres │
                   └────────────┘        └──────────┘
```

Serviços adicionais (CRM, Billing, RADIUS, OLT, Chatbot, IA) seguem o mesmo template do Core: um módulo NestJS, schema Prisma próprio (ou compartilhado), eventos publicados em exchanges dedicados.

## 2. Princípios

| Princípio | Implementação |
|-----------|---------------|
| API-first | OpenAPI gerado automaticamente; DTOs validados por Zod (`@netx/shared`) |
| Multi-tenant estrito | `tenantId` em toda entidade, RLS no Postgres (quando habilitado), CLS para propagação |
| Event-driven | Exchanges por domínio (`core.users`, `billing.invoices`); consumidores idempotentes |
| Observabilidade | Logs estruturados (Pino), traces OTel, métricas Prometheus, correlation id end-to-end |
| Segurança em camadas | JWT + refresh rotacionado, argon2id, RBAC + ACL, secrets fora do código |
| Infra como código | Docker Compose para dev, Kubernetes/Helm para staging/prod (roadmap) |

## 3. Componentes

### 3.1 API Gateway (`apps/api-gateway`)
- Recebe tráfego público HTTP
- Aplica Helmet, CORS, rate limiting, correlation id
- Proxya para os microsserviços internos (hoje: apenas core-service)
- Agrega OpenAPI/Swagger de cada serviço
- Não fala com o banco nem conhece regras de negócio

### 3.2 Core Service (`apps/core-service`) — Módulo 1
- Tenants, Users, Roles, Permissions, Sessions, ApiKeys, Audit
- JWT (HS256) com access/refresh rotação
- Resolução de tenant por subdomínio, header ou claim JWT
- Guards globais: `JwtAuthGuard` + `PermissionsGuard`
- Audit log append-only em `audit_logs`

### 3.3 Packages compartilhados
- `@netx/shared`: DTOs (Zod), tipos de domínio, envelopes de erro (RFC 7807)
- `@netx/config`: schema Zod do `.env` — fonte única de verdade para config
- `@netx/auth`: argon2id, JWT signer/verifier, geração de API keys
- `@netx/database`: wrapper do Prisma Client com singleton
- `@netx/logger`: factory Pino (JSON em prod, pretty em dev)

## 4. Estratégia multi-tenant
Veja `MULTI-TENANCY.md`.

## 5. Observabilidade

### Logs
Todos os serviços emitem JSON com campos: `service`, `env`, `level`, `time`, `msg`, `correlationId`, `tenantId`, `userId`. `nestjs-pino` injeta automaticamente via CLS.

### Tracing
Interface OpenTelemetry pronta (`OTEL_EXPORTER_OTLP_ENDPOINT`). Em produção, exportar para Tempo/Jaeger/Datadog.

### Métricas
Cada serviço exporá `/metrics` (Prometheus) — TODO no MVP. Métricas-chave: latência P50/P95/P99 por endpoint, taxa de erro, fila RabbitMQ (comprimento, idade), Prisma query count.

## 6. Deploy (roadmap)
- **Dev:** Docker Compose local
- **Staging:** K8s (EKS/GKE), 1 réplica por serviço
- **Prod:** K8s multi-região, HPA, PodDisruptionBudget, NetworkPolicies, cert-manager

## 7. Decisões arquiteturais (ADRs)

As decisões relevantes serão registradas como ADRs em `docs/adr/`:

1. **ADR-001** — Monorepo Nx vs. polyrepo → **Monorepo**
2. **ADR-002** — NestJS vs. Fastify puro → **NestJS** (produtividade, DX, módulos)
3. **ADR-003** — Prisma vs. TypeORM → **Prisma** (migrations, type-safety)
4. **ADR-004** — Multi-tenancy: schema-per-tenant vs. tenant_id + RLS → **tenant_id + RLS**
5. **ADR-005** — Autenticação: session vs. JWT stateful vs. stateless + refresh → **JWT stateless + refresh rotacionado**
6. **ADR-006** — Mensageria: RabbitMQ vs. Kafka → **RabbitMQ** no MVP; Kafka na Fase 3+ (ingestion de telemetria)

Novos ADRs seguem o template em `docs/adr/ADR-000-template.md`.
