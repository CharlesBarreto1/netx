# NetX Hub

Plataforma de licenciamento do NetX (lado **nós**). Assina os tokens de licença
que cada instalação do NetX valida, controla o status das instâncias
(ativar/bloquear), recebe telemetria (versão, contratos ativos) e é a base do
faturamento por contrato ativo.

> O enforcement no cliente (guard, heartbeat, tela de bloqueio) vive no repo do
> **NetX**. Aqui é só o Hub. Visão geral em `netx/docs/licensing.md`.

## Stack

NestJS 11 + Prisma 6 + PostgreSQL. Token assinado em **Ed25519 (EdDSA)**.

## Setup

```bash
npm install
cp .env.example .env          # preencha DATABASE_URL, HUB_ADMIN_JWT_SECRET, HUB_PORTAL_JWT_SECRET
npm run keygen                # gera o par Ed25519
#  → cole a PRIVADA em .env (LICENSE_PRIVATE_KEY_B64)
#  → cole a PÚBLICA no NetX (packages/shared/src/licensing/public-key.ts)
npm run db:migrate:dev        # cria as tabelas
npm run dev                   # sobe em :4000
```

> Em DEV, pra casar com a chave pública já embarcada no NetX, use a privada de
> `~/Documents/netx-hub-secrets/license-signing-key.dev.txt` em vez de gerar uma
> nova. Em PROD, gere um par novo e guarde a privada num cofre.

## Fluxo de uso

1. **Cadastrar licenciado** (a empresa/ISP):
   ```
   POST /v1/admin/licensees   (Bearer JWT da equipe)
   { "name": "NET Telecom", "plan": "per-contract", "maxContracts": 0 }
   ```
2. **Provisionar a instância**: instale o NetX no cliente (o installer gera o
   `NETX_INSTANCE_ID`), depois cadastre-a:
   ```
   POST /v1/admin/instances
   { "licenseeId": "...", "instanceId": "<NETX_INSTANCE_ID>", "label": "Produção" }
   → devolve a licenseKey UMA vez. Configure no .env do cliente:
       NETX_HUB_URL, NETX_LICENSE_KEY (=licenseKey), NETX_INSTANCE_ID
   ```
3. O NetX faz heartbeat diário → o Hub assina e devolve o token (válido 7 dias).
4. **Bloquear / desbloquear**:
   ```
   POST /v1/admin/instances/:id/status   { "status": "BLOCKED" }   // ou ACTIVE
   ```
   No próximo heartbeat (ou ao reabrir o painel, ≤7 dias) o cliente reflete.

## Endpoints

**Cliente (NetX):**
| Método | Rota | Auth | Função |
|---|---|---|---|
| POST | `/v1/instances/heartbeat` | Bearer licenseKey | renova token + telemetria. Status efetivo = bloqueio admin OU inadimplência (sem desbloqueio em confiança vigente). |

**Admin (equipe NetX — login e-mail+senha → Bearer JWT):**
| Método | Rota | Função |
|---|---|---|
| POST/GET | `/v1/admin/licensees` | cria / lista licenciados |
| GET/POST | `/v1/admin/licensees/:id` | detalhe / atualiza dados completos |
| POST | `/v1/admin/hub-users` | cria login da central pro cliente |
| POST/GET | `/v1/admin/instances` | cria instância (key 1x) / lista + telemetria |
| POST | `/v1/admin/instances/:id/status` | ativar/bloquear/suspender |
| POST | `/v1/admin/instances/:id/rotate-key` | re-emite a license key |
| GET  | `/v1/admin/invoices?licenseeId=` | lista faturas |
| POST | `/v1/admin/licensees/:id/generate-invoice` | gera fatura do mês sob demanda |
| POST | `/v1/admin/invoices/:id/mark-paid` | baixa manual (PIX/CARD/MANUAL) |

**Central do cliente (ISP, login e-mail+senha → Bearer JWT):**
| Método | Rota | Função |
|---|---|---|
| POST | `/v1/portal/login` | login (e-mail+senha) → token |
| GET  | `/v1/portal/me` | dados, instâncias, situação (em dia/atraso), cota de desbloqueio |
| GET  | `/v1/portal/invoices` | minhas faturas |
| POST | `/v1/portal/trust-unlock` | desbloquear em confiança (N dias, máx X por fatura) |
| POST | `/v1/portal/pay` | iniciar pagamento Pix (EFI) — retorna copia-e-cola + QR |

| GET  | `/health` | liveness |

## Faturamento

- Fatura mensal automática (cron diário, gera no começo do mês): **pico de
  contratos ativos no período × `pricePerContractCents`**.
- Vencimento = `billingDay` do licenciado. Passou do vencimento + graça
  (`LICENSE_GRACE_DAYS`) → `OVERDUE` → próximo heartbeat **bloqueia** (a menos
  que haja desbloqueio em confiança vigente).
- **Desbloqueio em confiança**: a central libera por `TRUST_UNLOCK_DAYS`,
  no máximo `TRUST_UNLOCK_MAX_PER_INVOICE` por fatura em atraso.
## Pagamento Pix (EFI)

Pix imediato via EFI (mTLS com certificado .p12). Configure no `.env`:
`EFI_ENABLED=true`, `EFI_CLIENT_ID/SECRET`, `EFI_CERTIFICATE_BASE64` (+senha),
`EFI_PIX_KEY`, `HUB_PUBLIC_URL`, `EFI_WEBHOOK_TOKEN`.

- Central → "Pagar" → cria cobrança Pix (`POST /v1/portal/pay`) e mostra
  copia-e-cola + QR. Idempotente: reusa a cobrança vigente.
- **Baixa automática**: a EFI chama `POST /v1/efi/webhook/pix/<EFI_WEBHOOK_TOKEN>`;
  o Hub acha a fatura pelo `txid` e marca como paga → o cliente sai do bloqueio
  no próximo heartbeat. Registre o webhook na EFI apontando pra essa URL
  (proteja com mTLS no proxy).
- `EFI_ENABLED=false` (padrão) → "Pagar" recusa com orientação; admin dá baixa
  manual (`mark-paid`). O resto do sistema funciona igual.

## Teste de compatibilidade

Prova que o token do Hub é aceito pelo verificador real do NetX:

```bash
# 1) compile o shared do NetX
( cd ../../netx && npm run build -w @netx/shared )
# 2) rode o teste (usa a chave DEV automaticamente)
npm run test:signing
```

## Web (painel admin + central + hotsite)

App Next em `web/` (`npm run dev -p 4100`). `NEXT_PUBLIC_HUB_API` aponta pra
API. Superfícies: `/` (hotsite/landing), `/admin` (equipe NetX, login
e-mail+senha) e `/portal` (central do cliente). Deploy: ver `DEPLOY.md`.

## Login da equipe (admin)

E-mail+senha (scrypt + JWT). Crie o primeiro usuário:
`ADMIN_EMAIL=.. ADMIN_PASSWORD=.. npm run create-admin`. Mais usuários pelo
próprio painel. (Substituiu o antigo token único.)

## Backup

`deploy/backup/netx-hub-backup.sh` + systemd timer (diário): pg_dump validado,
retenção, off-site opcional via rclone (`HUB_BACKUP_REMOTE`). Ver `DEPLOY.md`.

## Segurança

- A **chave privada** de licença assina tudo — vaze ela e dá pra forjar
  licença. Guarde em cofre, nunca no git.
- License keys e senhas guardadas como hash (sha256 / scrypt).
- JWTs com segredos próprios (`HUB_ADMIN_JWT_SECRET`, `HUB_PORTAL_JWT_SECRET`).
