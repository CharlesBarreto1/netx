# Roadmap — NetX

Planejamento de alto nível. Detalhes por sprint ficam no board (Linear/Jira).

> **Última sincronização:** 2026-05-21. Esta seção reflete o estado real do
> código em `apps/core-service/src/modules/` e `apps/web/src/app/(protected)/`.
> Se mexer em algo de escopo, atualize aqui no mesmo PR.

## Fase 1 — MVP

| Sprint | Entregável | Status |
|--------|-----------|--------|
| S1–S2 | **Scaffolding + Core** — auth (JWT + refresh), MFA TOTP, RBAC (roles/permissions), multi-tenancy (`tenantId` + RLS), audit log append-only, sessions, api keys | ✅ entregue |
| S3 | Email/invite flow, SSO (OIDC) | ⏳ MFA TOTP ✅ ; invites e SSO pendentes |
| S4–S5 | **CRM** — clientes PF/PJ, endereços, contatos, tags, consentimentos LGPD/GDPR, anotações; validadores BR (CPF/CNPJ) e PY (CI/RUC); lista filtrada, formulário PF/PJ, detalhe 360°, catálogo de tags; **pipeline/Deals + atividades + histórico** | ✅ entregue |
| S6–S7 | **Contratos** — modelos PPPoE/IPoE (Framed-IP, VLAN, MAC, circuit-id/remote-id), faturas (`ContractInvoice`), suspend/reactivate/trust-extend/cancel/kick; assinatura eletrônica (D4Sign) | ⏳ Contratos + faturas + RADIUS sync ✅ ; integração D4Sign pendente |
| S8–S10 | **Financeiro v1** — mensalidades, cobranças avulsas (`OneTimeCharge`), pagamentos, descontos, prorrogação; régua de cobrança automática; caixas (`CashRegister`/`CashMovement`); gateway de pagamento (Asaas) com boleto/PIX | ⏳ Faturas + cobranças + caixas + régua overdue ✅ ; integração Asaas (boleto/PIX) pendente |
| S11 | **Portal do cliente** v1 — login com taxId + código, dashboard read-only, contratos, faturas | ✅ entregue (2ª via aguarda Asaas) |
| S12 | **RADIUS básico** — autenticação PPPoE/IPoE, CoA-Disconnect, applier de eventos, online snapshot, auth-log | ✅ entregue |

### Itens não previstos no roadmap original (já em produção)

- **Service Orders** — CRUD, status workflow (OPEN→SCHEDULED→IN_PROGRESS→OVERDUE→COMPLETED/CANCELLED), motivos configuráveis por tenant, impressão, consumo de estoque por OS
- **Estoque** — produtos (patrimonial/consumível), fornecedores, localizações, níveis de estoque, movimentações, serial items, compras com itens, comodato (empréstimo)
- **Rede / Infraestrutura** — POPs, equipamentos multi-vendor (MikroTik, Huawei, ZTE), test-connection, estratégias de desconexão (CoA/SSH/Mikrotik API), sync de NAS para RADIUS
- **WhatsApp** — instâncias por tenant via Evolution.ai, conversations, messages, webhook, inbox SSE realtime, assign a operador
- **SIFEN (Paraguai)** — emissão e cancelamento de documentos fiscais eletrônicos, ativável por tenant feature flag
- **Backups** — pg_dump on-demand pelo módulo de settings (precisa pg_dump v16 na VPS)
- **Reports** — agregações para dashboards (clientes, caixa, financeiro, previsões)
- **Disconnect** — serviço dedicado de desconexão/reativação

## Fase 2 — Operação Técnica (em andamento parcial)

| Módulo | Status |
|--------|--------|
| Gestão de OLTs multi-fabricante (Módulo 10) | ⏳ infraestrutura básica via `NetworkEquipment` (vendor enum) ; provisionamento ONU + perfis de serviço pendente |
| TR-069 / ACS (Módulo 9) | ❌ não iniciado |
| IPAM / DCIM (Módulo 8) | ❌ não iniciado |
| Monitoramento NOC (Módulo 17) | ❌ não iniciado |
| Gestão de O.S. com app técnico (Módulo 16) | ⏳ backend + web ok ; app mobile pendente |

## Fase 3 — Atendimento e IA

| Módulo | Status |
|--------|--------|
| Omnichannel + Chatbot (Módulo 13) | ⏳ WhatsApp inbox ok ; chatbot/automação pendente ; demais canais (telegram, email) pendentes |
| URA / VoIP (Módulo 12) | ❌ não iniciado |
| IA de atendimento e preditiva (Módulo 14) | ❌ não iniciado |

## Fase 4 — Expansão

| Módulo | Status |
|--------|--------|
| Fiscal avançado (Módulo 5) | ⏳ SIFEN-PY ok ; NFS-e/NFE BR pendente |
| BI e relatórios (Módulo 19) | ⏳ Reports básico ok ; BI/cubos/exportação pendente |
| Marketplace de integrações (Módulo 20) | ❌ não iniciado |
| App mobile cliente e técnico | ❌ não iniciado |

## Fase 5 — Internacionalização

- Multi-país (validadores BR e PY ✅, próximos: MX, AR, CO, ES)
- Multi-moeda + câmbio automático (❌)
- Compliance local fiscal por país (⏳ PY ok via SIFEN)
- Métodos de pagamento locais (❌)

## Dependências e caminho crítico

```
Core (Fase 1) ──▶ CRM ──▶ Contratos ──▶ Financeiro ──▶ Portal
                   │                         │
                   └──▶ RADIUS ──────────────┘
                                             │
                              ┌──────────────┴────────────┐
                              ▼                           ▼
                           Fase 2 (Técnica)          Fase 4 (Fiscal, BI)
                              │
                              ▼
                           Fase 3 (Atendimento + IA)
```

O Core é bloqueador para todos. Contratos bloqueia Financeiro. Fase 2 pode rodar
em paralelo com Fase 3 com squads separados. Asaas e D4Sign são os dois
bloqueadores externos que ainda travam o "fechamento" de Fase 1.
