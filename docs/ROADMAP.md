# Roadmap — NetX

Planejamento de alto nível. Detalhes por sprint ficam no board (Linear/Jira).

> **Última sincronização:** 2026-07-20. Esta seção reflete o estado real do
> código em `apps/core-service/src/modules/` e `apps/web/src/app/(protected)/`.
> Se mexer em algo de escopo, atualize aqui no mesmo PR.

## Fase 1 — MVP ✅ (fechada, com 2 débitos)

| Sprint | Entregável | Status |
|--------|-----------|--------|
| S1–S2 | **Scaffolding + Core** — auth (JWT + refresh), MFA TOTP, RBAC, multi-tenancy (`tenantId` + RLS), audit log, sessions, api keys | ✅ entregue |
| S3 | Email/invite flow, SSO (OIDC) | ⏳ MFA ✅ ; **Core agora é OIDC *Provider*** (`/v1/oidc/<tenant>`, RS256 por tenant, interaction com MFA) ✅ ; invite flow pendente |
| S4–S5 | **CRM** — PF/PJ, endereços, contatos, tags, LGPD/GDPR, validadores BR/PY, pipeline/Deals | ✅ entregue (+ cadastro-mestre de endereços BR: IBGE/ViaCEP, módulo `locations`) |
| S6–S7 | **Contratos** — PPPoE/IPoE, faturas, suspend/reactivate/cancel; assinatura eletrônica (D4Sign) | ⏳ Contratos + faturas + RADIUS ✅ ; coordenada via link Google Maps ✅ ; D4Sign pendente |
| S8–S10 | **Financeiro v1** — mensalidades, cobranças avulsas, caixas, régua, gateway de pagamento | ✅ régua + caixas ✅ ; **cobrança BR via Efi/BTG** (dispatcher `br-billing`) no lugar do Asaas ✅ |
| S11 | **Portal do cliente** v1 | ✅ entregue |
| S12 | **RADIUS básico** — PPPoE/IPoE, CoA-Disconnect, online snapshot | ✅ entregue |

Débitos remanescentes da Fase 1: invite flow e D4Sign.

## Fase 2 — Operação Técnica ✅ (substancialmente entregue)

| Módulo | Status |
|--------|--------|
| Gestão de OLTs multi-fabricante (Módulo 10) | ✅ drivers (Huawei, ZTE, Zyxel ZyNOS), perfis de provisionamento, telas `olts/` + `olt-templates/`, wizard ZTP (`provisioning/`), vínculo OLT ↔ device FiberMap |
| TR-069 / ACS (Módulo 9) | ✅ `cwmp-server` próprio; perfis ZTE F670L, VSOL/Realtek, Zyxel PX3321-T1; catálogo de firmware + rollout; WiFi-Opt; push de PPPoE pro CPE |
| IPAM / DCIM (Módulo 8) | ✅ IPAM + CGNAT determinístico, árvore de subredes, reconciliação com a rede, sync MikroTik, aba no CRM |
| Monitoramento NOC (Módulo 17) | ✅ Central de Alarmes (incidentes correlacionados + IA) + **NMS** (Mikrotik/Juniper/Cisco IOS-XE, device-gateway Python, telemetria real no dashboard NOC) |
| Gestão de O.S. com app técnico (Módulo 16) | ⏳ backend + web ✅ (inclui grupo `(technician-app)`); **NetX Field** (Expo, offline-first) com fundação pronta — faltam O.S.+fotos+GPS, estoque pessoal, ZTP, push |
| **FiberMap — planta externa OSP v2** *(não previsto)* | ✅ FM-0..FM-8: PostGIS, estúdio MapLibre, trace de capilar, power budget, localizador OTDR, KML (migração Tomodat), costura assinante↔planta. OSP v1 aposentado |

## Fase 3 — Atendimento e IA (em andamento)

| Módulo | Status |
|--------|--------|
| Omnichannel + Chatbot (Módulo 13) | ⏳ WhatsApp completo ✅ (WAHA + Meta Cloud, chatbot híbrido menu+IA multi-idioma PT/ES/EN, grupos NOC, voz + transcrição whisper.cpp local, quick replies, régua de cobrança, sino global) ; Telegram/email pendentes |
| URA / VoIP (Módulo 12) | ❌ não iniciado |
| IA de atendimento e preditiva (Módulo 14) | ✅ motor `@netx/ai` (Ollama self-hosted + fallback Anthropic, PII redaction) ; copiloto agêntico **Nexus** (tool-using: ERP+rede+financeiro, testes ativos ping/trace, analytics) ; insights proativos ; linha WhatsApp dedicada da Nexus ; IA conselheira no atendimento. Preditiva avançada em evolução |

## Fase 4 — Expansão

| Módulo | Status |
|--------|--------|
| Fiscal avançado (Módulo 5) | ⏳ SIFEN-PY ✅ ; **NFCom BR (modelo 62) emissor SVRS direto** ✅ (XML + assinatura + SOAP, transmissor plugável) ; telas `fiscal/documents` (NF-e/NFS-e) em construção |
| BI e relatórios (Módulo 19) | ⏳ cockpit com dados reais (aging, MRR-12m, churn, telemetria NMS) ✅ ; BI/cubos/exportação pendente |
| Marketplace de integrações (Módulo 20) | ⏳ base pronta: ecossistema modular (entitlement por módulo via **Hub**, catálogo de 9 módulos, event bus) ; **Hubsoft** (migração read-only) ✅ ; Ufinet ✅ |
| App mobile cliente e técnico | ⏳ técnico: **NetX Field** (fundação ✅) ; cliente: pendente |
| **Frota** *(não previsto)* | ✅ veículos, motoristas, rastreamento (Traccar out-of-the-box), despesas, manutenção |
| **RH** *(não previsto)* | ✅ funcionários, folha, ponto, portal do funcionário (`/me`) |

## Fase 5 — Internacionalização

- Multi-país (validadores BR e PY ✅; próximos: MX, AR, CO, ES)
- i18n do produto: PT/ES/EN em ~30 telas ✅ (chatbot responde no idioma do DDI)
- Multi-moeda + câmbio automático (❌)
- Compliance local fiscal por país (⏳ PY via SIFEN ✅ ; BR via NFCom ✅)
- Métodos de pagamento locais (⏳ BR: Efi/BTG ✅ ; PY pendente)

## Transversal — Ecossistema e operação

- **Licenciamento por módulo**: Hub implementado (Ed25519, heartbeat, billing) —
  falta go-live (chave de prod + segredos). Entitlement fail-open até lá.
- **Event bus** (RabbitMQ): handlers reais (NMS→NOC, feed SSE, WiFi-Opt) —
  OFF por default (`EVENTBUS_ENABLED`/`EVENTBUS_CONSUME`).
- **DR**: backup/restore cifrado (age) de core + NMS + segredos ✅.
- **Installer**: WAHA, Traccar, PostGIS, seed IBGE, stack NMS orquestrada ✅.

## Dependências e caminho crítico

```
Core (Fase 1) ──▶ CRM ──▶ Contratos ──▶ Financeiro ──▶ Portal
                   │                         │
                   └──▶ RADIUS ──────────────┘
                                             │
                              ┌──────────────┴────────────┐
                              ▼                           ▼
                      Fase 2 (Técnica) ✅           Fase 4 (Fiscal, BI)
                              │
                              ▼
                      Fase 3 (Atendimento + IA) ⏳
```

Bloqueadores externos atuais: **go-live do Hub** (trava a venda módulo a módulo)
e D4Sign (assinatura de contratos). Asaas deixou de ser bloqueador (substituído
por Efi/BTG).
