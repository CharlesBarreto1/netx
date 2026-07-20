# NetX — Briefing & Pendências (atualizado 2026-07-20)

> **Comece por aqui.** Resumo do que foi construído e instruções para tocar as
> pendências. Detalhes profundos em `docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md`
> (plano), `docs/ecosystem/INTEGRATION-RUNBOOK.md` (infra/go-live) e
> `FIBERMAP-SPEC.md` / `FIBERMAP-STATUS.md` (planta externa).
>
> Estado do git: **`main`** local em `0c00a0c` (equipamento da planta espelhado
> no NMS), **1 commit à frente** de `origin/main` (`eda5a33`). Falta um
> `git push origin main`. O grosso do trabalho de jun/jul já está no GitHub.

---

## 1. O que foi feito desde 23/06

Um mês de evolução pesada (~180 commits, 42 migrations novas, ~12 módulos novos
no core-service). Por tema:

### 1.1 FiberMap — planta externa OSP v2 (FM-0 → FM-8)
Módulo de documentação de planta óptica georreferenciada (estilo Tomodat):
PostGIS, estúdio MapLibre em tela cheia (`(fullscreen)/fibermap`), editor de
emendas SVG (Ponto de Acesso), grafo de conectividade com trace de capilar,
**power budget** com calibração, **localizador OTDR** (distância → coordenada +
raio de incerteza) e **import/export KML** (migração Tomodat). FM-8 fez a
"costura" assinante↔planta (`contracts.fibermap_port_id`) e **aposentou o OSP
v1** (módulo `optical`, estúdio `/mapa`) com migração de dados. Cadastrar POP
cria o elemento no FiberMap; OLT do inventário vincula ao device da planta.
Entitlement `netx-fibermap` no catálogo. Ver `FIBERMAP-STATUS.md`.

### 1.2 IA — motor central + copiloto Nexus agêntico
- **`@netx/ai`**: motor por tenant — Ollama self-hosted (default
  `qwen2.5:3b-instruct`) + fallback opcional Anthropic, redação de PII.
- **Copiloto agêntico (tool-using)**: integra ERP + rede (NMS) + financeiro,
  dispara **testes ativos** (ping/traceroute com polling), analytics de negócio
  (panorama + previsão), métricas de domínio (OS, estoque, frota, vendas, caixa,
  RH). Princípio mantido: **conselheira read-only, nunca age sozinha**.
- **Proatividade**: detectores + `ai_insights` empurrados ao rail do Nexus
  (scan on-demand ao abrir + polling 60s). O feed mock por timer morreu.
- **Nexus via WhatsApp**: linha dedicada (purpose SUPPORT/NEXUS) com pareamento
  de operadores por código.
- IA conselheira também no atendimento WhatsApp (sugestões no idioma do cliente).

### 1.3 Atendimento (Call/WhatsApp) — Evolution → WAHA + Meta Cloud
Canal QR agora é **WAHA** (auto-configurado pelo installer; Evolution saiu).
Chatbot híbrido menu + IA, **multi-idioma (PT/ES/EN) por DDI**, painel do
cliente no atendimento, transferência entre operadores, grupos do WhatsApp
(inclusive grupos NOC), notas de voz + **transcrição local (whisper.cpp)**,
quick replies, templates Meta com variáveis, outbound por telefone, lembrete de
cobrança no vencimento, inbox redesenhado (Andamento/Espera/Automação) e
**sino global de notificações**.

### 1.4 NMS — de "builda em dev" para operação real
- **Multi-vendor**: Mikrotik + Juniper + **Cisco IOS-XE** (ASR 920/1000).
- **Device-gateway em Python** completo (drivers, playbooks, safety, backup,
  SNMP via Telegraf, terminal, network-test).
- Pipeline de apply de config com verify automático + persistência de
  ConfigChange; backup de config via git.
- **Integração no shell**: painel nativo (`/nms/devices`), CRUD de equipamentos
  na web, dashboard **NOC com telemetria real** e "Saúde da rede" na lente
  Operador.
- **Loop bidirecional de eventos**: NMS publica no bus, NetX consome; faults do
  NMS viram alarme no NOC em tempo real.
- `netx-update` **orquestra a stack NMS** do ecossistema (Docker/GHCR, :3300).
- Último commit (`0c00a0c`): equipamento da planta espelhado como device no NMS
  (opt-in por driver juniper/mikrotik/cisco_iosxe; colunas `nms_*` em
  `network_equipment`).

### 1.5 IPAM + CGNAT
IPAM estilo NetBox (VRFs, prefixos, endereços, pools), **CGNAT determinístico**,
busca reversa, árvore de subredes com espaço livre e mapa visual,
**reconciliação com a rede real**, sync bidirecional com MikroTik, aba IPAM no
detalhe do cliente. Rota `/network/ipam`.

### 1.6 TR-069 / ACS (cwmp-server)
Perfis por modelo: **ZTE F670L** (piloto PY, walk real), **VSOL/Realtek**
(paths CT-COM, Wi-Fi invertido), **Zyxel PX3321-T1**. Catálogo de **firmware
com upload e rollout** por modelo/seriais. Wi-Fi: exige senha forte,
**WiFi-Opt** (otimização de canal, fast-path via event bus), cobertura.
Trocar PPPoE no contrato empurra a credencial pro CPE. Diagnóstico por modelo.
Telas em `(protected)/tr069/*`.

### 1.7 Fiscal BR — NFCom (modelo 62)
NetX como **emissor direto ao SVRS** (não agregador): builder de XML, assinatura
digital (cert .pfx cifrado por tenant), cliente SOAP, ciclo
DRAFT→SIGNED→SENT→AUTHORIZED/REJECTED/CANCELLED com retry. Transmissor plugável
(SVRS_DIRECT hoje; NUVEM_FISCAL/FOCUS_NFE previstos). XSDs de referência em
`PL_NFCOM_1.00_NT2026.002 RTC_1.00/`. Telas em `fiscal/nfcom` e
`settings/nfcom`.

### 1.8 Hubsoft — migração de provedores (read-only)
Integração de leitura com a API Hubsoft: listar e importar clientes/contratos/
financeiro por seleção, sync 4x/dia, filtro por cidade, reimpressão de
boleto/Pix do Hubsoft, nº do contrato herda código do cliente.
Tela `settings/hubsoft`.

### 1.9 Core como OIDC Provider
`/v1/oidc/<tenant-slug>` com chaves **RS256 por tenant**, adapter Prisma,
telas de interaction (fecha o fluxo de ponta a ponta com MFA). Base para SSO
dos apps satélites (NMS, Field, etc.).

### 1.10 NetX Field — app mobile do técnico
`apps/mobile` (`@netx/mobile`): **Expo SDK 52 + RN 0.76 + expo-router 4**,
offline-first (WatermelonDB). Entregues: pacotes F0–F10 do backend (BFF `field`
no core-service, consumidor puro) + **Fase 0 do app** (auth, scaffolding,
servidor escolhido no login — um APK, várias bases, device pairing, fotos via
presigned URL/MinIO). No web também nasceu o grupo `(technician-app)` (lista e
execução de O.S. com picker de porta FiberMap).

### 1.11 Outros
- **Estoque ↔ Rede**: bem próprio instalado na rede (IN_USE), equipamento nasce
  do estoque, código de patrimônio na entrada, deploy-to-network.
- **Endereços BR**: cadastro-mestre (cidades IBGE, bairros, logradouros/CEP,
  ViaCEP), seed IBGE automático no install/update. Gated por país.
- **Central de Alarmes**: `alarm_events` + `incidents` correlacionados por
  escopo (ONT/PON/CTO/CABLE/OLT/GEO), SSE pro NOC, resumo/root-cause por IA.
- **Contratos**: derivar coordenada de link do Google Maps; billing BR por
  contrato via dispatcher `br-billing` (Efi/BTG).
- **Testes**: harness de integração com banco real + job no CI.
- **UI/UX**: **tema claro voltou a ser o padrão**, login moderno, logo oficial,
  menus reestruturados em 3 níveis, i18n de ~30 telas (PT/ES/EN), fix do donut
  de saúde e tokens faltantes.
- **Installer**: DR backup/restore **cifrado com age** (`netx-dr-backup` /
  `netx-restore`, cobre core + NMS/TimescaleDB + segredos), Traccar (frota GPS)
  habilitado por padrão, WAHA provisionado, PostGIS antes do migrate,
  `netx-update` ressincroniza units systemd e re-executa a si mesmo pós-pull.

---

## 2. Estado atual (o que funciona vs. o que está OFF)

| Peça | Estado |
|---|---|
| Dashboard cockpit (3 lentes) | ✅ **híbrido real**: KPIs, aging, MRR-12m, churn e telemetria NMS reais; o que resta de mock é marcado com `<MockBadge>` (latência média, uptime 30d, algumas sparklines). |
| Nexus / Copiloto | ✅ real: chat `POST /v1/copilot/ask`, insights proativos, testes ativos, linha WhatsApp. |
| Event bus | ✅ com **handlers reais** (NmsEventsHandler → NOC, FeedHandler → SSE, WifiOptEventsHandler), mas segue **OFF por default** (`EVENTBUS_ENABLED`/`EVENTBUS_CONSUME`). |
| Entitlement / licença | ⚠️ **fail-open** e chave pública de produção **ainda é a de DEV** (`packages/shared/src/licensing/public-key.ts`). Catálogo agora tem 9 módulos (novo: `netx-fibermap`). |
| Hub | ✅ **implementado** (signing Ed25519, instances/heartbeat, billing + trust-unlock, payments Efi, admin, portal, wiki, web Next.js) — mas **não está no ar**. |
| NMS | ✅ vivo e integrado (ver §1.4); deploy orquestrado pelo `netx-update`. |
| FiberMap | ✅ FM-0..FM-8 entregues e validadas (`FIBERMAP-STATUS.md` de 06/07); OSP v1 removido. Conferir se a prod já recebeu `netx-update` pós-FM. |
| Mobile Field | ⏳ backend (F0–F10) ✅ ; app na **Fase 0** — fases seguintes em §3.4. |
| RabbitMQ / WAHA / Traccar / PostGIS | ✅ provisionados pelo installer. |

---

## 3. Pendências + como tocar (por ordem de impacto)

### 3.1 🔑 Hub no ar — segue sendo o desbloqueio principal
Sem o Hub emitindo token com `modules[]`, o entitlement fica permanentemente
fail-open — gating/`@RequiresModule`/upsell não gateiam nada.
Passos (detalhe em `INTEGRATION-RUNBOOK.md` §B e `docs/licensing.md`):
1. Trocar a **chave pública de produção** em
   `packages/shared/src/licensing/public-key.ts` (hoje é a chave DEV de 10/06).
2. Segredos do Hub no cofre/env (chave privada cifrada, DB, OAuth BTG Id).
3. `prisma migrate deploy` do Hub (`apps/hub/prisma`).
4. Cadastrar o licenciado de prod (NetX) com `modules` = catálogo cheio.
5. Testar EFI + hardening (rate-limit do /sign, expiração/replay do heartbeat).
> Verificação cruzada: `cd apps/hub && npm run test:signing`.

### 3.2 📤 Publicar e atualizar produção
```bash
git push origin main   # 1 commit: espelhamento equipamento→NMS (0c00a0c)
sudo netx-update       # na VPS — leva FiberMap, IA, TR-069, IPAM, NMS etc.
```
O bloqueio antigo ("dashboard mock, não atualizar prod") **caiu** — o cockpit
usa dados reais. Branches remotos já mesclados podem ser limpos:
`git push origin --delete feat/ipam-tree feat/nexus-whatsapp feat/dr-backup-restore fix/nms-tooling fix/netx-update-refresh-systemd-units feat/contract-geo-from-maps-url fix/nms-snmp-profile-cleanup`

### 3.3 📡 Ligar o event bus (trivial)
No `/etc/netx/.env`:
```
EVENTBUS_ENABLED=true
EVENTBUS_CONSUME=true
```
`systemctl restart netx-core-service`. Agora com handlers reais, ligar o bus
ativa: faults NMS → alarmes NOC, feed SSE (Nexus/Field) e fast-path do WiFi-Opt.

### 3.4 📱 NetX Field — próximas fases
F0 (auth + scaffolding) ✅. Roadmap do app: Fase 1 (execução de O.S. + fotos +
GPS), Fase 2 (estoque pessoal do técnico), Fase 3 (provisioning ZTP), Fase 4
(push notifications). Enquanto isso o fluxo do técnico existe no web em
`(technician-app)`.

### 3.5 🧹 Débitos menores
- `AGENTS.md`: conteúdo atualizado (jul/2026) mas o cabeçalho ainda diz
  "Atualizado: 2026-05-23" — corrigir na próxima edição.
- Fronteira do módulo `network` (sem `@RequiresModule`): decidir se é
  base/NMS/maps antes de gatear.
- `docs/deploy-contracts.md` e `docs/architecture/osp-network.md` são
  históricos (PM2/OSP v1) — marcar como superados ou arquivar.
- SSO por convite (invite flow) e D4Sign seguem pendentes da Fase 1.

---

## 4. Deploy & operação

### 4.1 Instalar/atualizar VPS
- **VPS zerada (Debian 13, root):**
  `NETX_REPO_BRANCH=main NETX_ADMIN_EMAIL=… NETX_ADMIN_PASSWORD=… NETX_SKIP_WIZARD=1 sudo -E bash infra/installer/install.sh`
- **Atualizar**: `sudo netx-update` (default `main`); outro branch:
  `sudo env NETX_REPO_BRANCH=<branch> netx-update`.
- O installer agora provisiona também: **WAHA**, **Traccar**, **PostGIS**,
  seed IBGE, stack NMS (Docker/GHCR) e o par DR (`netx-dr-backup`/`netx-restore`,
  cifrado com age).
- Licença e bus entram **OFF** (estado de teste seguro).

### 4.2 SSL / HTTPS
O instalador roda `certbot --nginx` **se** o DNS do domínio apontar pra VPS.
Senão: `sudo certbot --nginx -d netx.<dominio> -m EMAIL --agree-tos --redirect`.

### 4.3 Disaster Recovery
`docs/dr.md` — bundle único cifrado (core + NMS/TimescaleDB + segredos).

---

## 5. Referências
- `AGENTS.md` (raiz) — guia operacional autoritativo do NetX.
- `FIBERMAP-SPEC.md` / `FIBERMAP-STATUS.md` — planta externa OSP v2.
- `docs/ecosystem/ECOSYSTEM-MODULAR-PLAN.md` — plano do ecossistema modular.
- `docs/ecosystem/INTEGRATION-RUNBOOK.md` — passos de NMS/Hub + go-live.
- `docs/licensing.md` — arquitetura de licenciamento (Hub, Ed25519, fail-open).
- `docs/dr.md` — disaster recovery.
- `docs/ROADMAP.md` — fases e entregas (sincronizado em 2026-07-20).
