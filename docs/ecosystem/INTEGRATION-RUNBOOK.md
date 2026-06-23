# Runbook — Integração NMS/Hub + Go-live do Hub

> Passos que dependem de **infra/segredos de produção** (cofre, chaves, credenciais
> reais) e/ou decisões operacionais. Documentados aqui porque NÃO dá pra executar
> com segurança de forma autônoma. Cada passo diz o que precisa e onde mexer.
> Complementa ECOSYSTEM-MODULAR-PLAN.md.

## Parte A — Ligar NMS e Hub "de verdade" (resto do item 4)

Hoje `apps/nms` e `apps/hub` estão importados via subtree mas **dormentes**
(isolados dos workspaces npm e do grafo Nx). Para virarem módulos vivos:

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
