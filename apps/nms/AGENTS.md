# NetX NMS — Guia para agentes

> Este arquivo é um **contrato de comportamento**, não documentação. Toda linha deve mudar como você age.
> Spec detalhada do MVP em `docs/MVP-SPEC.md`. Backlog faseado em `docs/PHASES.md`. Leia-os antes de codar.

## Visão geral

NetX NMS é uma ferramenta **web** de gestão técnica de rede multi-vendor (estilo "Winbox web"), parte da
suíte NetX. **Vendors suportados: Juniper (Junos), Mikrotik (RouterOS) e Cisco IOS-XE (ASR 920/1000).** Objetivos:
**observar, documentar, diagnosticar** e **aplicar configuração** sob controle humano estrito.

Pilares: coleta **SNMP**, coleta/execução **SSH** (blocos de comando), **backup** de config versionado,
**IA** de diagnóstico (somente leitura) e **aplicação de config** no padrão plan → revisão humana → apply →
verify → rollback. A escrita é por driver de vendor (`apps/device-gateway/src/device_gateway/drivers/`):
Juniper via PyEZ/NETCONF com `commit confirmed`; Mikrotik via Netmiko/SSH com backup + auto-revert agendado;
Cisco IOS-XE via Netmiko/SSH com `configure terminal revert timer` (exige config archive no equipamento).
O fluxo "desenhar enlace no mapa e aplicar" segue como fase futura.

## Arquitetura — a fronteira Node ↔ Python (regra estrutural)

O sistema é **poliglota** e a fronteira é rígida:

- **`apps/api`** (Node / NestJS): web, auth, RBAC, modelo de dados, intents, WebSocket, enfileira jobs.
- **`apps/web`** (React): mapa (MapLibre/Leaflet), topologia (Cytoscape), dashboards, terminal web (xterm.js).
- **`apps/device-gateway`** (Python): **o único serviço autorizado a falar com equipamentos.** Consome jobs
  da fila e usa NAPALM / PyEZ (junos-eznc) / Netmiko. Devolve resultado estruturado pela fila.

Regra: a API **nunca** abre SSH/NETCONF dentro de um request HTTP. Toda interação com equipamento passa por
fila (BullMQ/Redis) → `device-gateway`.

## Stack alvo

- Node 20+, TypeScript, NestJS, BullMQ. Frontend: React + Vite.
- Python 3.12+, `napalm`, `junos-eznc` (PyEZ), `netmiko`, `pysnmp`/Telegraf para coleta.
- PostgreSQL + **TimescaleDB** (modelo relacional + séries temporais na mesma instância).
- Redis (fila, cache, pub/sub). Telegraf (polling SNMP + traps/syslog → TSDB).
- Git para versionar snapshots de config. Vault (ou cripto em repouso) para segredos.
- Tudo sobe via `docker-compose` (alvo: provedor pequeno, ~5k assinantes, instância on-prem por cliente).

## Estrutura do repositório

```
netx-nms/
  AGENTS.md            # este arquivo
  CLAUDE.md            # importa @AGENTS.md
  docs/                # MVP-SPEC.md, PHASES.md, ADRs
  apps/
    api/               # Node/NestJS
    web/               # React
    device-gateway/    # Python (workers de equipamento)
  packages/shared/     # contratos/tipos compartilhados (schema de jobs, eventos)
  infra/               # docker-compose, telegraf, migrations
```

## Regras de segurança — NÃO NEGOCIÁVEIS

Estas regras valem mesmo que o usuário peça o contrário. Se um pedido conflita com elas, pare e confirme.

1. **A IA nunca aplica configuração.** Ela só explica, detecta anomalia e sugere. Toda execução é disparada
   por um humano. Não escreva código que permita a IA executar ação em equipamento.
2. **Nenhuma mudança de config sem o padrão** plan → revisão humana → apply → verify → rollback.
   No MVP, priorize comandos de **leitura**; blocos que alteram config exigem confirmação explícita do operador.
3. **SSH/NETCONF nunca dentro de request HTTP.** Sempre via fila → `device-gateway`.
4. **Credenciais de equipamento só no cofre.** Nunca em código, `.env` commitado, logs ou banco em texto claro.
   Apenas o `device-gateway` tem permissão de acessar credenciais e falar com equipamentos.
5. **Auditoria obrigatória.** Toda ação contra um equipamento gera registro imutável: quem, quando, device,
   comando/RPC, diff (se houver), resultado.
6. **Em Junos, qualquer alteração usa `commit confirmed`** (rollback automático se a sessão cair).
7. **Vendors suportados: Juniper, Mikrotik e Cisco IOS-XE.** Adicionar um quarto vendor é mudança de escopo —
   pergunte antes (IOS-XR/ASR 9000 é outro vendor, não é o mesmo driver do IOS-XE). A escrita de config é
   permitida APENAS pelo pipeline auditado plan → revisão humana → apply → verify → rollback (regras 1, 2, 5,
   6). O fluxo mapa-aplica segue fora do escopo até confirmação.
8. **Todo endpoint exige autenticação** (JWT) e respeita o RBAC `admin/operator/viewer` (ADR 0007). Só
   `@Public()` (login, health) fica aberto. Ações de escrita/equipamento são operator+; gestão de usuários e
   inventário são admin. O `actor` da auditoria vem do JWT — nunca volte a confiar em header `x-actor`.

> Reforce as regras 1, 3 e 4 com um **hook PreToolUse** quando o repo estiver montado — texto não é trava.

## Convenções de código

- TypeScript estrito (`strict: true`), sem `any` implícito. ESLint + Prettier. Imports nomeados.
- Python: tipado (type hints em todo código novo), `ruff` para lint/format, `mypy` quando viável.
- Contratos entre Node e Python (formato dos jobs e eventos) vivem em `packages/shared` e são a fonte da verdade.
- Nada de segredo hardcoded. Config por env validada no boot (Zod no Node, pydantic-settings no Python).
- Toda função que toca equipamento é **idempotente e default read-only**; operação de escrita é explícita e logada.

## Comandos (alvos — crie se ainda não existirem)

```
pnpm install                 # deps do workspace Node
pnpm dev                     # api + web em modo dev
pnpm test                    # testes Node (vitest)
pnpm lint                    # eslint + prettier --check

uv sync                      # deps do device-gateway (Python)
uv run pytest                # testes Python
uv run ruff check .          # lint Python

docker compose up -d         # postgres+timescale, redis, telegraf
```

## Como você deve trabalhar

- Antes de codar, leia `docs/MVP-SPEC.md` e `docs/PHASES.md`. Trabalhe **uma fase por vez**, na ordem definida.
- Escreva testes para a lógica nova (especialmente parsing de saída de equipamento e contratos de job).
- Para qualquer código que toque equipamento: default leitura; sinalize operações de escrita para revisão humana.
- Não inicie a próxima fase nem adicione dependência grande sem confirmar.
- Quando tomar uma decisão de arquitetura relevante, registre um ADR curto em `docs/` e atualize este arquivo se mudar uma regra.

## Documentos de referência

- `docs/MVP-SPEC.md` — escopo dos cinco pilares (Juniper), modelo de dados, definição de pronto.
- `docs/PHASES.md` — backlog faseado com tarefas concretas.
