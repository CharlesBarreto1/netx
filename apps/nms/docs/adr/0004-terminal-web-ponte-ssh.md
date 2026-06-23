# ADR 0004 — Terminal web: ponte SSH via WebSocket pelo gateway

- Status: aceito
- Data: 2026-06-19

## Contexto

O terminal web (xterm.js, uso manual N3) precisa de uma sessão SSH **interativa** — fluxo de
bytes bidirecional, não um job request/response. A §3 é não-negociável: SSH/NETCONF nunca
dentro da API; o `device-gateway` é o único que abre SSH. A fila (BullMQ) serve para jobs,
não para streaming interativo.

## Decisão

Ponte de **dois saltos WebSocket**, mantendo o SSH só no gateway:

```
browser (xterm.js) ⟷ WS ⟷ API (proxy de bytes) ⟷ WS ⟷ gateway (paramiko shell) ⟷ device
```

- O **gateway** roda um servidor WebSocket (`terminal.py`, porta 8766). Primeira mensagem =
  init JSON {mgmtIp, username, passwordEnc, ...}; ele **decifra** a senha (chave-mestra só
  aqui), abre `invoke_shell` (paramiko) e faz a ponte. Mensagem `\x1b[resize:c,r` redimensiona
  o PTY.
- A **API** expõe `/ws/terminal` (servidor `ws` cru anexado ao http server do Nest). Lê do
  banco o device + a credencial **cifrada**, abre um WS para o gateway, manda o init e
  **repassa bytes** nos dois sentidos. A API **não abre SSH** — só transporta (§3 preservada).
  Cada sessão gera AuditLog (`device.terminal.open`).

## Consequências

- SSH interativo sem violar a §3 nem reaproveitar a fila para streaming.
- A API só vê ciphertext da senha; o gateway decifra. Mesma fronteira do cofre (ADR 0002).
- **Pendência de segurança**: hoje não há auth na API (módulo de auth não existe ainda), então
  o terminal é aberto sem autenticação de usuário — fechar isso quando a auth/RBAC entrar.
- O gateway terminal escuta em `127.0.0.1:8766` (dev). Em produção, gateway e API ficam na
  mesma instância on-prem; expor só o necessário.

## Alternativas

- **SSH na API**: viola §3. Rejeitado.
- **Streaming pela fila (BullMQ)**: a fila é request/response; péssimo para PTY interativo.
- **Browser direto no gateway**: exporia o gateway e perderia o ponto de auth/audit da API.
