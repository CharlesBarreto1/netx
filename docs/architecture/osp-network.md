# Rede / Planta óptica (OSP) no NetX

## Resumo executivo

O módulo **Rede** modela a planta óptica externa (Outside Plant) de um ISP FTTH: POPs, equipamentos ativos (BNG/OLT/Switch), caixas ópticas (CTOs/NAPs/Splitters), cabos de fibra, fusões e drops até o cliente. Sobre essa base modelamos cálculos operacionais que o técnico de campo usa todo dia: **power budget** (potência prevista entre OLT e ONT em dB) e **OTDR analyzer** (input de distância de evento → pino no mapa).

Inspiração de UX e features: **Tomodat** (sistema brasileiro de gestão de OSP que vários ISPs do interior usam). Mas com integração nativa NetX: a porta de splitter já sabe qual contrato está ligado nela, o ONT já reporta RX/TX dBm, o mapa é o mesmo que a aba de Mapeamento de clientes.

## Estado anterior (Fase 0)

Antes deste módulo, o NetX tinha:

- **NetworkPop** sem geo, só metadata.
- **NetworkEquipment** (BNG/OLT/Switch/Router) com creds criptografadas, sem geo.
- **Olt + Ont** com modo DIRECT (SSH) e EXTERNAL (orquestrador externo), métricas RX/TX dBm no ONT.
- **Contract** com lat/lng adicionado em maio 2026 — o cliente já é geolocalizado.
- **Mapa Leaflet/OSM** funcionando em `/mapping/customers/`, com `LocationPicker` reutilizável.
- **0** modelos pra fibra, fusão, splitter, cabo. A planta óptica era invisível no sistema.

## Decisões técnicas

### Mapa: Leaflet + OSM (mantido)

Leaflet já está integrado e funciona offline em VPS sem chave de API. OSM é grátis e suficiente pro Brasil/Paraguai. Mapbox/Google Maps trariam dependência de billing externo sem ganho proporcional.

Pra cabos (polylines) vamos adicionar `react-leaflet` polyline + plugin de edição (`leaflet-editable` ou hand-rolled).

### Geometrias: GeoJSON no Postgres (Decimal arrays, não PostGIS)

PostGIS seria a escolha técnica perfeita pra `LineString`, `intersects`, `distance`. Mas requer instalar extensão na VPS, complicar backup, deploy, etc. **Decisão**: armazenar polylines como `Json` (array de `[lat, lng]`) e fazer cálculos geográficos em JS via [turf.js](https://turfjs.org/). Turf é tree-shakeable, pegamos só `@turf/length`, `@turf/along`, `@turf/distance`. Perda: queries espaciais SQL diretas; ganho: zero ops, deploy idêntico.

Revisitar se algum cliente passar de ~5 mil km de fibra mapeada.

### Power budget: tabela de coeficientes editável

Valores padrão (ITU-T G.984.5 + prática de campo):

| Componente | Loss típico |
|---|---|
| Conector SC/APC | 0.5 dB |
| Fusão (splice) | 0.1 dB (ou medido) |
| Splitter 1:2 | 3.5 dB |
| Splitter 1:4 | 7.0 dB |
| Splitter 1:8 | 10.5 dB |
| Splitter 1:16 | 14.0 dB |
| Splitter 1:32 | 17.0 dB |
| Splitter 1:64 | 20.5 dB |
| Fibra @ 1310 nm | 0.4 dB/km |
| Fibra @ 1490 nm | 0.3 dB/km |
| Fibra @ 1550 nm | 0.25 dB/km |

Tabela vai em `tenant_settings` (já existe). Cada tenant pode ajustar. Cálculo: traversal do grafo da fibra do ONT até a OLT, somando losses.

Comparação automática com `Ont.lastRxPower` (já existe) → alerta se diff > 3dB (degradação real vs orçada).

### OTDR: input manual, não parse de .sor

Parser de arquivo `.sor` (Bellcore) é projeto à parte — formato binário proprietário, dezenas de variantes por fabricante (EXFO, Yokogawa, Anritsu, Viavi). **V1**: técnico digita a distância em km que o OTDR reportou; sistema marca o ponto no cabo. **V2 talvez**: importar `.sor` com lib pyOTDR (Python) via job assíncrono — fica fora do escopo agora.

### IDs de fibra: dual nomenclatura (TIA-598 + número)

Cabos de fibra são identificados por número (1..N) e cor (TIA-598: azul, laranja, verde, marrom, cinza, branco, vermelho, preto, amarelo, violeta, rosa, aqua, então tubo segue idem). Vamos guardar `fiberIndex: number` no schema, mas a UI mostra "Fibra 3 (verde)" pra técnico de campo se familiarizar.

## Modelos planejados

Vão direto no `schema.prisma` principal, namespace `Network*`/`Optical*` pra agrupamento visual:

```prisma
// Já existem ─────────────────────────────────────────
model NetworkPop { ... +latitude/longitude (R1) }
model NetworkEquipment { ... +latitude/longitude (R1) }
model Olt { ... +latitude/longitude (R1) }
model Ont { ... }  // sem mudança

// R2 ─────────────────────────────────────────────────
enum OpticalEnclosureType { CTO, NAP, SPLITTER, EMENDA }
enum SplitterRatio { ONE_TO_2, ONE_TO_4, ONE_TO_8, ONE_TO_16, ONE_TO_32, ONE_TO_64 }
enum OpticalPortStatus { FREE, RESERVED, USED, DAMAGED }

model OpticalEnclosure {
  id              String
  tenantId        String
  code            String  // CTO-001, NAP-A-12
  type            OpticalEnclosureType
  latitude        Decimal
  longitude       Decimal
  mountType       String?  // POSTE, AÉREO, SUBTERRÂNEO, PAREDE
  parentId        String?  // cascateamento
  splitterRatio   SplitterRatio?  // só pra type=SPLITTER
  capacity        Int      // # portas físicas (16, 32, 64)
  notes           String?
  ports           OpticalPort[]
  // audit fields padrão
}

model OpticalPort {
  id              String
  enclosureId     String
  number          Int        // 1..capacity
  status          OpticalPortStatus
  contractId      String?    // FK ↔ Contract (1 contrato por porta)
  // unique(enclosureId, number)
}

// R3 ─────────────────────────────────────────────────
enum FiberCableType { BACKBONE, DISTRIBUTION, DROP }

model FiberCable {
  id              String
  tenantId        String
  code            String     // CABO-BB-001
  type            FiberCableType
  fiberCount      Int        // 2, 6, 12, 24, 48, 96, 144, 288
  path            Json       // LineString GeoJSON [[lat,lng], ...]
  lengthMeters    Decimal    // calculado do path OR override manual
  notes           String?
  splicesA        FiberSplice[]  @relation("CableA")
  splicesB        FiberSplice[]  @relation("CableB")
}

// R4 ─────────────────────────────────────────────────
model FiberSplice {
  id              String
  tenantId        String
  latitude        Decimal
  longitude       Decimal
  cableAId        String
  fiberAIndex     Int        // qual fibra do cabo A
  cableBId        String
  fiberBIndex     Int        // qual fibra do cabo B
  lossDb          Decimal?   // medido OR usa default tenant
  photoUrl        String?    // MinIO
  notes           String?
  // unique(cableAId, fiberAIndex) — fibra só pode ter 1 splice por lado
  // unique(cableBId, fiberBIndex)
}

// R6 ─────────────────────────────────────────────────
enum FiberEventType { BREAK, BEND, REFLECTION, ATTENUATION, OTHER }

model FiberEvent {
  id              String
  tenantId        String
  cableId         String     // cabo onde ocorreu
  distanceKm      Decimal    // distância informada pelo OTDR
  latitude        Decimal    // calculado a partir do path do cabo
  longitude       Decimal
  type            FiberEventType
  reportedAt      DateTime
  resolvedAt      DateTime?
  technicianId    String?    // User
  photoUrl        String?
  notes           String?
}
```

## Fases (entrega incremental)

Cada fase entrega valor sozinha. Pode parar entre fases sem o sistema ficar inconsistente.

### R1 — Geo nos equipamentos existentes (2 dias)

Adicionar `latitude/longitude` em `NetworkPop`, `NetworkEquipment`, `Olt`. Integrar `LocationPicker` nos forms. Página `/mapping/network` renderiza pinos coloridos por tipo. Sem isso, o resto do roadmap não tem visualização decente — toda CTO precisa eventualmente referenciar uma OLT mãe na visualização.

### R2 — Caixas ópticas + portas (4 dias)

Models `OpticalEnclosure` + `OpticalPort`. CRUD backend. UI: caixas no mapa com cor por % ocupação (verde<50%, amarelo<80%, vermelho≥80%). Modal de detalhe lista portas, permite atribuir uma a um `Contract` (busca por nome do cliente ou código do contrato). No detail de `Contract` vira read-only "Atendido em CTO-001 porta 7".

### R3 — Cabos de fibra (5 dias)

Model `FiberCable` com path GeoJSON. Editor: técnico clica pontos no mapa pra desenhar o cabo. Click no cabo desenhado mostra capacidade. Endpoint que retorna FeatureCollection GeoJSON dos cabos pra carregar tudo de uma vez. Sem fusões ainda — fibras individuais não existem como entidades, só agregado.

### R4 — Fusões/emendas (4 dias)

Model `FiberSplice`. Permite criar fusões num ponto geográfico ligando uma fibra do cabo A com uma do cabo B. Detail de cabo mostra tabela: "Fibra 1 (azul) → fundida em [coords] com Cabo CABO-DIST-003 fibra 5 (laranja), loss 0.08 dB". Foto opcional anexada via MinIO (Fase 0 já preparou).

### R5 — Power budget (3 dias)

Algoritmo de traversal: dado `Contract.ontId`, busca a porta de splitter (R2), o cabo drop (R3), as fusões pra trás (R4), até chegar na OLT. Soma losses + comprimento de fibra. Endpoint `GET /v1/network/power-budget?contractId=X` retorna breakdown JSON. UI: card no detail de `Contract`: "Loss orçado: 24.3 dB · Loss medido (RX): 23.8 dB · Diff: -0.5 dB ✓". Alerta vermelho se diff > 3 dB.

### R6 — OTDR analyzer (4 dias)

Form: seleciona um cabo, input distância em km do evento. Backend usa `@turf/along` pra encontrar o ponto exato no `path` do cabo. Salva como `FiberEvent`. Pino vermelho no mapa marcando o evento + linha pontilhada até a origem. Histórico de eventos por cabo. Filtros: ativos/resolvidos, tipo, período.

### R7 — Vista de árvore PON (5 dias)

Diagrama lógico (não-geográfico) tipo Tomodat: OLT na raiz → cabos backbone → splitters intermediários → cabos drop → ONTs como folhas. Lib provável: [react-flow](https://reactflow.dev/) (renderização de grafos com pan/zoom). Click em ONT navega pro Contract. Click em splitter abre detail. Filtros: por status RADIUS, por OLT, por % saturação de splitter.

## Permissões RBAC

Adicionar:

- `network.read` — já existe, escopo expande pra CTOs/cabos/fusões
- `network.write` — escopo expande
- `network.delete` — escopo expande
- `network.osp.admin` — novo: criar/editar tabela de coeficientes de power budget

## Integração com módulos existentes

- **Contract**: ganha campo "porta óptica" (R2 atribui)
- **Provisioning install wizard**: passo novo "atribuir CTO + porta"
- **App mobile**: técnico de campo escolhe porta livre da CTO mais próxima ao instalar (Fase 1 do mobile)
- **Service Orders**: tipo "rompimento de fibra" cria automaticamente um `FiberEvent` referenciando o cabo afetado

## Pontos abertos

- Como representar **anéis de proteção** (rota A + rota B pro mesmo destino)? Fica pra v1.1.
- **Múltiplos splitters em cascata** dentro da mesma caixa CTO: schema atual permite `parentId`, mas UI vai ficar confusa. Decidir quando R2 chegar lá.
- **Permissões granulares por POP/região**: hoje quem tem `network.write` mexe em toda a planta. Algumas ISPs grandes querem "técnico só edita CTOs da regional dele". Fica pra v2.
- **Histórico de portas** (quem ocupou antes): vale auditar via AuditService padrão? Ou criar `OpticalPortHistory` dedicado? Provavelmente o primeiro, eu uso o segundo se a query ficar pesada.
