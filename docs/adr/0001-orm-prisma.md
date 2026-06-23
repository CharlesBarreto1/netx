# ADR 0001 — Prisma como ORM/migrations do apps/api

- Status: aceito
- Data: 2026-06-19

## Contexto

O AGENTS.md fixa Postgres + TimescaleDB e NestJS, mas não definia o ORM nem a ferramenta
de migrations do `apps/api`. Precisávamos escolher antes de modelar `Device`, `Interface`,
`Event`, `ConfigSnapshot` e `AuditLog`.

## Decisão

Usar **Prisma**.

Motivos:

- Alinhamento com o restante da suíte NetX (o produto principal usa Prisma) — mesma
  convenção, menor custo cognitivo para o time.
- Migrations declarativas e `prisma generate` com tipos fortes casam com o `strict: true`.

## Consequências

- **TimescaleDB**: hypertables e políticas de retenção NÃO são modeladas pelo Prisma. As
  séries temporais (`MetricPoint`) são escritas pelo **Telegraf** direto no TSDB, e o
  `CREATE EXTENSION timescaledb` / `create_hypertable` é feito por SQL de init
  (`infra/initdb/`) e pelos templates do output do Telegraf — fora do schema Prisma.
- O schema Prisma cobre só o modelo relacional. Se no futuro precisarmos consultar métricas
  pelo Prisma, usaremos `queryRaw` ou uma view, sem tentar mapear hypertable como model.

## Alternativas consideradas

- **Drizzle**: melhor para SQL custom (hypertables), mas diverge do resto do NetX.
- **TypeORM**: integração nativa com NestJS, porém menos ergonômico e não usado na suíte.
