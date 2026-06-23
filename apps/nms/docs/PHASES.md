# NetX NMS — Fases do MVP (ordem de build)

Ordem de dependência: **Fundação → (SNMP ∥ SSH) → Backup → IA.** A IA vem por último porque consome a saída
de todos os outros. Trabalhe uma fase por vez; não inicie a próxima sem a anterior estar com testes passando.

---

## Fase 0 — Scaffolding

- [ ] Monorepo com `apps/api` (NestJS), `apps/web` (React/Vite), `apps/device-gateway` (Python+uv), `packages/shared`.
- [ ] `docker-compose` com Postgres+TimescaleDB, Redis e Telegraf.
- [ ] Pipeline de migrations e seed básico.
- [ ] Hook **PreToolUse** aplicando as regras de segurança (bloquear escrita em equipamento sem flag de revisão).
- [ ] Contratos de job/evento em `packages/shared` (schema do job, schema do resultado).

## Fase 1 — Fundação

- [ ] CRUD de `Device` (hostname, mgmt_ip, model, os_version, site).
- [ ] Integração com o cofre de credenciais (apenas `device-gateway` lê segredo).
- [ ] Fila Node→Python (BullMQ/Redis) + worker Python que recebe e responde job.
- [ ] Job "testar conectividade": valida SSH, NETCONF (830) e SNMP em um Juniper. Resultado vai pra UI.
- [ ] `AuditLog` gravando toda execução contra equipamento.

## Fase 2a — SNMP

- [ ] Telegraf configurado com input SNMP (IF-MIB + `jnxBoxAnatomy`/`jnxOperating*` + DOM óptico) → TimescaleDB.
- [ ] Auto-descoberta de interfaces ao adicionar device (popula `Interface`).
- [ ] Receptor de traps (`snmp_trap`) normalizando em `Event`.
- [ ] Dashboard: tráfego, erros, temperatura, CPU, luz óptica ao vivo.

## Fase 2b — SSH

- [ ] `device-gateway` com PyEZ: getters estruturados (rota, OSPF, BGP).
- [ ] Conceito de **playbook** (bloco de comando nomeado), começando read-only.
- [ ] Execução de playbook com confirmação do operador + auditoria + saída estruturada na UI.
- [ ] Terminal web (xterm.js) ligado a uma ponte SSH no backend, para uso manual N3.

## Fase 3 — Backup

- [ ] Job de coleta de config (PyEZ `get_config` em set + XML).
- [ ] Commit em repositório git por device, agendado e on-change.
- [ ] Detecção de diff inesperado → alerta com diff legível.
- [ ] Tela de histórico de `ConfigSnapshot` com comparação entre versões.

## Fase 4 — IA (nesta ordem interna)

- [ ] 4.1 Anomalia estatística sobre o TSDB (baseline móvel + z-score; CRC, óptica, temp, CPU).
- [ ] 4.2 Resumo de mudança de config (LLM explica o diff do backup em português).
- [ ] 4.3 Copiloto grounded: Q&A sobre um device usando métricas + eventos + config coletados (cita evidências).
- [ ] Garantir, por hook e por design, que a IA **nunca** dispara ação em equipamento.

## Fase 5 — Produção (auth + deploy)

Endurecimento para colocar uma instância on-prem no ar por cliente.

### 5a — Auth / RBAC (ADR 0007) ✅

- [x] Modelo `User` (`app_user`) + enum `Role` (admin/operator/viewer) + migration.
- [x] Login JWT (HS256, `@nestjs/jwt`), senha com scrypt nativo, `JWT_SECRET` obrigatório no boot.
- [x] Guards globais: `JwtAuthGuard` (+ `@Public()`) e `RolesGuard` (+ `@Roles()`). Endpoints de escrita = operator+,
      gestão de usuários/inventário = admin, leitura/copiloto = qualquer autenticado.
- [x] Terminal WS exige token (operator/admin); `actor` da auditoria vem do JWT (fim do `x-actor`).
- [x] CRUD de usuários (admin) + seed do 1º admin no boot + trava do último admin.
- [x] Web: tela de login, token em `localStorage`, header `Authorization`, logout, UI por papel, painel de usuários.

### 5b — Installer via GitHub (imagens GHCR) ✅

- [x] Dockerfiles de `api` (NestJS+Prisma, migrations no entrypoint), `web` (Vite→nginx) e `device-gateway` (uv).
- [x] `infra/docker-compose.prod.yml` (imagens do GHCR) + `telegraf.prod.conf` (segredo por env) + `.env.prod.example`.
- [x] GitHub Actions `release.yml`: builda/publica as 3 imagens no GHCR e anexa `netx-nms-stack.tar.gz` ao Release.
- [x] `scripts/install.sh`: baixa o bundle, gera segredos no `.env`, puxa imagens, sobe a stack, espera a API.

### 5c — Atualizador ✅

- [x] `scripts/update.sh`: resolve versão alvo, backup do banco, atualiza arquivos de deploy (preserva `.env`),
      puxa imagens, `up -d` (migrations no boot), healthcheck e **rollback automático** da tag em caso de falha.

> Pendências pós-5: rate-limit no login, refresh token / rotação de `JWT_SECRET`, build multi-arch (hoje só amd64).

---

## Critério de saída do MVP

Ver "Definição de pronto" em `docs/MVP-SPEC.md`. Quando os cinco itens passarem ponta a ponta com um Juniper
real (ou virtual, ex.: vMX/vSRX em lab), o MVP está fechado e abre-se a fase 2 (multi-vendor + mapa-aplica).
