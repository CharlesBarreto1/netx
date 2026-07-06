# FiberMap — estado da construção e guia de continuação

> **Para o próximo agente.** A spec é a [`FIBERMAP-SPEC.md`](FIBERMAP-SPEC.md)
> (leia inteira antes de codar). Este arquivo diz o que JÁ existe, onde, quais
> decisões foram tomadas (e por quê divergem da spec), como validar, e como
> atacar as fases restantes. Atualize este arquivo ao fechar cada fase.

Última atualização: 2026-07-06 · último commit relevante: `4049d1e` (main —
FM-7 completa: backend `1f3e3a3` + frontend `4049d1e`). **Todas as fases da
spec (FM-0..FM-7) entregues e validadas** — restam os débitos de polish
listados abaixo e os aceites manuais do Charles.

**2026-07-06 (tarde): FM-8 "Costura" implementada na árvore de trabalho** —
integração assinante↔planta (spec §11), aposentadoria do OSP v1 (módulo
`optical` + estúdio `/mapa` + mapa de rede legado) e migração de dados. Ver
seção "FM-8 · Integração NetX" abaixo. **Pendente: tsc/jest/build no box**
(a máquina onde foi editado não tem Node) e `netx-update`.

## Estado por fase

| Fase | Estado | Entrega |
|---|---|---|
| FM-0 Fundação | ✅ validada + **em prod** | schema (19 tabelas `fibermap_*`), migration `20260705130000_fibermap_foundation`, seeds (22 cabos ABNT/EIA + CEO/CTO/DIO/armário/rack/splitters + 19 chaves de atenuação), fixture com asserções de aceite, testes de cores (jest 10/10) |
| FM-1 Mapa + Tela 3 | ✅ validada + **em prod** | Estúdio `/fibermap` (MapLibre, bbox+cluster, CRUD elementos, fotos MinIO presigned), `/fibermap/settings` (catálogo com preview SVG de cabo + parâmetros de atenuação) |
| FM-2 Cabos | ✅ validada (aguarda `netx-update`) | desenho com snapping/vértices/Backspace, modal novo/continuar cabo, camada de cabos, drawer (ocupação, comprimentos geo/medido/ÓPTICO com reservas, metragem editável), reservas técnicas, árvore de pastas com conteúdo |
| FM-3 Ponto de acesso | ✅ validada (aguarda `netx-update`) | `/fibermap/access-point/[elementId]`: SVG com tubos numerados/fibras coloridas, splitter/DIO/OLT, fundir A→B, cortar/desfazer, Béziers com gradiente + tesoura + perda editável, fusão em sequência, export PNG, botão no popup do estúdio |
| FM-4 Trace | ✅ validada (aguarda `netx-update`) | `trace-graph.ts` puro (grafo + caminhada + `opticalDistance` com marcos) + `FibermapConnectivityGraphService` (componente conexo em ondas), `GET fibers/:id/trace?from=A\|B\|cutId=&cutSide=` e `GET ports/:id/trace` (λ 1310/1490/1550), jest 13 casos com cálculo manual (±0,01 m/dB), painel de trace no access-point (ícone F por fibra/porta, seletor de λ) + "Ver no mapa" → highlight laranja no estúdio |
| FM-5 OTDR | ✅ validada (aguarda `netx-update`) | `otdr-locate.ts` puro (sobra antes do trecho, IN_SLACK/AMBIGUOUS_AFTER_SPLITTER/BEYOND_END, incerteza §5.5.6, expected_events do caminho inteiro), `POST otdr/locate` (ST_LineInterpolatePoint com fração já na orientação armazenada + vizinhos ST_DWithin + snapshot em `fibermap_otdr_readings`), `GET otdr/readings`, jest 10 casos (os 6 obrigatórios + reverso/corte/pra-trás), OtdrModal (estúdio popup + header do access-point) + círculo de incerteza vermelho no mapa; smoke no box: ponto a 0,00 m do esperado (aceite <5 m) |
| FM-6 Power budget | ✅ validada (aguarda `netx-update`) | `GET ports/:id/power-budget` (trace com dBm esperado por evento + TERMINAIS com nível OK/WARN/CRIT e esperado×medido), relatórios `reports/cto-occupancy` · `splice-book?elementId=` · `cable-usage`, calibração `POST cables/:id/calibrate-excess` (mínimos quadrados pela origem, k 0,8–1,25, clamp [1,0·1,2] alinhado ao CHECK), PowerBudgetModal no access-point, jest 7 casos, planilha `docs/fixtures/power-budget-reference.xlsx` gerada do budget REAL da fixture (perda 11,79 dB · Rx −7,79 dBm nas 8 pontas) |
| Vínculo OLT ↔ inventário (extra) | ✅ validada (aguarda `netx-update`) | device OLT só em elemento POP/CABINET + coluna `fibermap_devices.netx_olt_id` (FK → `olts`, índice único parcial: uma OLT do inventário = UM lugar vivo na planta), `GET /fibermap/olts` (fibermap.read) com placement, seletor obrigatório de OLT no DeviceCreateModal (já colocadas aparecem desabilitadas com o elemento), badge de vínculo/status no header do device — migration `20260706150000_fibermap_olt_binding`, decisão nº11 |
| FM-7 KML | ✅ validada (aguarda `netx-update`) | `kml-io.ts` puro (parse tolerante a Tomodat/Google Earth: Folders aninhados, MultiGeometry, sem-nome; tipo por NOME §12 + override `netx-type` em ExtendedData; builder KML 2.2 com Folder por pasta e LineString POR SEGMENTO na cor do cabo), `FibermapKmlService` preview/commit síncrono (transação POR ITEM, snap ≤ 25 m via ST_DWithin senão `POSTE-KML-n`, cabo sem produto + 1 fibra §14.9), rotas `GET export/kml?folderId=` (JSON→Blob) · `POST import/kml/{preview,confirm}` (multipart 20 MB), botões na topbar + KmlImportModal, jest 8 casos; smoke do aceite no box: round-trip export→import com desvio **0,000 m** (tolerância 1 m) |

**Aceites interativos pendentes (manual, Charles):** desenhar cabo ponta a
ponta, reproduzir o cenário dos prints no editor de emendas em <5 min,
60 fps de pan com o seed sintético (`db:seed:fibermap:synthetic`).

## FM-8 · Integração NetX (costura assinante ↔ planta) — 2026-07-06

O FiberMap virou a FONTE DE VERDADE de CTO/porta pro resto do NetX; o OSP v1
foi aposentado. O que existe:

- **Vínculo contrato↔porta**: `contracts.fibermap_port_id` (uuid, unique,
  FK→`fibermap_optical_ports`, SET NULL) — migration
  `20260706180000_contract_fibermap_port`. FK no lado do contrato; a porta
  segue nó puro do grafo.
- **`FibermapSubscriberService`** (`subscriber.service.ts`, exportado pelo
  módulo): `searchCtos` (busca por nome/proximidade KNN + ocupação),
  `listCtoPorts` (FREE/CONNECTED/ASSIGNED), `assignPort`/`releaseByContract`
  (auditados), `getContractPortRef(s)` (resolve CTO/device/porta — o
  `elementName` é o CTO_PORT da Ufinet). Rotas: `GET /fibermap/ctos`,
  `GET /fibermap/ctos/:id/ports`, `POST /fibermap/ports/:id/assign-contract`,
  `POST /fibermap/contracts/:id/release-port`, `GET /fibermap/contracts/:id/port`.
  DTOs em `packages/shared/src/fibermap/subscriber.dto.ts`.
- **Consumidores re-apontados**: provisioning (`installCustomer` aceita
  `fibermapPortId`, vincula ANTES de tocar estoque/OLT e deriva
  CTO_PORT/dropPort pra Ufinet), ufinet-orders (fallback do CTO_PORT via
  porta do contrato), service-orders (`markCtoPortUsed` → FiberMap, com
  fallback legado por nome/número de porta), contracts.cancel (libera a
  porta na mesma TX), field/subscriber360 (mesmo shape, fonte FiberMap),
  field/coverage (PostGIS ST_DWithin/KNN), alarms (correlação CTO por
  `fibermapPort→device→element`; escopo CABLE pelos segmentos que tocam a
  caixa).
- **Frontend**: `SubscriberPortPicker` (components/fibermap) no wizard
  `/provisioning/install/[contractId]` (todos os modos; hint pra Ufinet), no
  `NewContractInline` (opcional; assign pós-criação) e na página do técnico
  `/os/[id]`; card "CTO/Porta" no detalhe do contrato (trocar/liberar).
- **Migração de dados** `20260706190000_fibermap_osp_v1_migration`
  (idempotente, ids preservados): enclosures→elementos (CTO/NAP/SPLITTER→CTO
  + device SPLITTER com portas OUT e IN; EMENDA→CEO; RESERVA→SLACK_COIL),
  `OpticalPort.contractId`→`contracts.fibermap_port_id`, cabos→cabos "sem
  modelo" (1 tubo × N fibras ABNT + 1 segmento com o path original; POLEs
  sintéticos em ponta solta), splices→FUSION quando os dois cabos terminam
  no mesmo elemento migrado. Tudo cai na pasta "Importado OSP v1" por tenant.
- **Removidos**: módulo backend `optical` (13 services), endpoint
  `/mapping/network` (+ NetworkMapService e DTOs), estúdio `/mapa`, páginas
  `/mapping/{network,backbone,technicians}` e `/network/{fiber,optical,
  splices,otdr,pon-tree,power-budget,import-export}`, libs v1 do web.
  `/mapping/customers` (mapa comercial com online RADIUS) FICOU — módulo
  `mapping` enxugado só pra ele; manifest `netx-cpe` perdeu o prefixo
  `/optical`.

**Débitos da FM-8:**
- Tabelas v1 (`optical_*`, `fiber_*`, `network_folders`) seguem no banco como
  legado read-only — dropar em migração futura após validar a planta migrada
  em produção (e remover os modelos v1 + `Contract.opticalPort` do
  schema.prisma na mesma leva).
- Splices "no meio do cabo" (sem elemento comum de terminação) NÃO migraram
  (exigiriam corte de fibra); re-documentar no estúdio se fizerem falta.
- Mapa de clientes segue como tela própria (`/mapping/customers`); candidata
  a virar layer de assinantes online dentro do estúdio num próximo ciclo.
- Validação completa (tsc/jest/build) pendente no box.

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
  trace-graph.ts                       # FM-4: grafo/caminhada PUROS + opticalDistance/fiberPieces
  otdr-locate.ts · otdr.service.ts     # FM-5: caminhada OTDR pura + PostGIS/persistência (+ fitExcessFactor)
  power-budget.ts · power-budget.service.ts · reports.service.ts   # FM-6
  kml-io.ts · kml.service.ts           # FM-7: parse/build KML puros + preview/commit/export
  instantiate-cable.ts                 # snapshot modelo→cabo (service + fixture usam)
  colors.spec.ts                       # jest (aceite FM-0)
  trace-graph.spec.ts                  # jest (aceite FM-4 — cálculo manual documentado)
  otdr-locate.spec.ts                  # jest (aceite FM-5 — 6 casos obrigatórios da spec §13)
  power-budget.spec.ts                 # jest (aceite FM-6 — budget + calibração)
  kml-io.spec.ts                       # jest (aceite FM-7 — round-trip puro + inferência)
docs/fixtures/power-budget-reference.xlsx   # aceite FM-6 (budget real da fixture)
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
  otdr/                                # OtdrModal (FM-5 — estúdio e access-point)
  budget/                              # PowerBudgetModal (FM-6 — header do access-point)
  kml/                                 # KmlImportModal (FM-7 — topbar do estúdio)
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
10. **OTDR (FM-5)** — `otdr-locate.ts` (puro): sobra consumida ANTES do
    comprimento de cada trecho; a fração do ST_LineInterpolatePoint já sai
    convertida pra orientação ARMAZENADA do segmento (sem ST_Reverse no SQL);
    incerteza refinada da §5.5.6: sobras×0,5 + só os metros percorridos sobre
    comprimento GEOMÉTRICO×0,01 (trecho com measured não contribui), min 10 m;
    direção fora da rota do cabo = medição "pra trás" pela conexão da ponta
    A/B; após localizar, a caminhada segue só-eventos até o fim (expected_
    events da curva inteira). Leituras: log histórico sem FK (nomes resolvidos
    best-effort na listagem).
11. **Vínculo OLT ↔ inventário (spec §11)** — coluna real
    `fibermap_devices.netx_olt_id` (FK → `olts`, SET NULL: apagar a OLT do
    inventário não destrói o desenho), NÃO `metadata.netx_olt_id` como a spec
    §3.5 sugere. Trava "uma OLT = UM lugar" = índice único parcial
    (`WHERE deleted_at IS NULL` — soft-delete libera a OLT); regras amigáveis
    no service: OLT só em POP/CABINET, vincular OLT ocupada → 409 com o nome
    do elemento. `GET /v1/fibermap/olts` sob `fibermap.read` (a `/v1/olts`
    exige `olts.admin`).

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
- FM-6: limiares WARN/CRIT do budget são defaults compartilhados +
  query params — a edição por tenant na Tela 3 (spec §10) ficou de fora.
- FM-6: relatórios são só API (`/reports/*`) — sem página na UI; a
  calibração (`calibrate-excess`) também não tem formulário ainda.
- Vínculo OLT: re-vincular/desvincular device OLT existente é só API
  (`PATCH /devices/:id { netxOltId }`) — sem UI; devices OLT antigos (sem
  vínculo) mostram badge âmbar no editor.
- FM-7 (polish da spec §13 que ficou de fora): **dark mode do mapa** (tiles
  OSM são claros; exigiria provider dark configurável — junto com o débito
  de satélite/tiles), **auditoria visível na UI** (histórico do elemento —
  os dados já estão em `audit_logs` com ações `fibermap.*`) e **undo de lote
  do import KML** (fibermap_elements/cables não têm `import_batch_id`;
  exigiria migration — o optical tem esse fluxo pra copiar). Associação de
  modelo em lote pós-import (§12 "re-instancia tubos/fibras") também não
  tem UI — o backend bloqueia associação só se o cabo tiver fusões/cortes.

## Como atacar as próximas fases

**Todas as fases da spec (FM-0..FM-7) estão entregues.** O que resta são os
débitos acima (nenhum bloqueia uso), os aceites manuais do Charles e o
deploy (`netx-update`). Se um novo ciclo abrir, os candidatos naturais são:
UI de relatórios/calibração (FM-6), drag de blocos no editor de emendas,
arrastar vértices de rota, e o polish do FM-7 listado nos débitos.

## Convenções de trabalho

- Commits: conventional em PT (`feat(fibermap): …`), com
  `Co-Authored-By: Claude <modelo> <noreply@anthropic.com>`.
- Uma fase = backend → valida tsc no box → commit → frontend → i18n (3
  dicionários) → validação completa no box → commit → atualizar ESTE arquivo.
- Regras de negócio SEMPRE no service (spec §14), erro amigável + constraint
  como rede de segurança. RFC 7807 sai de graça pelo filtro global.
