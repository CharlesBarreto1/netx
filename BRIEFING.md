# NetX — Briefing & Pendências (atualizado 2026-06-23)

> **Comece por aqui.** Resumo do que foi construído e instruções para tocar as
> pendências. Detalhes profundos em `docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md`
> (plano) e `docs/ecosystem/INTEGRATION-RUNBOOK.md` (passos de infra/go-live).
>
> Estado do git: tudo está na **`main`** local (`b7ff177`), **35 commits à frente
> de `origin/main`** (que estava só no Wi-Fi). Falta `git push origin main`.
> Build: `nx run-many -t build` → **10/10 verde**.

---

## 1. O que foi feito

### 1.1 Ecossistema modular (Core fino + módulos plugáveis)
Transformar NetX + NMS + Hub num ecossistema de módulos vendáveis por licença.
NetX é o **tronco** (monorepo Nx); NMS e Hub vieram pra dentro via `git subtree`.

- **Fase 0** — NMS e Hub importados (`apps/nms`, `apps/hub`) via subtree `--squash`,
  **isolados** dos workspaces npm (`!apps/nms`/`!apps/hub`) e do grafo Nx (`.nxignore`).
  Não entram em runtime. *Dormentes.*
- **Fase 1** — Contrato de licença com **entitlement por módulo**: claim `modules[]`
  no token (Hub emite, NetX verifica offline). Enforcement via `@RequiresModule`
  + `ModuleEntitlementGuard` **default-permissivo** (sem claim ⇒ tudo liberado).
  Catálogo em `packages/shared/src/licensing/modules.ts`.
- **Fase 2** — `@netx/core-sdk` (`packages/core-sdk`): fachada de licensing +
  **manifesto de módulo** (`apiPrefixes`/`ownedTables`/`emits`) + **envelope de
  evento** (estilo CloudEvents) + porta `EventPublisher`.
- **Fase 3** — **Event bus** (`apps/core-service/src/modules/events/`): publisher
  resiliente + consumidor idempotente sobre RabbitMQ, **DESLIGADO por default**.
  Costuras já publicando: `netx-erp.contract.{created,suspended,reactivated,
  plan-changed,cancelled,installed}`, `netx-erp.invoice.paid`, `netx-cpe.ont.swapped`.
- Endpoint `GET /v1/license/modules` (catálogo + `entitled` + manifesto).
- **Fase 4 (schema por módulo)** — **adiada** de propósito (só quando vender módulo
  standalone).

### 1.2 Redesign do shell (design_handoff_netx_shell)
Front (`apps/web`) redesenhado em 5 fases:
- **Fundação** — fontes Geist, tokens dark do handoff, **tema escuro por default**.
- **Upsell** — módulo não-licenciado vira "Disponível · ativar" na sidebar.
- **NEXUS** — rail direito do copiloto de IA "Conselheira" (violeta; `idle→confirm→
  done`; nunca age sozinha). *Antes "Copilot", renomeado p/ evitar marca Microsoft.*
- **Dashboard cockpit** — 3 lentes (Operador/NOC/Financeiro) + KPIs + gráficos.
- **Command palette** — busca clientes/contratos/OLTs + navegação por RBAC.

### 1.3 Outros
- **Wi-Fi no cadastro do contrato** (SSID+senha na venda; install/O.S herdam).
- **Fix do jest** (pin `jest-mock@30.4.1` na raiz — conflito com RN do mobile).
- **OLT Zyxel ZyNOS** — driver SSH/CLI + perfis de provisionamento (+2 migrations).
- **Fix do instalador** — `netx-update` faz deploy de qualquer branch
  (`reset --hard FETCH_HEAD`, não `origin/<branch>`).

---

## 2. Estado atual (o que funciona vs. o que está OFF)

| Peça | Estado |
|---|---|
| Core-SDK, manifestos, entitlement | ✅ no código, builda. Guard **fail-open** (não bloqueia nada até o Hub emitir token com `modules`). |
| Event bus | ✅ no código, **OFF por default** (`EVENTBUS_ENABLED`/`EVENTBUS_CONSUME`). Publica no-op até ligar. |
| Gating de UI (upsell) | ✅ fail-open. Só aparece quando há módulo travado (= Hub emitindo token restritivo). |
| NMS | ✅ **vivo** (2026-06-23): builda via `nx build nms` (pnpm), 4 canais ligados (SSO/entitlement/eventos/HTTP `/nms`), schema próprio `nms`, **single-tenant**, **dev/compose-profile** (fora dos 4 units de prod). Eventos OFF + entitlement fail-open por default. Falta device-gateway Python, web/WS atrás do gateway, prod. Ver runbook §A. |
| Hub | ⚠️ importado, **dormente** (não builda/roda). |
| Redesign (NEXUS, dark, cockpit, palette) | ✅ pronto. **Dashboard usa dados MOCK.** Feed do NEXUS é timer mock. |
| RabbitMQ | ✅ provisionado pelo instalador (APT). |

**Produção não é afetada** pelo merge: tudo aditivo e no estado seguro (bus off,
licença fail-open). EXCETO o redesign, que muda o visual (dark default) e o
**dashboard fica mock** — ver §3.4.

---

## 3. Pendências + como tocar (por ordem de impacto)

### 3.1 🔑 Hub no ar — o desbloqueio principal
Sem o Hub emitindo token com `modules[]`, o entitlement fica **permanentemente
fail-open** (todos os módulos ligados) — gating/`@RequiresModule`/upsell não
gateiam nada. É o que faz "vender módulo a módulo" existir.

**Passos** (detalhe em `INTEGRATION-RUNBOOK.md` §B — dependem de segredos de prod):
1. Trocar a **chave pública de produção** em `packages/shared/src/licensing/public-key.ts`
   (`LICENSE_PUBLIC_KEY_SPKI_B64`) — pegar do cofre do Hub.
2. Segredos do Hub no cofre/env (chave privada cifrada, DB, OAuth BTG Id).
3. `prisma migrate deploy` do Hub (`apps/hub/prisma`).
4. Cadastrar o licenciado de prod (NetX) com `modules` = catálogo cheio (mantém
   tudo ligado; só clientes novos sem um módulo recebem token restritivo).
5. Testar EFI + hardening (rate-limit do /sign, expiração/replay do heartbeat).
> Verificação cruzada já existe: `cd apps/hub && npm run test:signing`.

### 3.2 📡 Ligar o event bus (trivial — dá pra testar já)
RabbitMQ já está provisionado. No `/etc/netx/.env`:
```
EVENTBUS_ENABLED=true     # publica de verdade
EVENTBUS_CONSUME=true     # consome (fecha o round-trip)
```
`systemctl restart netx-core-service`. Eventos passam a fluir na exchange topic
`netx.events`. **Handlers de negócio reais** entram no `dispatch()` de
`apps/core-service/src/modules/events/event-consumer.ts` (hoje só loga) — registre
um provider `{ provide: EVENT_HANDLERS, useClass: SeuHandler, multi: true }`.

### 3.3 🔌 NMS rodando de verdade — ✅ FEITO (2026-06-23); Hub ainda falta
- **NMS**: concluído (Parte A do runbook). Sub-build pnpm orquestrado por Nx,
  schema próprio `nms`, 4 canais ligados (SSO via `CORE_JWT_SECRET`, entitlement
  fail-open no gateway, eventos OFF por default, HTTP `/api/v1/nms/*`). Como rodar
  em dev e follow-ups (device-gateway Python, web/WS no gateway, prod):
  `INTEGRATION-RUNBOOK.md` §A.
- **Hub**: ainda dormente — replicar os mesmos passos (é npm, caminho mais curto
  que o NMS) + go-live da Parte B.

### 3.4 Follow-ups do redesign (antes de atualizar PRODUÇÃO)
- **Dashboard com dados reais**: `apps/web/src/app/(protected)/dashboard/page.tsx`
  está mock. Re-cabear nas APIs (os KPIs de Operador — clientes/contratos/
  inadimplência/online — existiam no dashboard antigo; ver histórico do arquivo).
  **Não rodar `netx-update` em produção antes disso** (clientes veriam KPIs falsos).
- **Feed do NEXUS via SSE**: trocar o timer em `CopilotRail.tsx` por SSE/WebSocket
  assinando `netx.events` (envelope.type → chip, occurredAt → timestamp).
- **Busca de faturas no palette**: falta `?search=` no backend de `contract-invoices`.
- **Fronteira do módulo `network`**: deixado sem `@RequiresModule` (infra/POPs) —
  decidir se é base/NMS/maps antes de gatear.

---

## 4. Deploy & operação

### 4.1 Publicar
```bash
git push origin main          # 35 commits — leva ecossistema+redesign+OLT pro GitHub
```
Remotas antigas podem ser limpas: `git push origin --delete feat/shell-redesign feat/wifi-no-cadastro fix/jest-mock-hoist-conflict`

### 4.2 Instalar/atualizar VPS
- **VPS zerada (Debian 13, root):**
  `NETX_REPO_BRANCH=main NETX_ADMIN_EMAIL=… NETX_ADMIN_PASSWORD=… NETX_SKIP_WIZARD=1 sudo -E bash infra/installer/install.sh`
- **Atualizar** instância existente: `sudo netx-update` (default `main`); outro branch:
  `sudo env NETX_REPO_BRANCH=<branch> netx-update`.
- Licença e bus entram **OFF** (estado de teste seguro).

### 4.3 SSL / HTTPS
O instalador roda `certbot --nginx` **se** o DNS do domínio apontar pra VPS. Se não:
```bash
# A record netx.<dominio> -> IP da VPS, portas 80/443 abertas, depois:
sudo certbot --nginx -d netx.<dominio> -m EMAIL --agree-tos --redirect
```

---

## 5. Referências
- `docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md` — plano completo, invariantes, log de fases.
- `docs/ecosystem/INTEGRATION-RUNBOOK.md` — passos de NMS/Hub + go-live do Hub.
- `design_handoff_netx_shell/README.md` — spec do redesign (tokens, telas).
- `AGENTS.md` (raiz) — guia operacional autoritativo do NetX.
