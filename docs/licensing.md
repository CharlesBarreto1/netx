# Licenciamento NetX

> Como o NetX (instalado na VPS de cada ISP contratante) valida que a licença
> está em dia com a NetX (nós). Documento de arquitetura — a implementação do
> **Hub** (nosso lado) fica no repo separado `netx-hub`.

## Princípios

1. **Fail-open por padrão.** Sem `NETX_HUB_URL` + `NETX_LICENSE_KEY`
   configurados, o módulo é **no-op**: libera tudo. Instalações antigas e a
   produção atual não quebram. Licenciamento só "morde" onde foi provisionado.
2. **Token assinado, não checagem online dura.** O Hub assina um token
   (Ed25519). O NetX embute só a **chave pública** e valida o token
   **localmente** a cada request — não depende do Hub estar no ar a cada
   chamada. Derrubar o Hub não derruba os clientes em dia.
3. **Renovação por heartbeat, validade folgada.** Heartbeat diário (com jitter)
   renova um token que vale **7 dias** (`LICENSE_TOKEN_TTL_DAYS`). Cliente em
   dia fica ~7 dias à frente; cliente sem contato 7 dias entra em bloqueio.
4. **Bloqueio = UI travada, rede de pé.** O guard devolve `402` só nas rotas de
   operador. RADIUS/PPPoE/cobrança dos assinantes do ISP **nunca** caem por
   licença. Status `BLOCKED` no token bloqueia na hora (não espera expirar).

## Fluxo

```
  NetX (cliente)                              Hub (nós, netx-hub)
  ───────────────                             ───────────────────
  boot / @Cron diário (jitter)
    POST /v1/instances/heartbeat  ───────────▶  valida instanceKey
      { instanceId, version,                    apura status (ACTIVE/BLOCKED/…)
        activeContracts, nonce }                fatura por activeContracts
                                  ◀───────────  { token } (JWS Ed25519, exp +7d)
    verifica assinatura (pubkey embutida)
    persiste em license_state
  ───────────────
  cada request → LicenseGuard lê token cacheado:
    desligado?           → allow (fail-open)
    rota isenta?         → allow
    status=BLOCKED?      → 402
    expiresAt < agora?   → 402  (perdeu contato além do TTL)
    senão                → allow
```

## Token (JWS compacto, EdDSA)

`base64url(header).base64url(payload).base64url(signature)` — header
`{"alg":"EdDSA","typ":"netx-lic"}`. Payload (claims):

| claim   | significado |
|---------|-------------|
| `iss`   | `"netx-hub"` |
| `sub`   | `instanceId` (uuid da instalação, gerado no enrollment) |
| `status`| `ACTIVE` \| `BLOCKED` \| `SUSPENDED` |
| `plan`  | rótulo do plano (ex.: `per-contract`) |
| `maxContracts` | teto contratado (0 = ilimitado) — informativo no cliente |
| `blockMode` | `UI_ONLY` \| `UI_AND_PROVISIONING` (degrau de bloqueio) |
| `iat`   | emitido em (epoch s) |
| `exp`   | expira em (epoch s) — `iat + 7d` |
| `graceUntil` | epoch s até quando mostra só banner antes de travar (opcional) |

Assinatura sobre `header.payload` com a privada do Hub. O cliente valida com a
pública embutida em `packages/shared/src/licensing/public-key.ts`.

## Chaves

- **Privada**: só no Hub. NUNCA no repo NetX (vai no `git clone` de cada VPS).
  Em dev, salva fora do repo (`~/Documents/netx-hub-secrets/`). Em prod, cofre.
- **Pública**: embarcada no NetX. Trocar a chave = recompilar/atualizar o NetX
  dos clientes (`sudo netx-update`), então rotação é evento raro e planejado.

## Enrollment (provisionar licença numa instalação)

No installer (Fase 2): gera `instanceId` (uuid) e recebe um `NETX_LICENSE_KEY`
(segredo por instância, emitido no cadastro do licenciado no Hub). Ambos vão
pro `/etc/netx/.env` / `.secrets`. O primeiro heartbeat registra a instância.

## Variáveis de ambiente (cliente)

| env | papel |
|-----|-------|
| `NETX_HUB_URL` | base do Hub (ex.: `https://hub.netx.com.br`). Vazio = licenciamento desligado. |
| `NETX_LICENSE_KEY` | segredo da instância (auth no heartbeat). Vazio = desligado. |
| `NETX_INSTANCE_ID` | uuid da instalação (gerado no enrollment). |

## Anti-fraude (realista)

Cliente tem root na VPS, então DRM perfeito não existe. O que temos:
assinatura impede forjar token; bloquear DNS do Hub só adia o bloqueio até o
TTL; apontar pra um Hub falso exigiria a chave privada (não temos como evitar
só se vazar a privada). Sinal forte: **telemetria some do nosso painel** quando
alguém corta o heartbeat — vira alerta comercial, não defesa técnica.
