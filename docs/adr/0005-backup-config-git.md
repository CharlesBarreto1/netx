# ADR 0005 — Backup de config versionado em git

- Status: aceito
- Data: 2026-06-19

## Contexto

Pilar 4 (AGENTS.md): puxar a config via PyEZ periodicamente e a cada mudança, versionar em
git (histórico/diff/blame de graça) e **alertar em diff inesperado**. A ferramenta é
read-only, então toda mudança de config é externa (CLI/outro) e merece alerta.

## Decisão

- **O gateway só coleta** (`get_config` formato `set`, read-only) e devolve o texto pela fila.
  A **API versiona**: mantém a fronteira "gateway fala com device, API dona da persistência".
- **Um repositório git** em `BACKUP_REPO_DIR` (dev: `infra/config-backups`, gitignored), com
  **um arquivo por device** (`<deviceId>.conf`). Repo próprio, separado do monorepo — o
  `ensureRepo` cria o `.git` local (checando o `.git` da pasta, não `rev-parse`, que acharia o
  repo pai). Commits com identidade fixa.
- **ConfigSnapshot** (Prisma) guarda `gitHash` + `diffSummary` por captura. Só cria snapshot
  quando há mudança real (git detecta diff); 1ª vez = `baseline`.
- **Alerta**: mudança (não-baseline) cria um `Event` (`type=config-change`, severity warning).
  O endpoint de eventos passou a **unir** traps SNMP (metrics.snmp_trap) + Event (Prisma), então
  o painel mostra os dois.
- **Agendamento**: `@nestjs/schedule` roda backup de todos os devices com credencial no
  `BACKUP_CRON` (padrão diário 03:00) + endpoint manual `POST /devices/:id/backup`.
- **Histórico/diff**: `GET /devices/:id/snapshots` e `/snapshots/:id` (config + diff unificado
  vs anterior). A tela mostra a lista e o diff colorido.

## Consequências

- Diff/blame/rollback de config de graça via git; a config fica fora do banco (só o ponteiro
  `gitHash`). O repo é gitignored no monorepo (não vaza config/segredos do cliente).
- A IA/ferramenta nunca escreve config no device — o backup é puramente leitura.
- Em produção, `BACKUP_REPO_DIR` deve ser um volume persistente; rotacionar/limitar histórico
  é trabalho futuro. Trigger on-change via trap `jnxCmCfgChange` é evolução natural (o receptor
  de traps já existe).

## Alternativas

- **Gateway commitando no git**: quebraria a fronteira de persistência (API é a dona).
- **Config no banco (sem git)**: perderia diff/blame/histórico nativos. Rejeitado.
- **Oxidized**: referência; com PyEZ + git resolvemos sob medida e integrado ao resto.
