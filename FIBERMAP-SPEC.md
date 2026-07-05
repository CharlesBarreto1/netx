# NetX — Módulo FiberMap: Documentação de Rede Óptica Externa (OSP)

> **Prompt de implementação para Claude Code.** Este documento é a especificação completa do módulo de mapeamento e documentação de planta externa do NetX. Leia integralmente antes de escrever qualquer código. Siga as fases na ordem definida na Seção 13. Respeite as regras de arquitetura do repositório (`AGENTS.md` / `CLAUDE.md`), em especial: nenhuma chamada de longa duração dentro de request HTTP; PostGIS/SQL para geoprocessamento; zero dependência de LLM neste módulo.

---

## 1. Visão geral

O FiberMap é o módulo de documentação de rede óptica do NetX, inspirado no Tomodat (uso autorizado como referência). Ele substitui a documentação precária atual por um sistema onde:

- Toda a planta externa (POPs, armários, postes, CEOs, CTOs, cabos) é desenhada e mantida sobre um mapa georreferenciado.
- Cada cabo conhece seus tubos e fibras (padrão de cores ABNT ou EIA), e cada fibra conhece suas fusões, splitters, conectores e terminações.
- O sistema traça o caminho completo de qualquer capilar (OLT → ... → porta da CTO → cliente), com distância e atenuação acumuladas em cada evento.
- A função OTDR converte uma distância medida em campo em uma **coordenada geográfica aproximada do rompimento**, com faixa de incerteza.
- O orçamento de potência (power budget) calcula o dBm esperado em qualquer ponto do caminho.

**Princípio central:** o FiberMap é um **grafo de conectividade óptica georreferenciado**. O mapa é a projeção espacial do grafo; o diagrama de emendas é a projeção lógica; trace, OTDR e power budget são caminhadas no mesmo grafo com saídas diferentes. Nenhuma dessas funções usa LLM — tudo é determinístico.

**Stack (já existente no NetX):**
- Backend: NestJS (módulo `fibermap`), PostgreSQL + **PostGIS** (extensão a habilitar), Redis/BullMQ para jobs (importação KML, recálculos em lote).
- Frontend: Next.js. Mapa com **MapLibre GL JS** + tiles OSM (provider de satélite configurável). Editor de emendas em **SVG custom** (React).
- Sem plano Python neste módulo (não toca equipamentos). Integração futura com SNMP (Pilar 2) descrita na Seção 11.

---

## 2. Glossário de domínio (obrigatório internalizar)

| Termo | Definição |
|---|---|
| **POP** | Ponto de presença; abriga OLTs e DIOs. |
| **Armário (ARM)** | Gabinete de rua com DIO/splitters. |
| **CEO** | Caixa de Emenda Óptica (dome/aérea). Ponto de fusão entre cabos; normalmente sem splitter de atendimento. |
| **CTO** | Caixa de Terminação Óptica. Ponto de atendimento ao assinante; normalmente contém splitter 1x8/1x16 e portas de drop. |
| **DIO** | Distribuidor Interno Óptico (bandeja de portas em POP/armário). |
| **Cabo** | Conjunto de N fibras agrupadas em tubos (loose tubes). Ex.: 12FO = 1 tubo × 12 fibras; 48FO = 4 tubos × 12. |
| **Fibra / capilar** | Filamento individual, identificado por (tubo, número, cor). |
| **Fusão (emenda)** | União permanente entre duas fibras, com perda típica 0,05–0,3 dB. Ocorre dentro de um elemento (CEO/CTO/POP). |
| **Splitter** | Divisor óptico passivo 1xN (balanceado) ou desbalanceado (ex.: 10/90). Perda por porta conforme razão. |
| **Ponto de acesso** | Nome Tomodat para a vista lógica de um elemento: todos os cabos que entram/saem, suas fibras e as fusões internas. |
| **Reserva técnica (sobra)** | Metros de cabo enrolados em um poste/caixa. **Conta na distância óptica, não na geográfica.** |
| **Fator de excesso (hélice)** | Razão comprimento real de fibra / comprimento geométrico da rota (catenária + helicoidal). Default 1,02. |
| **Trace** | Caminho fim-a-fim de um capilar através de fusões/splitters. |
| **OTDR** | Reflectômetro; mede distância óptica até eventos (quebras, emendas). |

**Cores ABNT NBR 14700 (fibras e tubos, ciclo de 12):** 1 Verde, 2 Amarela, 3 Branca, 4 Azul, 5 Vermelha, 6 Violeta, 7 Marrom, 8 Rosa, 9 Preta, 10 Cinza, 11 Laranja, 12 Água-marinha.
**Cores EIA/TIA-598:** 1 Azul, 2 Laranja, 3 Verde, 4 Marrom, 5 Cinza, 6 Branca, 7 Vermelha, 8 Preta, 9 Amarela, 10 Violeta, 11 Rosa, 12 Água-marinha.
O padrão de cores é definido **pelo modelo de cabo no catálogo de produtos** (Seção 3.2), não digitado a cada cabo desenhado. A UI sempre renderiza fibras e tubos na cor real (brancas com contorno).

**Esquemas de cor de tubo (importante):** nem todo cabo segue o ciclo de 12 cores nos tubos. É comum o esquema **piloto/direcional**: tubo 1 verde (piloto), tubo 2 amarela (direcional) e os demais **brancos/naturais** — identificados pela posição contando a partir do piloto no sentido do direcional (ex.: AS 36FO = 6 tubos × 6 fibras: verde, amarela, branca, branca, branca, branca). Por isso o catálogo suporta três esquemas de tubo: `STANDARD_CYCLE` (ciclo do padrão), `PILOT_DIRECTIONAL` e `CUSTOM` (lista explícita). As **fibras dentro de cada tubo** seguem sempre o ciclo do padrão do modelo, truncado em `fibers_per_tube` (6 fibras → Verde…Violeta). Como tubos brancos são ambíguos por cor, o diagrama de emendas SEMPRE exibe o número do tubo junto com a cor.

---

## 3. Modelo de dados (PostgreSQL + PostGIS)

Habilitar extensão: `CREATE EXTENSION IF NOT EXISTS postgis;`
SRID padrão: **4326** para armazenamento; cálculos métricos via cast `::geography` (retorna metros reais).
Todas as tabelas: `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`, `deleted_at` (soft delete), `created_by`. Prefixo de schema: `fibermap.`

### 3.1 Organização

```sql
-- Árvore de pastas (painel esquerdo do mapa, estilo Tomodat)
folder (
  id, parent_id uuid null references folder,
  name text not null,
  sort_order int default 0
)
```

### 3.2 Catálogo de produtos (fonte de verdade das características físicas)

Tudo que existe no mapa é instância de um **produto cadastrado** na aba "Configurações do mapa" (Seção 10). Categorias: **Cabo, Caixa de Emenda (CEO), Caixa de Atendimento (CTO), DIO, Armário, Rack Interno, Splitter**. Um produto define características uma única vez (fabricante, modelo, estrutura); as instâncias herdam por **snapshot na criação** — editar o produto depois NÃO altera instâncias existentes, apenas as novas.

```sql
product (
  id, type text not null check (type in
    ('CABLE','SPLICE_CLOSURE','TERMINATION_BOX','DIO','CABINET','INDOOR_RACK','SPLITTER')),
  manufacturer text,                 -- 'Furukawa'
  name text not null,                -- 'ASU 12FO'
  description text,
  specs jsonb not null default '{}', -- chaves documentadas por tipo (abaixo)
  active bool not null default true, -- produtos com instâncias nunca são excluídos, só desativados
  UNIQUE (type, manufacturer, name)
)

-- Extensão estruturada APENAS para cabos (a estrutura de tubos/fibras dirige algoritmos):
cable_model (
  product_id uuid pk references product,
  fiber_count int not null,
  tube_count int not null,
  fibers_per_tube int not null,      -- fiber_count = tube_count × fibers_per_tube (validar)
  color_standard text not null default 'ABNT' check (color_standard in ('ABNT','EIA598')),
  tube_scheme text not null default 'STANDARD_CYCLE'
    check (tube_scheme in ('STANDARD_CYCLE','PILOT_DIRECTIONAL','CUSTOM')),
  excess_factor numeric(5,4) not null default 1.0200,
  cable_class text                    -- 'ASU80', 'ASU120', 'DROP', 'SUBTERRANEO' (informativo)
)

cable_model_tube (
  cable_model_id uuid references cable_model, tube_number int, color text not null,
  PRIMARY KEY (cable_model_id, tube_number)
)
-- Populada automaticamente pelo service conforme tube_scheme:
--   STANDARD_CYCLE    → cores do padrão, ciclo de 12
--   PILOT_DIRECTIONAL → 1=Verde, 2=Amarela, demais=Branca
--   CUSTOM            → editor manual na UI (obrigatório preencher todos os tubos)
```

**Chaves de `specs` documentadas por tipo (informativas no MVP, validação leve):**
- `SPLICE_CLOSURE` (CEO): `{ "trays": 4, "splices_per_tray": 12, "cable_entries": 8, "mount": "AEREA|SUBTERRANEA" }`
- `TERMINATION_BOX` (CTO): `{ "drop_ports": 16, "connector": "SC/APC", "supports_splitter": true, "splice_capacity": 12 }`
- `DIO`: `{ "ports": 24, "connector": "SC/APC", "trays": 2, "rack_units": 1 }`
- `CABINET` (Armário): `{ "rack_units": 12, "outdoor": true }`
- `INDOOR_RACK`: `{ "rack_units": 44 }`
- `SPLITTER`: `{ "ratio": "1x8", "topology": "BALANCED", "connectorized": true }`

**Seed obrigatório de cabos (FM-0) — lineup oficial. Cada modelo abaixo é seedado DUAS vezes, uma por padrão de cores, com sufixo no nome: `(ABNT)` e `(EIA/TIA)`. Total: 22 produtos de cabo.**

| Modelo | Estrutura | `tube_scheme` | `cable_class` |
|---|---|---|---|
| ASU 2FO | 1 tubo × 2 fibras | `STANDARD_CYCLE` (tubo único) | ASU |
| ASU 4FO | 1 tubo × 4 fibras | `STANDARD_CYCLE` | ASU |
| ASU 6FO | 1 tubo × 6 fibras | `STANDARD_CYCLE` | ASU |
| ASU 12FO | 1 tubo × 12 fibras | `STANDARD_CYCLE` | ASU |
| ASU 24FO | 2 tubos × 12 fibras | `PILOT_DIRECTIONAL` (verde, amarela) | ASU |
| AS 24FO | 4 tubos × 6 fibras | `PILOT_DIRECTIONAL` (verde, amarela, 2× branca) | AS |
| AS 36FO | 6 tubos × 6 fibras | `PILOT_DIRECTIONAL` (verde, amarela, 4× branca) | AS |
| AS 48FO | 4 tubos × 12 fibras | `PILOT_DIRECTIONAL` (verde, amarela, 2× branca) | AS |
| AS 72FO | 6 tubos × 12 fibras | `PILOT_DIRECTIONAL` (verde, amarela, 4× branca) | AS |
| AS 144FO | 12 tubos × 12 fibras | `PILOT_DIRECTIONAL` (verde, amarela, 10× branca) | AS |
| DROP 1FO | 1 tubo × 1 fibra | `STANDARD_CYCLE` | DROP |

Notas do seed:
- Nas versões `(EIA/TIA)`, apenas as cores mudam (tubo único/fibras seguem o ciclo EIA-598: Azul, Laranja, Verde…); a estrutura é idêntica. No esquema piloto/direcional as cores de tubo piloto/direcional permanecem Verde/Amarela em ambos os padrões (convenção de campo).
- `manufacturer` do seed: `Padrão` (o usuário cadastra variantes por fabricante quando necessário).
- ASU 24FO seedado como 2×12 (construção usual); estrutura ajustável no catálogo se a construção usada em campo divergir.
- Fibra única do DROP 1FO: cor 1 do padrão (Verde na ABNT / Azul na EIA).
- Demais categorias: ao menos 1 produto de cada (CEO 24 fusões, CTO 16 portas, DIO 24p, armário, rack 44U, splitters 1x8 e 1x16) para a fixture.

### 3.3 Elementos físicos (nós geográficos)

```sql
element (
  id, folder_id uuid not null references folder,
  type text not null check (type in ('POP','CABINET','CEO','CTO','POLE','SLACK_COIL','CUSTOMER_PREMISE')),
  product_id uuid null references product,  -- modelo do catálogo (obrigatório na UI para CEO/CTO/CABINET;
                                            -- null permitido p/ POLE, importação KML e legado)
  name text not null,            -- ex.: 'CPN-012', 'CTO-CPM-01'
  geom geometry(Point,4326) not null,
  address text, description text,
  metadata jsonb default '{}',   -- ex.: modelo da caixa, capacidade de bandejas
  UNIQUE (folder_id, name)
)
CREATE INDEX ON element USING gist(geom);

element_photo ( id, element_id, file_path, caption, taken_at )
```

Notas:
- `POLE` existe para snapping da rota do cabo e para reservas; não participa do grafo lógico a menos que tenha reserva.
- `CUSTOMER_PREMISE` é opcional no MVP (fase 7); a porta da CTO já identifica o assinante via `metadata`.

### 3.4 Cabos, tubos e fibras

A criação de um cabo parte SEMPRE de um `cable_model` do catálogo; as colunas estruturais abaixo são o **snapshot** copiado do modelo no momento da criação (mantê-las denormalizadas preserva os algoritmos e o histórico mesmo se o produto for editado/desativado depois).

```sql
cable (
  id, folder_id, name text not null,          -- ex.: '12Fo Guarujá R2'
  product_id uuid null references product,     -- modelo de origem (null só p/ importação KML/legado)
  fiber_count int not null,                    -- ┐
  tube_count int not null,                     -- │ snapshot do cable_model
  fibers_per_tube int not null,                -- │
  color_standard text not null check (color_standard in ('ABNT','EIA598')),  -- │
  excess_factor numeric(5,4) not null,         -- ┘ (editável por instância p/ calibração OTDR)
  display_color text,                          -- cor da polyline no mapa (hex); default derivado do nome
  notes text
)

cable_tube (                                   -- snapshot das cores de tubo do modelo
  cable_id uuid references cable, tube_number int, color text not null,
  PRIMARY KEY (cable_id, tube_number)
)

-- Um cabo é uma sequência ordenada de segmentos entre elementos.
cable_segment (
  id, cable_id uuid not null references cable,
  seq int not null,                            -- ordem A→B ao longo do cabo
  from_element_id uuid not null references element,
  to_element_id   uuid not null references element,
  geom geometry(LineString,4326) not null,     -- rota real (segue postes/ruas)
  geometric_length_m numeric(10,2) generated always as (ST_Length(geom::geography)) stored,
  measured_length_m numeric(10,2) null,        -- override: metragem de bobina/OTDR
  UNIQUE (cable_id, seq)
)
CREATE INDEX ON cable_segment USING gist(geom);

-- Comprimento óptico do segmento (função SQL ou coluna calculada em service):
-- optical_length_m = coalesce(measured_length_m, geometric_length_m * cable.excess_factor)

fiber (
  id, cable_id uuid not null references cable,
  tube_number int not null, fiber_number int not null,  -- fiber_number é global no cabo (1..N)
  color text not null,                                   -- derivada do padrão na criação
  status text not null default 'DARK' check (status in ('DARK','ACTIVE','RESERVED','BROKEN')),
  UNIQUE (cable_id, fiber_number)
)
-- Fibras e cable_tube criadas automaticamente pelo service ao instanciar o cabo a partir do modelo:
-- cor do tubo = cable_model_tube; cor da fibra = ciclo do color_standard truncado em fibers_per_tube.

-- Reserva técnica: sobra de cabo enrolada em um elemento/poste.
cable_slack (
  id, cable_id, element_id uuid not null references element,
  segment_id uuid not null references cable_segment,
  position text not null default 'AT_ELEMENT' check (position in ('AT_ELEMENT')), -- MVP: sempre na caixa/poste
  length_m numeric(10,2) not null
)
```

### 3.5 Equipamentos passivos e portas (grafo lógico)

O grafo de conectividade usa um modelo **porta-cêntrico**: tudo que pode receber luz é um `optical_port`; tudo que conduz luz entre duas portas é uma `optical_link`.

```sql
-- Dispositivos dentro de um elemento
device (
  id, element_id uuid not null references element,
  parent_device_id uuid null references device, -- hierarquia física: DIO/OLT montados num RACK
  product_id uuid null references product,      -- modelo do catálogo (SPLITTER/DIO/INDOOR_RACK)
  type text not null check (type in ('SPLITTER','DIO','OLT','ONU_SHELF','RACK')),
  name text not null,                          -- 'SP-Guar 1x8', 'DIO-01', 'Rack 01', 'OLT-Huawei-01'
  metadata jsonb default '{}'
  -- SPLITTER: snapshot do produto + overrides: { "ratio":"1x8", "topology":"BALANCED"|"UNBALANCED", "tap_percent":10 }
  -- RACK: { "rack_units": 44 }; filhos usam metadata.rack_position ("U12-U13")
  -- OLT: referência cruzada ao inventário do NetX (Pilar 1): { "netx_device_id": "..." , "pon_ports": 16 }
)
-- RACK não tem optical_port; é apenas container físico (documentação de armário/POP).

optical_port (
  id, device_id uuid not null references device,
  role text not null check (role in ('IN','OUT','BIDI')),
  port_number int not null,
  label text,                                   -- 'PON 0/1/3', 'Bandeja 2 Porta 07'
  UNIQUE (device_id, role, port_number)
)

-- Pontas de fibra também são endpoints conectáveis. Cada fibra tem 2 pontas implícitas
-- (lado A = from do primeiro segmento; lado B = to do último segmento).
-- Representação: fiber_end(fiber_id, side 'A'|'B') materializada como view; nas conexões
-- usamos colunas polimórficas controladas:

optical_connection (
  id,
  element_id uuid not null references element,  -- onde a conexão existe fisicamente
  kind text not null check (kind in ('FUSION','CONNECTOR','SPLITTER_PATH')),
  a_type text not null check (a_type in ('FIBER_END','PORT')),
  a_fiber_id uuid null references fiber, a_fiber_side char(1) null check (a_fiber_side in ('A','B')),
  a_port_id uuid null references optical_port,
  b_type text not null check (b_type in ('FIBER_END','PORT')),
  b_fiber_id uuid null, b_fiber_side char(1) null,
  b_port_id uuid null,
  loss_db numeric(5,2) null,                    -- se null, usa default do tipo (Seção 5.3)
  notes text,
  CHECK ((a_type='FIBER_END') = (a_fiber_id IS NOT NULL)),
  CHECK ((b_type='FIBER_END') = (b_fiber_id IS NOT NULL)),
  CHECK ((a_type='PORT') = (a_port_id IS NOT NULL)),
  CHECK ((b_type='PORT') = (b_port_id IS NOT NULL))
)
-- Unicidade: uma ponta de fibra (fiber_id, side) só pode aparecer em UMA conexão;
-- uma porta idem (exceto porta IN de splitter desbalanceado em cascata — ainda assim 1 conexão).
-- Implementar com unique indexes parciais.
```

**Semântica do splitter:** o caminho interno IN→OUTx de um splitter **não** é uma linha em `optical_connection`; é implícito pelo device (todas as OUT derivam da IN). O traçador (Seção 5) trata `SPLITTER` como nó que ramifica no sentido downstream e converge no upstream. `SPLITTER_PATH` fica reservado para casos especiais (não usar no MVP).

### 3.6 Medições e OTDR

```sql
otdr_reading (
  id, created_by, created_at,
  reference_kind text not null check (reference_kind in ('ELEMENT','PORT')),
  reference_element_id uuid null, reference_port_id uuid null,
  cable_id uuid not null, fiber_number int not null,
  direction_element_id uuid not null,   -- elemento vizinho que define o sentido da medição
  distance_m numeric(10,2) not null,
  event_type text default 'BREAK' check (event_type in ('BREAK','HIGH_LOSS','REFLECTIVE','END')),
  result jsonb                          -- snapshot do resultado calculado (coordenada, incerteza, segmento)
)

power_measurement (
  id, port_id uuid null, fiber_id uuid null, element_id uuid,
  wavelength_nm int not null default 1490,
  dbm numeric(6,2) not null, measured_at timestamptz not null default now(),
  source text default 'MANUAL'          -- futuro: 'SNMP'
)
```

---

## 4. Grafo de conectividade — construção

O serviço `ConnectivityGraphService` (NestJS) monta um grafo em memória por demanda (escopo: componente conexo a partir de um nó inicial; nunca carregar a planta inteira):

- **Nós:** pontas de fibra `(fiber_id, side)`, portas `(port_id)`, e nós virtuais de splitter `(device_id)`.
- **Arestas:**
  1. **Fibra:** liga `(fiber, 'A')` ↔ `(fiber, 'B')`. Peso: `optical_length_m` total do cabo entre os elementos onde a fibra "aparece" — atenção: a fibra percorre TODOS os segmentos do cabo; a distância entre dois elementos ao longo do cabo é a soma dos segmentos entre eles **mais as reservas (`cable_slack`) nos elementos intermediários e no elemento de partida** (regra na Seção 5.2). Atenuação: `length_km × atten_per_km(λ)`.
  2. **Fusão/Conector (`optical_connection`):** liga os dois endpoints. Distância 0. Atenuação: `loss_db` ou default.
  3. **Splitter:** porta IN ↔ nó do device ↔ cada porta OUT. Distância 0. Atenuação aplicada no sentido downstream conforme razão (Seção 5.3); no upstream, a mesma perda.
- **Direcionalidade:** o grafo é não-direcionado para trace; a direção importa apenas para o power budget (definida pela origem = porta OLT) e para o OTDR (definida pelo par referência + `direction_element_id`).

**Ponto crítico — fibra atravessando caixas sem fusão (sangria/derivação):** um cabo pode passar por uma CEO onde apenas algumas fibras são abertas e fundidas; as demais seguem intactas ("expressas"). O modelo já suporta isso naturalmente: uma fibra sem `optical_connection` naquele elemento simplesmente não tem nó ali — ela é uma aresta única de A a B do cabo. Quando uma fibra É cortada e fundida numa caixa intermediária, o cabo **deve ser modelado como dois cabos** OU — decisão de MVP — **mantém-se um cabo e a fusão referencia a ponta lógica**: para simplificar, **no MVP toda fusão em elemento intermediário exige que o usuário "corte" a fibra naquele ponto** (ação "tesoura" da UI, como no Tomodat). O corte cria registros em `fiber_cut(fiber_id, element_id, segment_seq)` e o grafo passa a tratar a fibra como duas sub-arestas A→corte e corte→B. Adicionar tabela:

```sql
fiber_cut ( id, fiber_id uuid not null, element_id uuid not null, UNIQUE(fiber_id, element_id) )
```
Uma ponta de corte vira endpoint conectável: `(fiber_id, element_id, lado 'UP'|'DOWN')`. Estender `optical_connection` com `a_cut_element_id uuid null` / `b_cut_element_id uuid null` (quando preenchido junto com `a_fiber_id`, a ponta é o corte naquele elemento e `a_fiber_side` guarda 'U'/'D'). Manter os CHECKs coerentes.

---

## 5. Algoritmos (o coração do módulo — implementar com testes unitários exaustivos)

### 5.1 Trace de capilar

`GET /fibermap/fibers/:fiberId/trace?from=A|B` ou `GET /fibermap/ports/:portId/trace`

BFS/DFS a partir do endpoint. Em splitters: no sentido downstream, ramifica (retornar árvore); no upstream, segue apenas para a porta IN. Saída:

```json
{
  "path": [
    { "kind":"PORT", "device":"OLT-01", "label":"PON 0/1/3", "element":"POP-CPM", "cum_distance_m":0, "cum_loss_db":0 },
    { "kind":"CONNECTOR", "element":"POP-CPM", "loss_db":0.5, "cum_loss_db":0.5 },
    { "kind":"FIBER", "cable":"12Fo Guarujá R2", "fiber":1, "color":"Verde", "length_m":1868.47, "cum_distance_m":1868.47 },
    { "kind":"FUSION", "element":"CPN-011", "loss_db":0.05, "cum_distance_m":1868.47, "cum_loss_db":0.55 },
    { "kind":"SPLITTER", "device":"SP-Guar 1x8", "element":"CPN-012", "loss_db":10.4, "branches":[ ... ] }
  ],
  "map_geometry": { "type":"MultiLineString", ... }   // para highlight no mapa
}
```

O tooltip do print 3 do Tomodat ("Fusão entre o cabo Guaruja [fibra 1] e o cabo 12Fo Guarujá R2 [fibra 1] — Distância: 564.70m") é exatamente um item deste array.

### 5.2 Distância óptica (função compartilhada)

`opticalDistance(cable, fromElement, toElement)`:
1. Somar `optical_length_m` dos segmentos entre os dois elementos (na ordem `seq`), onde `optical_length_m = coalesce(measured_length_m, geometric_length_m × cable.excess_factor)`.
2. Somar `cable_slack.length_m` de **todos os elementos do trecho, incluindo o de partida e os intermediários, excluindo o de chegada** (convenção: a sobra é consumida ao sair da caixa; documentar e manter consistente).
3. Retornar também a lista de "marcos" `{element, cum_optical_m}` — usada pelo OTDR e pelo trace.

### 5.3 Defaults de atenuação (tabela `fibermap.attenuation_default`, seed obrigatório, editável na UI de configurações)

| Item | Valor default |
|---|---|
| Fibra 1310 nm | 0,35 dB/km |
| Fibra 1490 nm | 0,28 dB/km |
| Fibra 1550 nm | 0,22 dB/km |
| Fusão | 0,10 dB |
| Conector (par) | 0,50 dB |
| Splitter 1x2 | 3,7 dB · 1x4: 7,3 · 1x8: 10,5 · 1x16: 13,7 · 1x32: 17,1 · 1x64: 20,4 |
| Desbalanceado | por `tap_percent`: 10% ≈ 10,5 dB (tap) / 0,8 dB (pass); 20% ≈ 7,4/1,2; 30% ≈ 5,7/1,9; 50% = 3,7/3,7 |

### 5.4 Power budget

`GET /fibermap/ports/:oltPortId/power-budget?wavelength=1490&tx_dbm=4`
Percorre o trace downstream aplicando perdas; retorna dBm esperado em cada nó e na(s) ponta(s) final(is). Flags: `WARN` se Rx esperado < -25 dBm, `CRIT` se < -27 dBm (limiares configuráveis, GPON classe B+). Se existir `power_measurement` recente num ponto, exibir esperado × medido e o delta.

### 5.5 Localizador OTDR (feature estrela)

`POST /fibermap/otdr/locate`
```json
{ "reference_element_id":"...", "cable_id":"...", "fiber_number":4,
  "direction_element_id":"...", "distance_m":1868.47, "wavelength_nm":1550 }
```

Algoritmo:
1. Resolver o endpoint inicial: a ponta/corte da fibra no elemento de referência (se a fibra não termina ali, usar a posição do elemento ao longo do cabo como marco zero).
2. Executar o trace no sentido de `direction_element_id`, obtendo a sequência de trechos físicos `[{cable_segment, geom, optical_length_m, slack_before_m}]` — **o trace atravessa fusões**: se a fibra 4 funde na fibra 7 de outro cabo, a caminhada continua no outro cabo (o OTDR não enxerga fronteira de cabo).
3. Caminhar acumulando `cum`: primeiro consumir `slack` do elemento de partida do trecho, depois o comprimento do trecho. Se `distance_m` cair dentro de uma **sobra**, o evento está fisicamente **no próprio elemento** → retornar o elemento com flag `IN_SLACK`.
4. Quando `cum < distance_m ≤ cum + optical_length_m` de um segmento: `remaining = distance_m − cum`; `geo_remaining = remaining / excess_factor_efetivo` onde `excess_factor_efetivo = optical_length_m / geometric_length_m` do segmento; `fraction = geo_remaining / geometric_length_m` (clamp 0..1); ponto = `ST_LineInterpolatePoint(geom, fraction)` **respeitando a orientação de caminhada** (se o trace percorre o segmento de `to`→`from`, usar `ST_Reverse` antes).
5. Se um splitter aparece antes de `distance_m` no sentido downstream: o OTDR não distingue ramos após splitter → retornar **todos os pontos candidatos** (um por ramo) com aviso `AMBIGUOUS_AFTER_SPLITTER`.
6. **Incerteza:** `± (Σ sobras atravessadas × 0,5 + distance_m × |excess_incerto|)` com `excess_incerto = 0,01` quando o segmento usa comprimento geométrico (sem `measured_length_m`); mínimo ±10 m. Retornar como raio em metros.
7. Resposta:
```json
{
  "point": { "lat":..., "lng":... },
  "uncertainty_radius_m": 32,
  "segment": { "cable":"Guaruja", "between":["CPN-011","CPN-012"], "offset_m": 412.3 },
  "nearest_elements": [ {"name":"POSTE-118","distance_m":8}, {"name":"CPN-012","distance_m":152} ],
  "expected_events": [ {"type":"FUSION","element":"CPN-011","expected_otdr_m":564.7}, ... ],
  "flags": []
}
```
`expected_events` lista todos os eventos conhecidos do caminho com a distância OTDR teórica — permite ao técnico correlacionar a curva inteira e detectar se o marco zero está deslocado. Persistir a consulta em `otdr_reading`.

8. **Modo calibração (fase 6):** se o técnico informar 2+ eventos identificados na curva (ex.: "emenda da CPN-011 apareceu em 1.842 m, esperado 1.868 m"), ajustar linearmente o fator de excesso do trecho e recalcular — melhora drasticamente a precisão.

---

## 6. API NestJS (módulo `fibermap`)

Prefixo `/api/fibermap`. Todas as rotas autenticadas (guard existente do NetX). Validação com class-validator. Geometrias em GeoJSON no transporte.

```
Folders:      GET/POST/PATCH/DELETE /folders  (árvore; DELETE só vazia)
Elements:     GET /elements?bbox=&types=&folder_id=   (GeoJSON FeatureCollection; SEMPRE filtrar por bbox do viewport)
              POST/PATCH/DELETE /elements/:id · POST /elements/:id/photos
Cables:       POST /cables { product_id, name, folder_id } (snapshot do modelo; cria cable_tube
              e fibras automaticamente) · PATCH/DELETE /cables/:id
              GET /cables?bbox= (FeatureCollection de segmentos com cor)
              POST /cables/:id/segments (LineString + from/to elements) · PATCH /segments/:id (editar rota)
              POST /cables/:id/slacks · GET /cables/:id/occupancy (fibras por status)
Access point: GET /elements/:id/access-point   → payload completo do diagrama de emendas:
              cabos incidentes (com fibras, cores, cortes, pontas livres), devices (splitters/DIOs/OLT),
              conexões, perdas. É O endpoint mais importante do frontend.
Connections:  POST /connections (fusão/conector) · DELETE /connections/:id
              POST /fibers/:id/cut { element_id } · DELETE /cuts/:id (só se pontas livres)
Devices:      POST /elements/:id/devices · PATCH/DELETE /devices/:id
Trace:        GET /fibers/:id/trace?from=A|B|cut_element_id= · GET /ports/:id/trace
Power:        GET /ports/:id/power-budget?wavelength=&tx_dbm=
OTDR:         POST /otdr/locate · GET /otdr/readings?cable_id=
Import:       POST /import/kml (multipart; enfileira job BullMQ; GET /import/jobs/:id para status)
Export:       GET /export/kml?folder_id=
Reports:      GET /reports/cto-occupancy · GET /reports/splice-book?element_id=
              GET /reports/cable-usage
Catalog:      GET /catalog/products?type=&q=&active= · POST/PATCH /catalog/products/:id
              POST /catalog/products/:id/deactivate · DELETE (só sem instâncias; senão 409)
              POST /catalog/cable-models (product + estrutura + tube_scheme; gera cable_model_tube)
              GET /catalog/products/:id/instances-count
Config:       GET/PATCH /settings/attenuation-defaults · GET/PATCH /settings/thresholds
```

Regras:
- Importação/exportação KML e qualquer recálculo em lote rodam em **job BullMQ**, nunca no request.
- Auditoria: toda mutação grava em `fibermap.audit_log(entity, entity_id, action, diff jsonb, user_id, at)` — é a base da "documentação automática" (histórico de quem fundiu o quê e quando).

---

## 7. Frontend — Tela 1: Mapa (`/fibermap`)

Réplica funcional da tela de mapas do Tomodat (print 1), modernizada.

**Layout:** painel esquerdo colapsável (320 px) + mapa ocupando o resto + toolbar superior + controles flutuantes à direita.

**Painel esquerdo:**
- Busca de elemento (autocomplete por nome; ao selecionar, voa até ele e destaca).
- Árvore de pastas com checkboxes tri-state (pasta → tipos → elementos), ícones por tipo (cubo=CEO/CTO, prédio=POP/armário, cilindro=reserva). Toggle de visibilidade controla layers do MapLibre por filtro.
- Contexto (botão direito): renomear, mover para pasta, excluir.

**Mapa (MapLibre GL JS):**
- Estilos: OSM raster (default), satélite (URL de tiles configurável em settings — suporta provider próprio/Google se o cliente tiver chave), modo claro/escuro.
- Camadas: `cable-segments` (linhas coloridas por `display_color`, largura 3, hover +1), `elements` (símbolos por tipo com collision), `slacks` (ícone bobina), `labels` (zoom ≥ 16).
- Carregamento por viewport: refetch com bbox debounced; cluster de elementos em zoom baixo.
- Clique em elemento → popup: nome, tipo, fotos (thumb), botões **[Abrir ponto de acesso]** [Editar] [Rota até aqui (Google Maps deeplink)].
- Clique em cabo → popup: nome, FO, ocupação (barra), comprimento do segmento, botões [Editar rota] [Reserva aqui].

**Toolbar (modo de edição explícito, como Tomodat):**
- ➕ Adicionar elemento (escolhe tipo → produto do catálogo → clica no mapa → form lateral; capacidades vêm do produto).
- ✏️ Desenhar cabo: seleciona elemento origem → cliques adicionam vértices (snapping a postes/elementos num raio de 15 m) → clique em elemento destino fecha o segmento → form (cabo novo — passo 1: escolher modelo do catálogo com preview da estrutura — ou continuar cabo existente).
- 📏 Medir distância. · 📥 Importar KML. · 📤 Exportar KML. · 🎯 **Ferramenta OTDR** (Seção 9).
- Undo da última ação de desenho.

**Busca de endereço:** geocoding via Nominatim (self-hosted opcional; default API pública com debounce — documentar rate limit).

## 8. Frontend — Tela 2: Ponto de Acesso / Editor de Emendas (`/fibermap/access-point/:elementId`)

Réplica funcional dos prints 2 e 3. **Componente SVG custom** (sem lib de diagrama), com pan/zoom (wheel + drag), renderização a partir do payload de `/access-point`.

**Representação visual:**
- **Cabo:** bloco vertical com casca na `display_color`, tubos como faixas internas na cor do tubo **com o número do tubo sempre visível** (tubos brancos do esquema piloto/direcional são indistinguíveis por cor), e uma "perna" por fibra terminando em pílula numerada; o traço da fibra usa a cor real dela (tracejado, como no Tomodat). Cabos que entram pela esquerda apontam →, pela direita ←. Ordenação automática em duas colunas; drag para reposicionar (persistir `metadata.diagram_pos` do device/cabo no elemento).
- **Splitter:** trapézio com porta IN (badge verde "IN") e pernas OUT numeradas; título com nome + razão; ícones de editar/mover/excluir no header (como "SP-Guar ✏️ ⇄ ✥ ↑ 🗑" do print 2).
- **Fusão:** curva Bézier ligando duas pontas, cor = gradiente entre as cores das duas fibras, com **ícone de tesoura** no ponto médio (hover mostra perda; clique abre menu: editar perda / desfazer fusão).
- **Ponta livre:** pílula cinza. **Fibra expressa** (não cortada aqui): passa reta com opacidade reduzida.
- Badges de atenuação editáveis inline (`0.01dB` dos prints) ao lado de cada perna.
- Ícone 💬 por fibra/porta para nota; ícone **F** abre o trace.

**Interações principais:**
1. **Fundir:** clique na ponta A (fica pulsando) → clique na ponta B → POST /connections. Validações: pontas livres, mesmo elemento. Atalho: fundir sequência (seleciona fibras 1-8 do cabo A e 1-8 do B → 8 fusões de uma vez).
2. **Cortar fibra (tesoura):** transforma fibra expressa em duas pontas conectáveis (POST /fibers/:id/cut).
3. **Adicionar splitter/DIO** (botão "Novo" do header, como print 3).
4. **Trace (ícone F):** abre painel lateral com o caminho completo (lista de eventos com distâncias e perdas acumuladas — formato do tooltip do print 3) + botão "Ver no mapa" que abre a Tela 1 com o caminho destacado (MultiLineString em layer de highlight laranja) e eventos como marcadores.
5. Botões do header (paridade Tomodat print 2/3): voltar, exportar PNG do diagrama, imprimir, girar layout, **OTDR** (abre a ferramenta já contextualizada neste elemento).

## 9. Frontend — Ferramenta OTDR

Modal/painel acionável do mapa ou do ponto de acesso:
1. Selecionar ponto de referência (elemento; default: o atual) e o cabo/fibra medidos (dropdowns com busca; se aberto de uma fibra, pré-preenchido).
2. Selecionar direção (vizinhos possíveis pelo grafo) e digitar a distância do OTDR em metros + λ.
3. Resultado: mapa centraliza no ponto estimado com **marcador de raio (círculo de incerteza)**, cartão com segmento, offset, elementos próximos e a tabela `expected_events` (distância teórica × o que o técnico vê na curva). Botões: [Salvar leitura] [Compartilhar localização (link Google Maps)] [Copiar coordenadas].
4. Caso `IN_SLACK` ou `AMBIGUOUS_AFTER_SPLITTER`: banner explicativo e todos os candidatos plotados.


---

## 10. Frontend — Tela 3: Configurações do Mapa (`/fibermap/settings`)

Hub de configuração do módulo, com duas áreas em abas:

**Aba "Catálogo de produtos":**
- Sub-abas por categoria: Cabos · Caixas de Emenda · Caixas de Atendimento · DIO · Armários · Racks Internos · Splitters.
- Tabela por categoria (fabricante, modelo, resumo das características, nº de instâncias em campo, ativo) + busca; ações: novo, duplicar, editar, desativar (excluir só sem instâncias).
- **Form de Cabo (o mais rico):** fabricante, modelo, classe; nº de fibras, nº de tubos, fibras/tubo (com validação `fibras = tubos × fibras/tubo`); padrão de cores (ABNT/EIA); esquema de tubos com **preview visual ao vivo** — seletor `Ciclo padrão | Piloto/Direcional | Custom`; em Custom, lista de tubos com color-picker restrito às 12 cores do padrão + Branca/Natural. O preview renderiza o corte transversal do cabo (tubos com número + cor, fibras coloridas dentro) exatamente como aparecerá no editor de emendas. Fator de excesso default.
- **Forms das demais categorias:** campos conforme chaves de `specs` da Seção 3.2 (ex.: CEO = bandejas, fusões/bandeja, entradas de cabo; CTO = portas de drop, conector, suporta splitter; DIO = portas, conector, Us; Armário/Rack = Us).
- Ao editar um produto com instâncias, banner fixo: "Alterações valem apenas para novas instâncias (N em campo permanecem como criadas)".

**Aba "Parâmetros":**
- Defaults de atenuação (tabela da Seção 5.3, editável).
- Limiares de power budget (WARN/CRIT), padrão de cores default do tenant, provider de tiles/satélite, raio de snapping do desenho.

Fluxos que consomem o catálogo: criar elemento CEO/CTO/Armário → dropdown de produto da categoria (com busca) define capacidades exibidas no popup; desenhar cabo → passo 1 é escolher o modelo (mostra preview da estrutura); adicionar DIO/Rack/Splitter no ponto de acesso → idem.

## 11. Integrações com o restante do NetX

- **Inventário (Pilar 1):** device `OLT` referencia `netx_device_id`; a página do equipamento no NetX ganha aba "Fibra" com as PONs e seus traces.
- **SNMP (Pilar 2, futuro):** Rx por ONU coletado via SNMP alimenta `power_measurement(source='SNMP')`. Job noturno compara Rx medido × power budget esperado por capilar; delta > 2 dB gera alerta "degradação óptica" com o caminho suspeito — diagnóstico sem LLM, alinhado ao princípio do projeto.
- **IA (Pilar 5, futuro, fora deste escopo):** o trace serializado é contexto perfeito para o copiloto RAG explicar incidentes. Nada de IA neste módulo agora.

## 12. Importação / Exportação KML

- **Export:** pastas → Folders KML; elementos → Placemarks (Point, ícone por tipo); segmentos → LineStrings com cor. Compatível com Google Earth.
- **Import (job BullMQ):** parse KML/KMZ; Placemarks viram elementos (tipo inferido por nome/ícone com tabela de mapeamento configurável no payload do job; default: contém "CTO"→CTO, "CEO"→CEO, "POP"→POP, senão POLE); LineStrings viram cabos sem produto associado (product_id null, 1 fibra placeholder; ação em lote pós-import "associar modelo do catálogo" re-instancia tubos/fibras se ainda sem fusões) com um único segmento entre elementos mais próximos das extremidades (raio 25 m; se não houver, criar POLEs nas pontas). Relatório final: criados / ignorados / avisos. **Objetivo prático: migrar a base exportada do Tomodat.**

## 13. Fases de implementação (executar nesta ordem; PR por fase; não avançar com testes falhando)

**FM-0 · Fundação (schema + módulo):** habilitar PostGIS; migrations de todas as tabelas (Seções 3 e 4, incluindo catálogo, `cable_tube`, `fiber_cut` e `audit_log`); seeds (attenuation_default, cores ABNT/EIA, **lineup completo de 22 modelos de cabo da Seção 3.2 + demais categorias**); esqueleto do módulo NestJS + guards; fixture de demonstração: 1 POP (com rack + DIO + OLT), 3 CEOs, 4 CTOs, 3 cabos instanciados do seed — ASU 12FO (ABNT), AS 36FO (ABNT) e AS 48FO (EIA/TIA), para exercitar os dois padrões e o esquema piloto/direcional —, fusões, 1 splitter 1x8, reservas — **esta fixture é a base de todos os testes e do desenvolvimento do frontend.**
✔ Aceite: migrations idempotentes; fixture carrega; constraints impedem fusão duplicada na mesma ponta; instanciar cabo do AS 36FO (ABNT) gera 6 tubos (Verde, Amarela, 4× Branca) com 6 fibras Verde…Violeta cada; instanciar o AS 48FO (EIA/TIA) gera 4 tubos (Verde, Amarela, 2× Branca) com 12 fibras Azul…Água-marinha cada.

**FM-1 · Mapa read-only + CRUD básico + Configurações:** Tela 1 com árvore, layers por viewport, popups; CRUD de pastas/elementos (com escolha de produto); upload de fotos; **Tela 3 completa (catálogo com preview de cabo + parâmetros)**.
✔ Aceite: fixture visível no mapa; criar/mover/excluir elemento pela UI; cadastrar o AS 36FO do zero pela UI reproduz o preview correto; 60 fps de pan com 5 mil elementos (testar com seed sintético).

**FM-2 · Cabos, rotas e reservas:** desenho de cabo com snapping a partir de modelo do catálogo, criação automática de tubos/fibras, edição de rota (arrastar vértices), reservas, ocupação, comprimentos (geométrico/medido/óptico) exibidos.
✔ Aceite: comprimento geográfico bate com PostGIS (±0,1%); reserva aparece no popup e soma na distância óptica.

**FM-3 · Ponto de acesso (editor de emendas):** payload `/access-point`; SVG com cabos/tubos/fibras/cores; cortar, fundir, desfazer, splitters, DIO/OLT ports, perdas inline, fusão em sequência, export PNG.
✔ Aceite: reproduzir no sistema o cenário dos prints 2/3 (2 splitters SP-Guar + cabo 12FO com fusões coloridas) em < 5 min de operação; unique constraints respeitadas sob concorrência.

**FM-4 · Trace + highlight no mapa:** `ConnectivityGraphService`, endpoints de trace, painel de trace no frontend, highlight MultiLineString, distâncias/perdas acumuladas.
✔ Aceite: trace da fixture confere com cálculo manual documentado no teste (distâncias ±0,01 m; perdas ±0,01 dB); ramificação de splitter correta nos dois sentidos.

**FM-5 · OTDR locator:** endpoint + modal + círculo de incerteza + expected_events + persistência de leituras. Casos de teste obrigatórios: evento no meio de segmento, dentro de sobra, após fusão entre cabos diferentes, após splitter (ambíguo), distância além do fim (flag `BEYOND_END`), segmento com measured_length divergente do geométrico.
✔ Aceite: para a fixture, leitura simulada de 1868,47 m a partir do POP retorna coordenada dentro de 5 m do ponto esperado do teste.

**FM-6 · Power budget + relatórios + calibração OTDR:** endpoint de budget, comparação com medições, relatórios (ocupação de CTO, caderno de emendas por elemento, uso de cabos), modo calibração (5.5.8).
✔ Aceite: budget da fixture validado contra planilha de referência incluída no repo (`docs/fixtures/power-budget-reference.xlsx` — gerar).

**FM-7 · KML import/export + polish:** jobs de importação com relatório, export, dark mode do mapa, atalhos de teclado do editor, auditoria visível na UI (histórico do elemento).
✔ Aceite: exportar a fixture e reimportá-la num banco limpo reproduz a geometria (tolerância 1 m); KML abre no Google Earth.

## 14. Regras e validações de negócio (aplicar no service, não só na UI)

1. Fusão só entre endpoints livres e **no mesmo elemento**.
2. Não excluir cabo com fusões ativas; não excluir elemento com cabos/devices (exigir cascata explícita com confirmação).
3. `fiber_number` imutável; recolorir apenas trocando `color_standard` do cabo (recalcula todas).
4. Segmentos de um cabo devem formar cadeia contígua (`to` do seq N = `from` do seq N+1); validar na inserção.
5. Splitter desbalanceado: exigir `tap_percent`; perdas derivadas da tabela 5.3.
6. Toda mutação → `audit_log`. Toda exclusão → soft delete.
7. Coordenadas: aceitar colar "lat, lng" direto no form (padrão de campo do Tomodat "Lat:/Lng:").
8. Produto com instâncias em campo: nunca excluir, apenas desativar; edição não propaga para instâncias (snapshot).
9. Cabo criado sem produto (import KML) fica com badge "sem modelo" na UI até associação; associação em lote só permitida se o cabo não tem fusões/cortes.
10. `excess_factor` da instância pode divergir do modelo (calibração OTDR da Seção 5.5.8 ajusta a instância, nunca o produto).

## 15. Não-objetivos do MVP (não implementar agora)

- Ordem de serviço / workflow de campo; app mobile offline.
- Documentação de rede interna de prédio (FTTB vertical).
- Cálculo automático de rota por ruas (routing); o desenho é manual com snapping.
- Multi-tenant além do modelo atual do NetX; billing; integração com ERP financeiro.
- Edição colaborativa em tempo real (locking otimista simples: `updated_at` check).

## 16. Qualidade

- Testes unitários: algoritmos da Seção 5 com a fixture FM-0 (cobertura ≥ 90% nesses services).
- Testes e2e: fluxo fundir→trace→OTDR.
- Performance: endpoints de mapa < 200 ms p95 com 50k elementos (índices GiST + bbox obrigatório); `/access-point` < 300 ms para elemento com 4 cabos de 48 FO.
- i18n: strings em pt-BR por padrão, estrutura preparada para en.
- Documentar cada endpoint no Swagger existente do NetX.
