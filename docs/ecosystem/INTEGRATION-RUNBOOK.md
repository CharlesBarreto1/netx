# Runbook — Integração NMS/Hub + Go-live do Hub

> Passos que dependem de **infra/segredos de produção** (cofre, chaves, credenciais
> reais) e/ou decisões operacionais. Documentados aqui porque NÃO dá pra executar
> com segurança de forma autônoma. Cada passo diz o que precisa e onde mexer.
> Complementa ECOSYSTEM-MODULAR-PLAN.md.

## Parte A — Ligar NMS e Hub "de verdade" (resto do item 4)

> **Status NMS: CONCLUÍDA (2026-06-23).** O NMS deixou de ser dormente e agora é
> um módulo **vivo** do ecossistema (single-tenant, dev/compose-profile). Os 4
> canais estão ligados (A.3) e o sub-build pnpm é orquestrado pelo Nx (A.1).
> O **Hub** segue dormente (Parte B). Detalhe do que foi feito no fim desta Parte A.

Hoje `apps/hub` está importado via subtree mas **dormente** (isolado dos
workspaces npm e do grafo Nx). Para virar módulo vivo, seguir os mesmos passos
abaixo (o NMS já está feito):

### A.1 Reconciliar tooling (NMS é pnpm, Hub é npm; NetX é npm/Nx)
- **Hub** (`apps/hub`, NestJS único, npm): caminho mais curto. Reescrever o
  `package.json` pra usar os deps do workspace raiz e remover o `package-lock.json`
  próprio; tirar de `!apps/hub` nos workspaces e do `.nxignore`; adicionar um
  `project.json`/scripts Nx (`build`/`serve`). Validar `nx build hub`.
- **NMS** (`apps/nms`, monorepo pnpm com `apps/api` NestJS + `apps/web` React +
  `apps/device-gateway` Python): NÃO converter pra npm no curto prazo. Mantê-lo
  como **sub-build isolado** (pnpm próprio), orquestrado por um target Nx
  `run-commands` que chama `pnpm -C apps/nms ...`. O device-gateway Python continua
  fora do Node de qualquer forma.

### A.2 Rodar como processos (sem entrar na lista de prod ainda)
- Compose: adicionar serviços `hub` e `nms-api` com **profile** próprio (ex.:
  `--profile ecosystem`), de modo que a prod atual (4 units) não os suba por default.
- Só promover pra prod quando A.3/A.4 estiverem fechados.

### A.3 Falar os 4 canais (invariante 2)
1. **Identidade/SSO**: hoje Core (`@netx/auth`), Hub e NMS têm auth próprio.
   Unificar emitindo/validando o MESMO JWT do Core. Mínimo: NMS/Hub validam o
   token do Core (chave/JWKS compartilhada) em vez de login próprio.
2. **Entitlement**: NMS passa a checar `netx-nms` no token (o Core já expõe
   `GET /v1/license/modules`); anotar suas rotas com o equivalente a
   `@RequiresModule('netx-nms')`.
3. **Eventos**: NMS/Hub publicam/consomem no mesmo bus (`netx.events`, exchange
   topic). Reusar o envelope de `@netx/core-sdk`. Ex.: NMS registra um
   `EventHandler` (token `EVENT_HANDLERS`) que reage a `netx-erp.contract.installed`.
4. **HTTP por apiPrefix**: NMS atrás de `/nms` (já declarado no manifesto), via
   `apps/api-gateway` (proxy) — nunca exposto direto.

### A.4 Manifesto
- `apiPrefixes` do NMS já declarado (`netx-nms → /nms`). Quando ligado, declarar
  `emits`/`consumes` reais e `ownedTables` (schema próprio do NMS — invariante 3).

---

### ✅ O que foi feito pro NMS (2026-06-23) — referência pra replicar no Hub

**Decisões:** NMS **single-tenant** (1 instância por operador, coerente com o
deploy do NetX — 1 VPS por ISP) e **dev/compose-profile** (não entra nos 4 units
de prod ainda).

**A.1 — Tooling (sub-build pnpm orquestrado por Nx):**
- `apps/nms/project.json` (novo): projeto Nx `nms` com targets `nx:run-commands`
  que chamam `pnpm -C apps/nms …` (install/build/dev/typecheck/test/lint +
  `prisma-generate`/`prisma-deploy`). O Python (device-gateway) fica fora do Node.
- `.nxignore`: passou a ignorar só os inner trees (`apps/nms/apps`,
  `apps/nms/packages`, `apps/nms/node_modules`, `apps/nms/dist`) — o `project.json`
  fica visível, sem o Nx inferir projetos duplicados dos package.json aninhados.
- `apps/nms/.npmrc`: `verify-deps-before-run=false` (pnpm 11 disparava um
  `install` implícito a cada script e quebrava no monorepo).
- Raiz `package.json`: os agregados (`build`/`test`/`lint`/`dev`) ganham
  `--exclude=nms` → o caminho de prod segue **idêntico** (10 projetos, sem
  acoplar ao pnpm); o NMS builda deliberado via `nx build nms` (+ atalhos
  `nms:build`/`nms:dev`/`nms:prisma:*`).
- DB próprio (invariante 3): NMS conecta com `?schema=nms` na MESMA instância
  Postgres do NetX; schema criado em `infra/docker/postgres/init.sql`.

**A.2 — Processo:** serviço `nms-api` no `infra/docker/docker-compose.yml` sob
`profiles: ['ecosystem']` (prod não sobe). Suba com
`docker compose --profile ecosystem … up -d nms-api`. Features de equipamento
(device-gateway Python + TimescaleDB) ficam no compose próprio do NMS.

**A.3 — 4 canais:**
1. **SSO** — `apps/nms/apps/api/src/auth/auth.service.ts` aceita, além do login
   nativo, o **JWT de operador do Core** (mesmo HS256) quando `CORE_JWT_SECRET`
   está setado. Mapeia RBAC do Core → papel do NMS (`mapCoreRole`). Identidade
   sintética `core:<userId>` (sem linha em `app_user`), vira o actor da auditoria.
2. **Entitlement** — gate no **edge**: `apps/api-gateway/.../entitlement.service.ts`
   consulta `GET /v1/license/modules` do Core (cache 60s) e barra `/nms/*` se
   `netx-nms` não estiver habilitado. **FAIL-OPEN** (espelha o guard do Core).
3. **Eventos** — `apps/nms/apps/api/src/events/` (consumidor amqplib): fila
   durável `netx.events.nms` ligada à exchange topic `netx.events`, bindings
   explícitos (`netx-erp.contract.{created,installed,cancelled}`,
   `netx-cpe.ont.swapped`), idempotente por `envelope.id`. **OFF por default**
   (liga com `EVENTBUS_CONSUME=true` + `RABBITMQ_URL`). `dispatch()` é o ponto de
   extensão pros handlers de negócio.
4. **HTTP /nms** — `apps/api-gateway/.../nms-proxy.controller.ts`: repassa
   `/api/v1/nms/*` → NMS (`forwardToNms`), preservando o Bearer (SSO). Registrado
   ANTES do catch-all do Core. `@netx/config` ganhou `nmsService` (host/port,
   default `127.0.0.1:3300`).

**A.4 — Manifesto:** `module-manifests.ts` do `netx-nms` declara `consumes`
(os 4 bindings) e `ownedTables: ['nms.*']`. `emits` fica vazio até o NMS publicar
eventos próprios (ex.: `netx-nms.device.unreachable`).

**A.5 — NMS multi-vendor + UI no shell do NetX (2026-06-24):**
- **Multi-vendor**: enum `Vendor` do NMS ganhou `mikrotik` (migration
  `3_vendor_mikrotik`), `CreateDeviceSchema` aceita `vendor` (default juniper),
  serviço usa o vendor do DTO. Decisão: o MESMO Mikrotik é BNG no NetX
  (RADIUS/PPPoE/CoA) e device de rede no NMS (saúde/backup/SSH) — planos
  distintos. Driver RouterOS no device-gateway Python = follow-up (telemetria).
- **Cadastro no shell do NetX** (em vez de reskin do app standalone): página
  Next.js `apps/web/.../(protected)/nms/devices/page.tsx` (lista + cadastro +
  teste de conexão + remover), client `apps/web/src/lib/nms-api.ts` batendo no
  gateway `/v1/nms/*` (SSO + entitlement automáticos). Menu grupo `nms` gated por
  `requiredModules: ['netx-nms']` + i18n nos 3 idiomas. Herda design/dark/SSO do
  shell. **Build web 10/10 + nms verdes.**

**Como rodar em dev:**
```
npm run nms:install            # pnpm install do NMS (1x)
npm run nms:prisma:generate    # gera o Prisma client do NMS
# .env do NMS: cp apps/nms/apps/api/.env.example apps/nms/apps/api/.env
#   PORT=3300, DATABASE_URL …?schema=nms, CORE_JWT_SECRET=<JWT_ACCESS_SECRET do Core>
npm run nms:prisma:deploy      # cria as tabelas em nms.*
npm run nms:dev                # sobe o NMS (api+web) em :3300
```
Depois, com o gateway de pé, `GET /api/v1/nms/health` deve responder via NMS.

**⚠️ Pegadinha (incidente 2026-06-23):** se o `DATABASE_URL` do NMS NÃO terminar
com `?schema=nms`, o `prisma migrate deploy` do NMS aplica no schema **`public`**
do Core e corrompe o histórico de migrations do NetX (erro **P3009** no próximo
`netx-update`). Recuperação: o Core continua no ar (o `safe-migrate` aborta antes
de reiniciar); limpar as linhas órfãs com
`DELETE FROM public._prisma_migrations WHERE migration_name IN ('0_init','1_device_credential','2_user_auth');`
e re-rodar `netx-update`. **Prevenção (já no repo):** `nms:prisma-generate` e
`nms:prisma-deploy` rodam `apps/nms/scripts/assert-nms-schema.cjs`, que RECUSA
qualquer `DATABASE_URL` sem `schema=nms`. Sempre criar o `.env` do NMS a partir do
`.env.example` (que já vem com `?schema=nms`).

**Subir o NMS LIMPO via Docker (PoC do ecossistema — recomendado):** em vez de
rodar pnpm/Python no host, suba a stack própria do NMS em containers, isolada e
costurada ao NetX. Resolve de uma vez: atrito do pnpm (build dentro da imagem),
Python 3.12 (no container do gateway) e colisão de banco (Timescale próprio).
- Arquivos: `apps/nms/infra/docker-compose.netx.yml` (BUILDA local a partir de
  `apps/nms` — pega o código dos 4 canais; as imagens GHCR do compose.prod NÃO têm)
  + `apps/nms/infra/.env.netx.example`.
- Banco/Redis/Telegraf/device-gateway são PRÓPRIOS do NMS (zero risco ao Core).
- Costura com o NetX por env: `CORE_JWT_SECRET` (SSO), `RABBITMQ_URL`→rabbit do
  host (`host.docker.internal`) + `EVENTBUS_CONSUME=true` (eventos), api publicada
  em `:3300` (o gateway aponta `NMS_SERVICE_PORT=3300`). Entitlement já no gateway.
- Rodar (na VPS) — **1 comando** (gera o `.env.netx` puxando CORE_JWT_SECRET +
  RabbitMQ do NetX e gerando os segredos do NMS; idempotente):
  ```
  cd /opt/netx/apps/nms/infra && sudo bash up-netx.sh
  ```
  (Manual, se preferir: `cp .env.netx.example .env.netx` → preencher →
  `docker compose -f docker-compose.netx.yml --env-file .env.netx up -d --build`.)
- Pré-requisito do canal 4: o api-gateway do NetX precisa estar no build com o
  `NmsProxyController` (pós-`netx-update`). Equipamento (Juniper): o gateway precisa
  de rota até a rede (descomentar `network_mode: host` no serviço device-gateway).

**Pendências do NMS (follow-ups, fora desta leva):**
- **device-gateway (Python)** + TimescaleDB não foram integrados (features de
  SSH/SNMP exigem; rodam pelo compose próprio do NMS). Python local é 3.9; o
  gateway quer 3.12.
- **NMS web atrás do gateway** (Vite/React) e **proxy WebSocket** do terminal
  (xterm) pelo gateway — hoje só HTTP. O terminal usa WS direto.
- **NMS publicar eventos** (`emits`) — só consome por ora.
- **Resolver nome humano** do actor `core:<id>` (hoje fica o userId) se a
  auditoria precisar de display name.
- **Promover pra prod** (systemd units + installer) — adiado de propósito.

## Parte B — Go-live do Hub (item 5) — **precisa de você/infra**

O Hub é quem **vende/assina** os módulos. Pendências de go-live (de
project_netx_licensing). Eu NÃO executo: dependem de segredos de produção.

| # | Passo | O que precisa | Onde |
|---|-------|---------------|------|
| B.1 | **Trocar a chave pública de licença no NetX** | a chave **pública de produção** (Ed25519 SPKI base64) do cofre | `packages/shared/src/licensing/public-key.ts` (`LICENSE_PUBLIC_KEY_SPKI_B64`) — espelhar em `apps/hub` se aplicável |
| B.2 | **Segredos de produção** | preencher cofre/env do Hub (chave PRIVADA de assinatura cifrada, DB, OAuth BTG Id) | env/secret manager do Hub — nunca no git |
| B.3 | **Rodar a migration do Hub** | DB do Hub provisionado | `apps/hub/prisma` → `prisma migrate deploy` (inclui `Licensee.modules`) |
| B.4 | **Setar o licenciado de prod (NetX) com o catálogo cheio** | acesso admin do Hub | cadastro do Licensee com `modules` = catálogo (mantém prod tudo-ligado) |
| B.5 | **Testar EFI no Hub** | credenciais EFI reais (sandbox→prod) | módulo de pagamentos do Hub |
| B.6 | **Hardening** | revisão de segurança (rate-limit do /sign, rotação de chave, expiração/replay do heartbeat) | Hub `src/signing`, `src/instances` |

### Ordem segura (lockstep — não quebra a prod)
1. B.1 + B.2 + B.3 (preparar Hub, sem ligar enforcement em prod).
2. B.4 (licenciado de prod com catálogo cheio → token carimba todos os módulos).
3. Só então o enforcement por-módulo (já no código, default-permissivo) passa a
   ter efeito real para **novos** clientes sem um módulo. A instância de prod,
   com catálogo cheio, não bloqueia nada.

> Verificação cruzada já existente: `cd apps/hub && npm run test:signing` (Hub↔NetX).
