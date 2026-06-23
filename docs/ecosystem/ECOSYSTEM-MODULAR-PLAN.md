# Ecossistema NetX — Plano de modularização (Core fino + módulos plugáveis)

> Status: **EM CONSTRUÇÃO**. Início: 2026-06-22.
> Fonte de verdade é o código real destes repos; onde um design de referência
> divergir do real, o real vence.

## 1. Objetivo

Transformar os três sistemas hoje separados num **ecossistema de módulos
plugáveis**, vendáveis juntos ou separados, sobre um **Core fino**. O ERP deixa
de ser "a base" e passa a ser apenas mais um módulo grande sobre o Core. Cada
módulo é ativado por **licença** (token assinado pelo NeX-Hub) e por **container**
(profile do Compose). O token decide o que *pode rodar*; o profile decide o que
está *instalado* — defesa em profundidade.

## 2. Estado real (reconhecimento 2026-06-22)

| Sistema | Caminho | Stack | Situação |
|---|---|---|---|
| **NetX (ERP)** | `~/Documents/netx` | Monorepo **Nx 22**; NestJS 11 (`apps/core-service`, `api-gateway`, `cwmp-server`) + Next.js 16 (`apps/web`) + Prisma 6/PG16 | **ÚNICO em produção** |
| **NeX-Hub** | `~/Documents/netx-hub/netx-hub` | NestJS 11 + Prisma + Next.js 15 (`web/`) | Nunca instalado |
| **NetX-NMS** | `~/Documents/netx-nms/NetX NMS` | Monorepo **pnpm**; NestJS (`apps/api`) + React/Vite (`apps/web`) + Python (`apps/device-gateway`) | Nunca instalado |

Fatos que sustentam o plano:

- **O NetX já é um monorepo Nx** — o "container" do destino já existe.
- **O Core já está latente** no NetX: `packages/shared` (incl. `licensing/`
  com verificador Ed25519 + janela de graça), `packages/auth`, `packages/config`,
  `packages/database`, `packages/logger`, e `apps/api-gateway` como camada de
  gateway/proxy.
- **O contrato de licença já existe e os dois lados se falam**: o Hub assina
  Ed25519/JWS (`src/signing/`), o NetX verifica offline
  (`packages/shared/src/licensing/token.ts`), e há teste cruzado
  (`netx-hub` → `test/signing.e2e.ts`).
- **O NMS já respeita o invariante "só o gateway toca equipamento"**: tudo via
  fila BullMQ/Redis (`device-jobs`) → `apps/device-gateway` (Python). Isolado do
  ERP (zero FK/import/HTTP).
- **Domínio canônico real** no ERP: `Tenant`, `Customer`, `Contract`, `Plan`,
  `CustomerAddress` em `apps/core-service/prisma/schema.prisma` (schema **único**
  multi-tenant por `tenantId`).
- Bus de eventos: **RabbitMQ provisionado mas não usado**; módulos se chamam por
  DI direta + filas em tabela (`Tr069Task`, `RadiusEvent`).

## 3. Catálogo de módulos alvo

| Código | Módulo | Dep DURA | Dep MOLE |
|---|---|---|---|
| `netx-erp` | ERP base | — | — |
| `netx-nms` | NMS | — | erp |
| `netx-monitor` | Monitoramento | — | nms |
| `netx-cpe` | TR-069 + OLTs | — | erp, nms |
| `netx-ai` | Motor de IA | — | todos |
| `netx-rh` | RH/portal | — | erp |
| `netx-maps` | Mapas de rede | — | nms |
| `netx-call` | Callcenter | — | erp, ai |

Dep **DURA** = não funciona sem o outro (minimizada de propósito — hoje todas
vazias). Dep **MOLE** = funciona sozinho; integra mais fundo se o outro estiver
presente (acoplamento vive em **eventos**).

Fonte única destes códigos no código:
`packages/shared/src/licensing/modules.ts`.

## 4. Invariantes (não negociáveis)

1. A base é um **Core fino**; o ERP é só mais um módulo.
2. Um módulo toca o resto por **4 canais e nada mais**: (a) identidade/SSO do
   Core; (b) **entitlement** (token assinado pelo Hub, verificado OFFLINE pelo
   Core, com janela de graça); (c) **eventos** (bus; nunca chamada direta entre
   módulos); (d) **APIs HTTP** atrás do `apiPrefix` do módulo.
3. Cada módulo é **dono exclusivo do seu schema Postgres**. Sem escrita
   cross-schema.
4. O **formato do token NÃO se inventa**: deriva do que o Hub já emite. O Core
   valida o que o Hub realmente produz.
5. Entidades canônicas derivam do **modelo real do ERP**, não de suposição.
6. **IA é conselheira**: propõe e explica, nunca escreve config nem executa ação.
7. Só o **gateway (Python, no NMS)** toca equipamento.
8. A VM no cliente é **plano de gestão** (OSS/BSS), nunca plano de dados.
9. A trava de licença é o **guard de entitlement em runtime** (token assinado),
   não a ausência do container.

## 5. Decisão estratégica: NetX como TRONCO (não copiar)

Escolhido em 2026-06-22. **Não** criar um monorepo novo e copiar os três
sistemas para dentro — isso criaria um *segundo NetX* exigindo que todo hotfix
de produção fosse aplicado em dobro (armadilha do fork-and-rewrite).

Em vez disso: **promover o workspace Nx do NetX a tronco do ecossistema** e
trazer NMS e Hub para dentro dele preservando histórico (`git subtree`/
`filter-repo`). NMS e Hub nunca saíram do papel → podem ser relocados com risco
zero.

O custo real desta transformação **não está no container**, está em três
refatorações que custam o mesmo em qualquer repo (ver §6). Copiar não as
resolve; só adiciona dívida de fork.

## 6. As 3 refatorações de fundo (o custo real)

1. **Schema único × invariante 3.** Hoje um schema Prisma único onde
   `Contract → Customer → Plan`, RH, billing, estoque, TR-069 e fleet partilham
   tabelas e FKs. Separar fisicamente quebra FKs cross-domínio. **Adiada**:
   começa com propriedade *lógica* (tabelas donas por módulo + regra "sem escrita
   cross-módulo" por fronteira de código/review) e só separa fisicamente quando
   um módulo for vendido sozinho.
2. **Chamadas diretas × invariante 2c.** DI direta entre os 32 módulos. Migrar
   costuras para eventos, **ao lado** das chamadas diretas (RabbitMQ já está
   provisionado), uma costura por vez.
3. **Token sem catálogo de módulos × invariantes 2b/4.** O token hoje só tem
   `plan` (string) + `maxContracts`. Falta um claim `modules[]`. Esta é a **fase
   em andamento** (§8).

## 7. Roadmap de fases

- **Fase 0 — Trazer para dentro (sem mexer em runtime).** ← **CONCLUÍDA** (branch
  `ecosystem/monorepo-integration`, 2026-06-22). NMS e Hub importados via
  `git subtree --squash` em `apps/nms` e `apps/hub`; isolados dos workspaces npm
  (`!apps/nms`, `!apps/hub`) e do grafo do Nx (`.nxignore`). Não entram em runtime.
- **Fase 1 — Reconciliar o contrato de licença/entitlement.** ← **CONCLUÍDA**
  (1.a + 1.b + 1.c). Ver §8 / §10.
- **Fase 2 — Extrair `core-sdk`.** ← **CONCLUÍDA** (2026-06-22). Lib
  `@netx/core-sdk`: fachada de licensing/entitlement + manifesto de módulo +
  envelope de evento. Empacotamento; aditivo. Ver §10. (auth/config seguem
  pacotes próprios, reexportáveis depois — sem ganho de comportamento agora.)
- **Fase 3 — Bus de eventos nas costuras.** ← **EM ANDAMENTO** (2026-06-22):
  bus opcional ligado, 1ª costura migrada (`netx-erp.contract.created`).
  DESLIGADO por default. Próximas costuras: migrar uma a uma. Ver §10.
- **Fase 4 (adiada) — Separação física de schema por módulo.** Expand-contract,
  só quando um módulo for vendido standalone.

## 8. Fase 1 — Contrato de licença/entitlement (detalhe)

### 8.1 Decisões (defaults escolhidos — reversíveis)

1. **Forma do claim:** `modules: string[]` plano. `maxContracts` permanece no
   topo (limite do ERP). Normalização de limites por módulo fica para depois.
2. **Modelo no Hub:** **MVP escolhido = coluna `Licensee.modules String[]`**
   (vazio ⇒ todos). Simples e suficiente pro claim, que é `string[]`. Normalizar
   para tabela `LicenseeModule (code, enabled, limits…)` quando surgir
   limite/preço/data por módulo.
3. **Semântica do token legado:** token **sem** `modules` (ou vazio) ⇒ **catálogo
   inteiro habilitado**. Preserva a instância de produção intacta. (Alternativa
   mais restritiva — ausente ⇒ só `netx-erp` — exigiria reemitir o token da prod
   ANTES de ligar enforcement; não escolhida.)

### 8.2 Mudanças por arquivo

**NetX (muda primeiro — só passa a LER o claim; no-op em runtime):**
- `packages/shared/src/licensing/modules.ts` — **novo**: catálogo + grafo de deps
  + `entitledModules()` (ausente ⇒ tudo).
- `packages/shared/src/licensing/token.ts` — `modules?: ModuleCode[]` em
  `LicenseClaims`; validação **tolerante** em `isClaims` (ausente é válido).
- `packages/shared/src/licensing/index.ts` — exporta `modules`.
- *(Fase 1.b — enforcement, depois)* `core-sdk`/licensing — decorator
  `@RequiresModule('netx-cpe')` + guard consultando `entitledModules()`, com
  **default: permite quando `modules` ausente**.

**Hub (muda depois que o NetX já tolera):**
- `src/signing/license-token.ts` — espelhar `modules?: string[]` (ESPELHO do
  NetX; manter em sincronia).
- `prisma/schema.prisma` — `LicenseeModule` (ou `Licensee.modules String[]`).
- `src/signing/signing.service.ts` (`issue()`) — aceitar e carimbar `modules`.
- `src/instances/instances.service.ts` (heartbeat) — ler módulos do licenciado e
  passar para `issue()`.
- `src/admin/*` — marcar módulos comprados por licenciado.

### 8.3 Ordem de implantação (lockstep que protege a produção)

1. **NetX aprende a LER `modules`** (ausente ⇒ tudo). Aditivo, no-op. Sobe 1º.
2. **Hub aprende a EMITIR `modules`.** Setar o licenciado real (NetX prod) com o
   catálogo cheio. Como o NetX já tolera, nada muda na prática.
3. **Ligar enforcement por módulo.** Com a instância viva em catálogo cheio
   (ou ausente⇒all-on), nada bloqueia. Clientes futuros sem um módulo recebem
   token sem aquele código e o guard barra só aquele módulo.

Verificador-tolerante **antes** de emissor-emite **antes** de enforcement.

### 8.4 Compatibilidade nas duas direções

Header, `alg` (EdDSA) e os 9 claims atuais **inalterados**. Verificador antigo
valida token novo (ignora claim desconhecido); verificador novo valida token
antigo (claim ausente → default tudo-ligado).

### 8.5 Como verificar

- `cd ~/Documents/netx && npm run build -w @netx/shared` (verde).
- `cd ~/Documents/netx-hub/netx-hub && npm run test:signing` (Hub↔NetX verde):
  - token legado (sem `modules`) → verificado, `entitledModules` = catálogo;
  - token com `modules` → verificado, claim preservado no round-trip;
  - token adulterado → rejeitado (prova que o claim está sob a assinatura).
- `licenseDecision` (efeito global) inalterado — regressão.

## 9. Regra "main sempre lançável" (durante toda a transição)

Todo commit do ecossistema precisa manter `main` lançável, para que a produção
continue recebendo melhorias/hotfixes normalmente (`sudo netx-update`):

1. **Mudança do ecossistema = aditiva e no-op por default** (entra desligada).
2. **Migration só EXPANDE, nunca contrai** em tabela compartilhada
   (expand-contract). Aditiva e reversível.
3. **Apps novas (nms/hub) não entram na lista de processos da prod** até serem
   deliberadamente empacotadas. Prod segue subindo os 4 units de sempre.
4. **Preflight antes do push** + lockfile sincronizado + `test:signing` verde.

Hotfix de produção é só mais um commit em `main` — não há fork para patchear em
dobro. Mudança grande e arriscada (ex.: separar schema) vai para branch/flag com
expand-contract, e só faz merge quando comprovadamente reversível.

## 10. Log de progresso

- 2026-06-22 — Reconhecimento dos 3 repos concluído. Estratégia "NetX como
  tronco" escolhida.
- 2026-06-22 — **Fase 1.a concluída** (aditivo, no-op em runtime):
  - `packages/shared/src/licensing/modules.ts` (novo): catálogo + deps +
    `entitledModules()`.
  - `token.ts`: claim opcional `modules?: ModuleCode[]` + validação tolerante.
  - `index.ts`: exporta `modules`.
  - Hub `src/signing/license-token.ts`: espelho do claim opcional.
  - Hub `test/signing.e2e.ts`: caso forward-compat (token com `modules`).
  - Verificação: `npm run build -w @netx/shared` verde; `npm run test:signing`
    8/8 verde; `tsc --noEmit` do Hub verde. **Hub ainda NÃO emite** `modules`
    (Fase 1.b) e **NÃO há enforcement** ainda (Fase 1.c).
- 2026-06-22 — **Fase 1.b concluída** (Hub emite o claim):
  - `prisma/schema.prisma`: `Licensee.modules String[]` (+ migration baseline).
  - `admin/admin.dto.ts`: `modules` opcional no CRUD de licenciado.
  - `signing/signing.service.ts`: `issue()` carimba `modules` só quando há valor.
  - `instances/instances.service.ts`: heartbeat propaga `licensee.modules`.
  - Verificação: `tsc --noEmit` + `prisma generate` + `test:signing` 8/8 verdes.
  - Commit Hub: `f2c30c4` (branch `ecosystem/monorepo-integration`). Migration
    pendente de `prisma migrate deploy` — mas o Hub nunca subiu, sem impacto.
- 2026-06-22 — **Fase 1.c concluída** (enforcement no NetX, default-permissivo):
  - `licensing/license.decorators.ts`: `@RequiresModule(code)` + metadata key.
  - `licensing/module-entitlement.guard.ts` (novo): guard global; sem claim
    `modules` no token → libera tudo (comportamento idêntico ao atual).
  - `licensing/licensing.service.ts`: `entitledModules()`.
  - `licensing/licensing.module.ts`: registra o guard via `APP_GUARD`.
  - `hr/hr.controller.ts`: `netx-rh` anotado como módulo de referência (7 rotas).
  - Verificação: `nx build core-service` verde.
  - Commit NetX: `47c72dd` (branch `ecosystem/monorepo-integration`).
- 2026-06-22 — **Fase 0 concluída** (monorepo unificado, sem mexer em runtime):
  - NMS importado via `git subtree --squash` (main, `4c08603`) em `apps/nms`.
  - Hub importado via `git subtree --squash` (`f2c30c4`) em `apps/hub`.
  - Isolamento de tooling: `package.json` exclui `!apps/nms`/`!apps/hub` dos
    workspaces npm; `.nxignore` mantém ambas fora do grafo do Nx.
  - Verificação: `nx show projects` não lista hub/nms; `nx build core-service`
    verde após o import. Commit de tooling: `e5521b4`.
  - **Pendências da Fase 0** (deixadas para depois, fora de runtime): NMS é pnpm
    e Hub é npm isolado — reconciliação de build/deps de cada app importada ainda
    não foi feita (não é necessária enquanto não entram em produção). (As
    mudanças de "Wi-Fi no cadastro", que estavam soltas no working tree, foram
    commitadas à parte em `feat/wifi-no-cadastro` e mergeadas na `main`.)
- 2026-06-22 — **Fase 2 concluída** (`@netx/core-sdk`, aditivo):
  - `packages/core-sdk` (novo): `licensing.ts` (fachada de @netx/shared/licensing),
    `manifest.ts` (ModuleManifest + defineModule/getManifest/resolveLoadOrder),
    `events.ts` (EventEnvelope + makeEnvelope + porta EventPublisher + Noop).
  - `tsconfig.base.json`: alias `@netx/core-sdk`. tsconfig do pacote zera `paths`
    p/ consumir @netx/shared compilado (evita TS6059 de rootDir).
  - Verificação: `nx build @netx/core-sdk` verde. Commit: `1d178f9`.
- 2026-06-22 — **Fase 3 em andamento** (bus de eventos):
  - Infra: `apps/core-service/src/modules/events/`: `EventBusModule` global
    (DESLIGADO por default; só liga o `AmqpEventPublisher` com
    `EVENTBUS_ENABLED=true|1`), adaptador AMQP (amqp-connection-manager, exchange
    topic `netx.events`), `EventBusPublisher` (wrapper injetável e resiliente:
    monta envelope, no-op se off, nunca lança), `event-types.ts` (catálogo de
    eventos + emits registrados no manifesto).
  - deps: `@netx/core-sdk` + `@types/amqplib` (lockfile sincronizado).
  - Costuras migradas (todas fire-and-forget, após commit):
    - `contracts.service`: `netx-erp.contract.created`, `.suspended`
      (cobre cron e manual via applySuspend), `.reactivated`, `.plan-changed`,
      `.cancelled`.
    - `contract-invoices.service`: `netx-erp.invoice.paid` (baixa manual `pay()`
      e webhook EFI `registerGatewayPayment()`).
  - Verificação: `nx run-many -t build` verde (10 projetos). Commits: `2803780`,
    `f7c81b0`, `5f7a01a`.
  - **Próximo**: costuras de outros domínios (ex.: ONT trocada → `netx-cpe.*`,
    O.S concluída) e, quando houver consumidor, um ConsumerModule que assina a
    exchange e reage (idempotente pelo `envelope.id`).
