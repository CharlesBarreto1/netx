# FiberMap — estado da construção e guia de continuação

> **Para o próximo agente.** A spec é a [`FIBERMAP-SPEC.md`](FIBERMAP-SPEC.md)
> (leia inteira antes de codar). Este arquivo diz o que JÁ existe, onde, quais
> decisões foram tomadas (e por quê divergem da spec), como validar, e como
> atacar as fases restantes. Atualize este arquivo ao fechar cada fase.

Última atualização: 2026-07-05 · último commit relevante: `1afa761` (main —
FM-4 completa: backend `663f18b` + frontend `1afa761`)

## Estado por fase

| Fase | Estado | Entrega |
|---|---|---|
| FM-0 Fundação | ✅ validada + **em prod** | schema (19 tabelas `fibermap_*`), migration `20260705130000_fibermap_foundation`, seeds (22 cabos ABNT/EIA + CEO/CTO/DIO/armário/rack/splitters + 19 chaves de atenuação), fixture com asserções de aceite, testes de cores (jest 10/10) |
| FM-1 Mapa + Tela 3 | ✅ validada + **em prod** | Estúdio `/fibermap` (MapLibre, bbox+cluster, CRUD elementos, fotos MinIO presigned), `/fibermap/settings` (catálogo com preview SVG de cabo + parâmetros de atenuação) |
| FM-2 Cabos | ✅ validada (aguarda `netx-update`) | desenho com snapping/vértices/Backspace, modal novo/continuar cabo, camada de cabos, drawer (ocupação, comprimentos geo/medido/ÓPTICO com reservas, metragem editável), reservas técnicas, árvore de pastas com conteúdo |
| FM-3 Ponto de acesso | ✅ validada (aguarda `netx-update`) | `/fibermap/access-point/[elementId]`: SVG com tubos numerados/fibras coloridas, splitter/DIO/OLT, fundir A→B, cortar/desfazer, Béziers com gradiente + tesoura + perda editável, fusão em sequência, export PNG, botão no popup do estúdio |
| FM-4 Trace | ✅ validada (aguarda `netx-update`) | `trace-graph.ts` puro (grafo + caminhada + `opticalDistance` com marcos) + `FibermapConnectivityGraphService` (componente conexo em ondas), `GET fibers/:id/trace?from=A\|B\|cutId=&cutSide=` e `GET ports/:id/trace` (λ 1310/1490/1550), jest 13 casos com cálculo manual (±0,01 m/dB), painel de trace no access-point (ícone F por fibra/porta, seletor de λ) + "Ver no mapa" → highlight laranja no estúdio |
| FM-5 OTDR | ⬜ próxima | ver "Como atacar FM-5" abaixo |
| FM-6 Power budget | ⬜ | — |
| FM-7 KML + polish | ⬜ | — |

**Aceites interativos pendentes (manual, Charles):** desenhar cabo ponta a
ponta, reproduzir o cenário dos prints no editor de emendas em <5 min,
60 fps de pan com o seed sintético (`db:seed:fibermap:synthetic`).

## Mapa de arquivos

```
packages/shared/src/fibermap/          # DTOs Zod + cores (FONTE ÚNICA da lógica ABNT/EIA)
  colors.ts                            # ciclos, buildTubeColors/buildCableFiberLayout
  endpoint-key.ts                      # chaves de ocupação (ver decisão nº3)
  *.dto.ts                             # catalog, folder, element, cable, access-point
apps/core-service/src/modules/fibermap/
  README.md                            # decisões/desvios detalhados — LEIA
  fibermap.controller.ts               # todas as rotas /v1/fibermap/*
  folders|catalog|attenuation|elements|element-photos|cables|access-point|connections.service.ts
  connectivity-graph.service.ts        # FM-4: carrega componente conexo (ondas) + endpoints de trace
  trace-graph.ts                       # FM-4: grafo/caminhada PUROS + opticalDistance (OTDR reusa!)
  instantiate-cable.ts                 # snapshot modelo→cabo (service + fixture usam)
  colors.spec.ts                       # jest (aceite FM-0)
  trace-graph.spec.ts                  # jest (aceite FM-4 — cálculo manual documentado)
apps/core-service/prisma/
  migrations/20260705130000_fibermap_foundation/   # DDL manual (CHECKs, GiST, TRIGGERS)
  seed-fibermap.ts                     # catálogo por tenant (chamado pelo seed.ts)
  seed-fibermap-fixture.ts             # planta demo + ASSERÇÕES DE ACEITE (rode sempre)
  seed-fibermap-synthetic.ts           # 5k elementos p/ perf
apps/web/src/lib/fibermap-api.ts       # client único (tipos replicados do shared)
apps/web/src/components/fibermap/
  studio/                              # Tela 1 (FibermapStudio, FibermapMap, drawers, modais)
  settings/                            # Tela 3 (catálogo, CablePreview, atenuação)
  access-point/                        # Tela 2 (AccessPointEditor SVG, layout.ts puro, modais, TracePanel)
apps/web/src/app/(fullscreen)/fibermap/            # estúdio + access-point/[elementId]
apps/web/src/app/(protected)/fibermap/settings/    # Tela 3
```

i18n: namespace `fibermap` (`studio.*`, `settings.*`, `ap.*`) nos TRÊS
dicionários `apps/web/src/i18n/messages/{pt-BR,es-PY,en-US}.ts` — sempre os 3.
Menu: `apps/web/src/lib/menus.ts` (grupo mapping). Permissões:
`fibermap.read|write|delete|admin` (seed.ts). Entitlement `netx-fibermap`.

## Decisões de arquitetura (desvios conscientes da spec)

1. **Tabelas `fibermap_*` no schema `public`**, não schema Postgres dedicado
   (multiSchema do Prisma exigiria `@@schema` em ~150 models legados).
2. **Geometrias PostGIS via TRIGGER**: `geom` é `Unsupported(...)` mantida por
   trigger a partir de `latitude/longitude` (elementos) e `path` JSONB GeoJSON
   `[[lng,lat],…]` (segmentos). `geometric_length_m` idem (ST_Length::geography).
   CRUD via Prisma normal; consultas espaciais via `$queryRaw` com `ST_*`.
3. **Unicidade de ponta óptica = `fibermap_connection_endpoints.endpoint_key`
   UNIQUE** (concorrência-safe): `FIBER:{fiberId}:{A|B}` · `CUT:{cutId}:{U|D}`
   · `PORT:{portId}:{C|F}`. **Porta tem 2 faces** (C=conector frontal,
   F=pigtail/fusão) — sem isso DIO de passagem seria impossível; a face deriva
   do `kind` da conexão. Desfazer = hard-delete endpoints + soft-delete conexão.
4. **Corte referencia `fibermap_fiber_cuts.id`** (`a_cut_id`/`b_cut_id`), não
   `(fiber, element)` como o DDL da spec.
5. **Auditoria via `AuditService`** global (ações `fibermap.*`), sem tabela
   dedicada.
6. **Rotas em `/v1/fibermap/*`** (prefixo global do core; gateway repassa).
7. **Sem BullMQ** (não existe no repo): KML (FM-7) deve seguir o padrão
   preview/commit síncrono de `apps/core-service/src/modules/optical/kml.service.ts`.
8. `tenant_id` + FK em TODAS as tabelas; relations de User só nos agregados-raiz.
9. **Trace (FM-4)** — convenções do grafo (`trace-graph.ts`, módulo puro):
   porta é UM nó (as 2 faces C/F desembocam nele ⇒ passagem de DIO de graça);
   corte U=lado A, D=lado B; peso da aresta de fibra é DIRECIONAL (§5.2: sobra
   conta ao sair, chegada excluída — calculado na travessia, não na aresta);
   **normalização de raiz**: braço que alcança terminal de PORTA (preferência
   OLT) vira o início do caminho apresentado, splitters subidos viram
   `branchTaken` (linear) e abaixo do clique o downstream ramifica (`branches`
   por OUT); desbalanceado: **OUT 1 = ramo TAP**, demais passante, tap_percent
   aproximado pra 10/20/30/50; splitter aplica a MESMA perda nos 2 sentidos.

## Como validar (box 96.126.162.14, worktree `/root/netx-fm0`)

Sem node local nesta máquina — TUDO valida via SSH. Receita (ordem importa):

```bash
cd /root/netx-fm0 && git fetch origin main && git reset --hard origin/main
# DB descartável (superuser p/ CREATE EXTENSION nas migrations)
sudo -u postgres psql -c "CREATE ROLE netx_fm0 LOGIN SUPERUSER PASSWORD 'fm0val2026'"
sudo -u postgres createdb -O netx_fm0 netx_fm0_val
sudo -u postgres psql -d netx_fm0_val -c 'CREATE EXTENSION IF NOT EXISTS postgis'
export DATABASE_URL='postgresql://netx_fm0:fm0val2026@127.0.0.1:5432/netx_fm0_val'

npx tsc -p packages/shared/tsconfig.json      # ANTES dos seeds (ts-node importa dist!)
cd apps/core-service && npx prisma generate && npx prisma migrate deploy
npx ts-node prisma/seed.ts                    # permissões + catálogo fibermap
npx ts-node prisma/seed-fibermap-fixture.ts   # fixture + ACEITES (falha alto)
npx jest src/modules/fibermap --silent
npx tsc -p tsconfig.json --noEmit
cd ../web && npx next typegen && npx tsc --noEmit -p tsconfig.json && npm run build
npm run lint --silent | grep -cE " error "    # esperado: 0
# limpeza
sudo -u postgres psql -c 'DROP DATABASE netx_fm0_val'; sudo -u postgres psql -c 'DROP ROLE netx_fm0'
```

Gotchas: `git config --global --add safe.directory /root/netx-fm0` se der
"dubious ownership"; capture exit do tsc SEM pipe (`> /tmp/t.log; ec=$?`);
NUNCA edite os dicionários i18n com PowerShell 5.1 (`Set-Content` corrompe
UTF-8 — use o Edit tool); `.partial()` do Zod 4 re-injeta `.default()` em
PATCH (remova defaults com `.extend`, ver `UpdateFibermapProductRequestSchema`).

**Deploy prod:** `netx-update` na VM (lê main). PostGIS já instalado lá
(`postgresql-16-postgis-3`). Se uma migration nova falhar com 42501:
`CREATE EXTENSION ... AS postgres` + `prisma migrate resolve --rolled-back
<nome>` + re-rodar migrate (nada de pg_restore — a transação reverte tudo).

## Débitos conhecidos (não bloqueiam fases)

- Editor de emendas: **drag de blocos** não implementado (backend já aceita
  `PATCH /devices/:id { diagramPos }`); layout é automático em 2 colunas.
- FM-2: **arrastar vértices** de rota não tem UI (backend aceita
  `PATCH /segments/:id { path }`); só metragem medida é editável.
- Estúdio: satélite/tiles configuráveis, geocoding Nominatim e checkboxes
  tri-state da árvore (spec §7) ficaram de fora do MVP.
- `element.metadata.diagram_pos` de CABOS no diagrama: não persiste.

## Como atacar as próximas fases

### FM-5 — OTDR (spec §5.5)
- **Tudo que a FM-5 precisa do grafo já existe em `trace-graph.ts`:**
  `walkTrace` devolve `traversedSegments` (com `OpticalHop.reversed` e
  `slackBeforeM` por trecho via `opticalDistanceByIndex`) e os eventos com
  `cumDistanceM` — os `expected_events` saem direto do path do trace; os
  marcos `{elementId, cumM}` saem de `OpticalDistanceResult.milestones`.
- `POST /fibermap/otdr/locate`: resolver o endpoint inicial no elemento de
  referência (ponta/corte; senão posição do elemento na cadeia como marco
  zero), escolher o braço pelo `direction_element_id`, caminhar consumindo
  `slackBeforeM` ANTES do comprimento de cada hop (§5.5.3); quando a
  distância cai num hop: fração geográfica → `$queryRaw`
  `ST_LineInterpolatePoint` (com `ST_Reverse` se `hop.reversed`). Persistir
  em `fibermap_otdr_readings` (tabela pronta). Flags IN_SLACK,
  AMBIGUOUS_AFTER_SPLITTER (um candidato por ramo), BEYOND_END; incerteza
  §5.5.6 (±10 m mínimo). `FibermapConnectivityGraphService` é exportado pelo
  module — injete e reuse `loadComponent`/`walkTrace` (métodos privados hoje:
  expor o que precisar em vez de duplicar).
- Casos de teste obrigatórios estão no aceite da fase na spec §13 (meio de
  segmento, dentro de sobra, após fusão entre cabos, após splitter, além do
  fim, measured divergente do geométrico).
- UI: modal no estúdio + círculo de incerteza (nova source, padrão da
  `fibermap-trace` em `FibermapMap.tsx`) + botão OTDR no header do
  access-point (pré-preenchido com o elemento).

### FM-6 — Power budget (spec §5.4)
- Traversal downstream a partir de porta de OLT usando o grafo do FM-4;
  perdas da tabela `fibermap_attenuation_defaults` (19 chaves; helpers de
  leitura em `attenuation.service.ts#get`). Splitter desbalanceado: chaves
  `UNBALANCED_{p}_TAP/PASS`. Gerar a planilha de referência
  `docs/fixtures/power-budget-reference.xlsx` (aceite).

### FM-7 — KML + polish
- Import: copie o fluxo preview/commit de `optical/kml.service.ts`
  (JSZip + fast-xml-parser com `processEntities:false`), mapeando pra
  elementos/cabos do fibermap (cabo sem produto = badge "sem modelo",
  `product_id null` — spec §14.9). Export: Placemarks + LineStrings.
- Aceite: round-trip export→import num DB limpo (tolerância 1 m).

## Convenções de trabalho

- Commits: conventional em PT (`feat(fibermap): …`), com
  `Co-Authored-By: Claude <modelo> <noreply@anthropic.com>`.
- Uma fase = backend → valida tsc no box → commit → frontend → i18n (3
  dicionários) → validação completa no box → commit → atualizar ESTE arquivo.
- Regras de negócio SEMPRE no service (spec §14), erro amigável + constraint
  como rede de segurança. RFC 7807 sai de graça pelo filtro global.
