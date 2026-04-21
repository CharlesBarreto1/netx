# Roadmap — NetX

Planejamento de alto nível. Detalhes por sprint ficam no board (Linear/Jira).

## Fase 1 — MVP (6 meses)

| Sprint | Entregáveis |
|--------|-------------|
| S1–S2 | **Scaffolding** + Core (✅ entregue) |
| S3 | Email/invite flow, MFA TOTP, SSO (OIDC) |
| S4–S5 | **CRM básico** (✅ entregue end-to-end): clientes PF/PJ, endereços, contatos, tags, consentimentos LGPD/GDPR, anotações; validadores de documento BR (CPF/CNPJ) e PY (CI/RUC); frontend operacional Next.js com lista filtrada, formulário PF/PJ, detalhe 360° e catálogo de tags |
| S6–S7 | **Contratos**: modelos, assinatura eletrônica (integração D4Sign) |
| S8–S10 | **Financeiro v1**: mensalidades, boleto/PIX, régua de cobrança, gateway (Asaas) |
| S11 | **Portal do cliente** v1 (2ª via, histórico) |
| S12 | **RADIUS básico** (autenticação PPPoE, CoA) |

## Fase 2 — Operação Técnica (4 meses)

- Gestão de OLTs (Módulo 10) — multi-fabricante
- TR-069 / ACS (Módulo 9)
- IPAM / DCIM (Módulo 8)
- Monitoramento NOC (Módulo 17)
- Gestão de O.S. com app técnico (Módulo 16)

## Fase 3 — Atendimento e IA (3 meses)

- Omnichannel + Chatbot (Módulo 13)
- URA / VoIP (Módulo 12)
- IA de atendimento e preditiva (Módulo 14)

## Fase 4 — Expansão (3 meses)

- Fiscal avançado (Módulo 5)
- BI e relatórios (Módulo 19)
- Marketplace de integrações (Módulo 20)
- App mobile cliente e técnico

## Fase 5 — Internacionalização (3 meses)

- Multi-país (MX, AR, CO, ES primeiro)
- Multi-moeda + câmbio automático
- Compliance local (fiscal por país)
- Métodos de pagamento locais

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

O Core é bloqueador para todos. Contratos bloqueia Financeiro. Fase 2 pode rodar em paralelo com Fase 3 com squads separados.
