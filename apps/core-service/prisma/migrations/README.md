# Prisma migrations — NetX core-service

> Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.

## Estrutura

```
prisma/migrations/
├─ migration_lock.toml          ← provider lock (postgresql)
├─ 0_init/migration.sql         ← baseline (gerada pelo script)
├─ <timestamp>_<name>/...       ← migrations subsequentes
└─ fix_radacct_nullability.sql  ← hotfix legacy (DEPRECATED — virou migration formal)
```

## Quando rodar o quê

| Cenário | Comando |
|---------|---------|
| **Dev local — DB vazio, primeira vez** | `npm run db:baseline && npm run db:migrate:dev` |
| **Dev local — adicionar nova migration** | `npm run db:migrate:dev -- --name <nome>` |
| **Servidor — primeira instalação** | `npm run db:migrate:deploy` (installer já faz) |
| **Servidor — DB com dados, primeira adoção do versionamento** | `npm run db:adopt` (vê `scripts/db/adopt-existing-db.sh`) |
| **Servidor — atualizar app já em produção** | `npm run db:migrate:deploy` |

## Por que existe um baseline (0_init)

Sem migration baseline, `prisma migrate dev` detecta que o schema do DB não bate com nenhuma migration registrada e oferece resetar o banco. **Foi assim que perdemos dados em sprints anteriores.**

A baseline registra "este é o estado inicial conhecido do schema" e impede o reset acidental.

## Adotando a baseline em DB já em produção (ZERO downtime)

Use o script `scripts/db/adopt-existing-db.sh`:

```bash
cd apps/core-service
DATABASE_URL="postgresql://..." bash scripts/db/adopt-existing-db.sh
```

Ele apenas marca a migration `0_init` como `applied` na tabela `_prisma_migrations` (via `prisma migrate resolve --applied 0_init`). **Não toca o schema.** Daí em diante, próximos `migrate deploy` rodam normais.
