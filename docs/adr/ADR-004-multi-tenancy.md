# ADR-004 — Estratégia de Multi-tenancy

- **Status:** Aceito
- **Data:** 2026-04-19
- **Autores:** @netx/core-team

## Contexto

O NetX é um SaaS multinacional para ISPs. Precisamos decidir como isolar dados entre tenants (cada ISP). A escolha afeta performance, custo operacional, segurança e time-to-market.

## Opções consideradas

1. **Tenant-id + RLS no Postgres** — uma única base, coluna `tenant_id` em cada tabela, policies RLS como rede de segurança.
2. **Schema-per-tenant** — um schema Postgres por ISP, migrations aplicadas N vezes.
3. **Database-per-tenant** — uma instância por ISP (grandes contas), hospedagem separada.
4. **Híbrido** — opção 1 no core; opção 3 para enterprise com isolamento regulatório.

## Decisão

Adotamos a **Opção 4 (Híbrido)**: `tenant_id` + RLS como padrão, com suporte a instâncias dedicadas para contas enterprise sob contrato específico.

## Consequências

**Positivas**
- Onboarding instantâneo (trial sem fricção)
- Evolução de schema em uma migration apenas
- Analytics cross-tenant simples (produto)
- Custo por tenant pequeno

**Negativas**
- Risco de vazamento cross-tenant por bug de código — mitigado por RLS + CLS + testes de isolamento obrigatórios
- Ruído em queries ao ignorar `tenant_id` em joins — Prisma repositories injetam automaticamente

**Mitigações**
- RLS habilitado em toda tabela de negócio
- `@netx/database` expõe `forTenant(tenantId)` que aplica `SET LOCAL app.current_tenant_id`
- CI bloqueia PRs que adicionem tabelas sem `tenant_id`

## Referências

- [Multi-tenant architectures — AWS well-architected](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/)
- [Postgres Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- PostgreSQL RLS pitfalls — Notes from Supabase engineering
