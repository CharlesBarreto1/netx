# NetX como Integrador Técnico — Descoberta e Reconciliação de ONU

> Escopo: base **ZUX-PR** (mono-tenant). O NetX cuida da camada técnica
> (OLT, ONU/ONT, TR-069, RADIUS) enquanto o **Hubsoft** permanece dono do
> cadastro comercial e do billing. Implementado em jul/2026.

## Objetivo

Fazer o NetX descobrir a planta GPON real na OLT, identificar o **dono correto**
de cada ONT apesar da fragmentação e dos erros humanos do Hubsoft, e
materializar isso em `Contract` + `Ont` + RADIUS — cadastrando a ONT **uma vez**
como entidade única e cruzando as várias visões do ERP.

Premissa central: **a ONT física (o que a OLT descobre) é a verdade**. O Hubsoft
guarda a mesma ONT fragmentada em lugares independentes que ele não reconcilia:
serviço/provisionamento, estoque/comodato, CPE/ACS. Cada um pode estar certo,
errado, em formato diferente, ou vazio. O NetX reconcilia isso com tolerância —
nunca quebra por regra rígida, nunca inventa vínculo.

## Fluxo em 4 camadas

```
1. DESCOBERTA   OLT (telnet)  → discovered_onts (staging)
2. RECONCILIAÇÃO  discovered_onts × Hubsoft (5 fontes) → dono + estado
3. MATERIALIZAÇÃO MATCHED → Customer+Contract+Ont (+RADIUS) + adoção TR-069
4. CONFIRMAÇÃO   Inform TR-069 (PPPoE) confirma o dono (fonte de máxima confiança)
```

Cada camada é desacoplada, idempotente e retomável. Nada de RADIUS/contrato é
criado automaticamente na descoberta — a materialização é um passo revisado.

### Camada 1 — Descoberta (OLT → `discovered_onts`)

- Driver `FiberhomeTelnetDriver` (`apps/core-service/.../drivers/`): a OLT
  Fiberhome AN5516/AN5116 **não tem SSH utilizável** (reseta o handshake), então
  o driver fala **telnet** (`net.Socket` puro). Trata login em 2 etapas + `enable`
  (2ª senha), paginação `--Press any key--` e contextos hierárquicos (`cd onu`).
- `listOnts()` roda `show authorization slot all pon all` e parseia
  `slot | pon | onu | modelo | auth | ? | estado | phy_id(serial)`. Escopo opcional
  por PON (`?slot=&pon=`) para piloto controlado.
- Grava em `discovered_onts` (idempotente por `olt_id + serial`), 1 PON por vez,
  gentil com a OLT de produção. Endpoint: `POST /v1/olts/:id/scan-onts`.

### Camada 2 — Reconciliação por sinais (5 fontes)

A ONT descoberta é a entidade; cada fonte é uma "opinião" sobre o dono, gravada
em `discovered_ont_signals`. O estado final sai da **prioridade** das fontes:

| Prioridade | Fonte | Endpoint Hubsoft | Cobre |
|---|---|---|---|
| 4 (máx) | **PPPOE** | Inform TR-069 (login) | verdade física — o equipamento diz quem autentica |
| 3 | **SERVICO** | `/cliente/todos` (`phy_addr`) | a maioria; **omite ~500 clientes** (bug do Hubsoft) |
| 2 | **COMODATO/PATRIMÔNIO** | `/estoque/produto_item/consultar?busca=numero_serie` | serial GPON real (quando o serviço tem MAC no phy_addr) |
| 1 | **CPE** | `/rede/cpe/todos` | clientes gerenciados no ACS; cobre omitidos pelo `/todos` |

Decisão (`decideOwner`):
- **0 sinais** → `UNMATCHED`
- sinais concordam / 1 aponta → `MATCHED`
- sinais divergem → `CONFLICT` (dono = maior prioridade + nota do conflito)
- dono com serviço cancelado → `CANCELLED_OWNER` (ONU a recolher; não materializa)

Endpoint: `POST /v1/olts/discovery/match`.

#### Normalização de serial (amigável ↔ hex)

O mesmo serial GPON aparece em dois formatos: **amigável** (`HWTC6BA990AA` — 4
letras ASCII do vendor + sufixo) e **hex puro** (`485754436BA990AA` —
`48575443` = "HWTC"). São o mesmo equipamento. `ontSerialForms` gera as duas
formas e casa por interseção (`packages/shared/.../ont-serial.ts`, com cópia
local no cwmp-server). Ex. de vendor: `HWTC`=Huawei, `ZTEG`=ZTE, `PRKS`/`MKPG`=
Parks, `DACM`=Datacom, `ALCL`=Nokia.

### Camada 3 — Materialização (`MATCHED` → Contract + Ont + RADIUS)

`POST /v1/olts/discovery/materialize` (opções `?noRadius=1`, `ids[]` no body):
1. Importa o cliente do Hubsoft por código (reusa `HubsoftImportService`) →
   `Customer` + `Contract` com PPPoE/velocidade/valor/**endereço+coordenadas**/
   financeiro reais.
2. Cria/atualiza o `Ont` (serial, slot/pon/onu) ligado ao `Contract`.
3. Enriquece com o **comodato** do serviço (serialPhysical + nota).
4. **Adota** o TR-069 pendente (ver camada 4).
5. Enfileira RADIUS conforme o **status** (AUTHORIZE só se ativo; suspenso/
   cancelado enfileiram BLOCK/CANCEL — nunca sobe autorizado por engano).

### Camada 4 — TR-069 como confirmação do dono (PPPoE)

As ONTs saem com preset `ACSURL=http://acs.zux.net.br:7547`. Um DNAT no
concentrador (CONC-CPM) redireciona `:7547` do OLTCloud (179.49.176.4) para o
NetX (179.49.176.14). O cwmp-server aceita a raiz `/` e, sendo mono-tenant, tem
`acceptUnknownInforms=true` — Informs de ONT ainda-não-conhecida vão para a caixa
`Tr069PendingDevice` (em vez de descartados).

Ao materializar um `Ont`, `adoptPendingTr069` casa o pending por serial (forma
canônica), cria o `Tr069Device` ligado ao Ont e enfileira um `GET_PARAMS` do
**PPPoE username**. O path é derivado do próprio snapshot do Inform (à prova de
vendor — a Parks recusa GetParameterValues por prefixo de subárvore). O
`reconcilePppoe` (`POST /v1/olts/discovery/reconcile-pppoe`) lê a resposta, casa
o PPPoE com o `login` do serviço Hubsoft e grava um sinal **PPPOE** (prioridade
máxima). Assim o equipamento físico confirma/desempata o dono.

## Bugs do Hubsoft mapeados (e como o NetX contorna)

1. **`/cliente/all` desativado (2023)** → migrado para `/cliente/todos`
   (paginação `pagina` + `itens_por_pagina`).
2. **Endereço/coordenadas** vêm em `servicos[].endereco_instalacao` via o
   parâmetro **`relacoes`** (não `incluir`), incluindo `coordenadas:{lat,long}`.
3. **`/cliente/todos` omite clientes** (retorna ~2491 de 2991) → a fonte **CPE**
   (`/rede/cpe/todos`) cobre os omitidos.
4. **Serial vs. MAC no `phy_addr`** — o Hubsoft às vezes guarda o MAC no serviço;
   o **serial GPON real** vive no patrimônio (`produto_item/consultar`).
5. **Status por página ≠ status do serviço** — a lista `cancelado=sim` traz
   clientes com *algum* serviço cancelado; `isCancelledStatus` olha só o
   `status_prefixo` do serviço (corrige falsos `CANCELLED_OWNER`).
6. **Serial em hex vs. amigável** — resolvido pela normalização canônica.

## Modelo de dados

- `discovered_onts` — staging da ONT crua (serial, slot/pon/onu, modelo, estado,
  mac, vlan, `match_state`, dono ERP, `contract_id` quando materializada).
- `discovered_ont_signals` — 1 ONT → N sinais `{source, cliente, serviço,
  status, cancelled}`. `source ∈ {OLT, SERVICO, COMODATO, CPE, PPPOE}`.
- `match_state ∈ {DISCOVERED, MATCHED, UNMATCHED, AMBIGUOUS, CONFLICT,
  CANCELLED_OWNER, MATERIALIZED, IGNORED}`.

## Endpoints (`/v1/olts/...`, permissão `olts.admin`)

| Método | Rota | Ação |
|---|---|---|
| POST | `:id/scan-onts?slot=&pon=` | varre a OLT (ou 1 PON) → staging |
| POST | `discovery/match` | reconcilia por sinais |
| POST | `discovery/materialize?noRadius=1` | MATCHED → Contract+Ont(+RADIUS) |
| POST | `discovery/apply-comodato` | backfill de comodato nos materializados |
| POST | `discovery/reconcile-pppoe` | consome o PPPoE do TR-069 |
| GET  | `discovery/onts` | lista o staging para revisão |

UI: painel na página de detalhe da OLT (`/olts/[id]`), só para vendors com driver
de descoberta (Fiberhome hoje).

## Resultado no piloto (OLT-CPM1, jul/2026)

Reconciliação da planta descoberta: de **108 → 9 UNMATCHED**. Estado final ~214
ONTs: **192 MATCHED**, 4 CANCELLED_OWNER (a recolher), 4 CONFLICT (revisão), 9
UNMATCHED, 9 MATERIALIZED (piloto). As 5 fontes se cobrem mutuamente — nenhuma
sozinha é confiável, mas juntas identificam o dono correto sem inventar vínculo.

## Próximos passos

- Validar a captura do PPPoE ao vivo (path derivado do snapshot) e ver o sinal
  PPPOE desempatar os CONFLICT.
- Drivers de descoberta para as demais OLTs (Parks, Datacom, Zyxel).
- Cron de re-scan + reconciliação; UI de revisão de CONFLICT/CANCELLED_OWNER.
- Casar por MAC quando a OLT capturá-lo (fonte adicional para os UNMATCHED).
