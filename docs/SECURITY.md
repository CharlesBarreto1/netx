# Segurança — NetX

## Modelo de ameaças (alto nível)

| Ativo | Ameaças principais |
|-------|-------------------|
| Dados de clientes (PII) | Vazamento cross-tenant, acesso não autorizado |
| Credenciais de rede (OLT, switches) | Exfiltração, reuso |
| Faturamento | Fraude, manipulação de cobrança |
| Rede do ISP | Ataque via CPE comprometida, DDoS |

## Controles implementados (MVP)

### Autenticação
- **Passwords:** argon2id (`memoryCost=19456, timeCost=2, parallelism=1`) — OWASP 2024
- **Sessões:** JWT HS256 access (15min) + refresh (7d) rotacionado a cada uso
- **MFA:** TOTP + backup codes (roadmap — schema pronto)
- **SSO:** OIDC / SAML (roadmap)
- **API Keys:** SHA-256 hash, prefixo por ambiente (`netx_live_…`), escopo obrigatório

### Autorização
- **RBAC** — papéis por tenant + papéis de sistema (superadmin)
- **ACL** — permissão granular por recurso e ação (`users.create`, `invoices.read`)
- **ABAC (roadmap)** — policies contextuais (horário, IP, MFA)
- **Isolamento de tenant** — `tenantId` em toda query + RLS no Postgres

### Criptografia
- **In-transit:** TLS 1.2+ obrigatório em produção (terminação no Ingress)
- **At-rest:** Postgres com encryption at rest (RDS/CloudSQL nativo)
- **Campos sensíveis:** secrets de equipamentos cifrados com AES-256-GCM (cofre de senhas — Módulo 7)

### Auditoria
- `audit_logs` append-only; `level=CRITICAL` para ações cross-tenant
- Logs estruturados com `correlationId`, `tenantId`, `userId`

### Secrets
- Nunca no código ou em `.env` versionado
- Dev: `.env` local; Prod: Secret Manager (AWS/GCP/Azure) via ExternalSecrets

### Dependências
- CI executa `npm audit` com `--audit-level=high`
- Dependabot (ou Renovate) abre PRs semanais
- CodeQL scan em cada push para `main`

## Processo

- Vulnerabilidades: reporte privado para `security@netx.<dominio>` (**nunca** issue pública)
- SLA de triagem: 24h úteis; correção crítica: 72h
- Pentest externo anual a partir da GA

## Compliance (roadmap)

- LGPD (Brasil) — base legal, direito de exclusão, DPO, RIPD
- GDPR (UE) — DPA, processador/controlador, portabilidade
- CCPA (EUA) — opt-out, inventário de dados
- SOC 2 Type II (após 12 meses de operação em prod)
