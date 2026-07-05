# FiberMap — módulo de planta externa (OSP v2)

Spec completa: [`FIBERMAP-SPEC.md`](../../../../../FIBERMAP-SPEC.md) na raiz do monorepo.
Fase atual: **FM-0** (fundação) — pastas, catálogo de produtos, atenuação,
schema completo do grafo (elementos, cabos/tubos/fibras, cortes, conexões,
OTDR, medições), seeds e fixture.

## Arquitetura & desvios conscientes da spec

A spec manda respeitar as regras do repo acima do texto dela (§ preâmbulo).
Onde os dois conflitam, decidimos assim:

1. **Namespace `fibermap_` em `public`, não schema Postgres dedicado.**
   `multiSchema` do Prisma 6.10 é preview e exigiria `@@schema` em ~150 models
   existentes; o precedente `radius` (schema SQL-only) abriria mão do client
   Prisma num módulo CRUD-pesado. O prefixo de tabela entrega o mesmo
   agrupamento. `ownedTables: ['public.fibermap_*']` no manifesto.

2. **PostGIS via triggers + `Unsupported`.** Colunas `geom` existem, têm GiST
   e são a fonte pra consultas espaciais (`$queryRaw` com `ST_*`), mas são
   mantidas por trigger a partir de `latitude/longitude` (elementos) e `path`
   JSONB GeoJSON (segmentos) — o CRUD via Prisma continua trivial e não há
   generated columns fora do modelo. `geometric_length_m` idem
   (ST_Length(geom::geography), arredondado a cm).
   ⚠️ Deploy: requer pacote `postgresql-16-postgis-3` no host ANTES de
   `migrate deploy` (a migration faz `CREATE EXTENSION IF NOT EXISTS postgis`,
   que exige superuser). O installer e o `netx-update` já garantem os dois;
   recovery pós-42501 documentado em `docs/RUNBOOK.md` § erros comuns.

3. **`tenant_id` em todas as tabelas, com FK real pra `tenants`** (regra nº 1
   do repo; a spec omite). Relations `User` (createdBy/updatedBy) só nos
   agregados-raiz — filhos (tubos, fibras, segmentos, portas…) carregam
   `created_by_id` escalar quando fizer sentido, pra conter a explosão de
   relations em `User`. Única tabela sem tenant_id: `fibermap_cable_model_tubes`
   e `fibermap_cable_tubes` (pk composta pelo pai, herdam via cascade).

4. **Auditoria via `AuditService`** (tabela global `audit_logs`), não
   `fibermap.audit_log` dedicada. Toda mutação loga (`fibermap.*`).

5. **Unicidade de ponta sob concorrência: `fibermap_connection_endpoints`.**
   Uma UNIQUE em coluna polimórfica dupla (a_*/b_*) não impede a mesma ponta
   aparecer no lado A de uma linha e no lado B de outra. Cada conexão ativa
   grava 2 linhas com a chave canônica da ponta:
   `FIBER:{fiberId}:{A|B}` · `CUT:{cutId}:{U|D}` · `PORT:{portId}:{C|F}`.
   Desfazer fusão = hard-delete dos endpoints + soft-delete da conexão.
   **Face de porta (C/F):** porta física tem adaptador frontal (CONNECTOR) e
   pigtail traseiro (FUSION) independentes — sem isso, DIO de passagem
   (OLT →patch→ DIO →fusão→ cabo) seria impossível. A face deriva do `kind`.

6. **Corte referencia `fibermap_fiber_cuts.id`** (`a_cut_id`/`b_cut_id`), não
   `(fiber, element)` como na spec — FK íntegra e chave de endpoint estável.

7. **Import KML (FM-7) seguirá o padrão preview/commit síncrono** do módulo
   optical (não há BullMQ no repo; jobs longos são RabbitMQ/cron). Uploads de
   foto usam MinIO presigned (StorageService), não `file_path` local.

8. **Rotas em `/v1/fibermap/*`** (prefixo global do core) — via gateway fica
   `/api/v1/fibermap/*`. Spec dizia `/api/fibermap`; o `/v1` é regra do repo.

## Permissões

`fibermap.read` · `fibermap.write` (desenhar planta) · `fibermap.delete` ·
`fibermap.admin` (catálogo + parâmetros). Catálogo em `prisma/seed.ts`;
admin=tudo, operator=read+write, tecnico=read+write, viewer=read.
Licenciamento: entitlement `netx-fibermap` (`@RequiresModule` no controller).

## Seeds & fixture

- `npm run -w apps/core-service db:seed` — inclui catálogo FiberMap (22
  modelos de cabo ABNT/EIA + CEO/CTO/DIO/armário/rack/splitters) e as 19
  chaves de atenuação por tenant (pinadas; nunca sobrescreve edição).
- `npm run -w apps/core-service db:seed:fibermap` — fixture de demonstração
  (POP com rack+DIO+OLT, 3 CEOs, 4 CTOs, 3 cabos, fusões, splitter 1x8,
  corte, reservas) + asserções de aceite do FM-0.
- ⚠️ Ambos importam `@netx/shared` (resolve pra `dist/`): rode
  `npx tsc -p packages/shared` (ou o build do monorepo) antes.

## Fases

- [x] FM-0 fundação (este commit)
- [ ] FM-1 mapa read-only + CRUD + Tela 3 (MapLibre GL JS entra aqui)
- [ ] FM-2 cabos/rotas/reservas · FM-3 editor de emendas · FM-4 trace ·
      FM-5 OTDR · FM-6 power budget · FM-7 KML/polish
