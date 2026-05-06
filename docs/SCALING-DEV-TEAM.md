# Escalando o time de DEV — checklist pós-MVP

> **Quando aplicar:** ao lançar o NetX V1.0 (primeiro cliente pagante em
> produção). Antes disso, é cedo — o overhead de processo atrapalha mais
> que ajuda enquanto o produto ainda muda muito.
>
> **Quem decide aplicar:** Charles (founder). Cada item abaixo é
> independente, dá pra adotar separado conforme a dor aparece.

---

## Fase 0 — Hoje (pré-MVP)

Estado atual: **1 dev (Charles) + assistente IA**. Tudo bem como está:

- Histórico no GitHub
- CI bloqueando build quebrado em PR
- `docs/` com runbook + arquitetura + conventions
- Conventional Commits
- Auditoria interna (audit_logs)

Não adicione ferramenta nova até ter pelo menos **1 cliente pagante** OU
**3+ devs**. Antes disso, qualquer processo é cerimonia inútil.

---

## Fase 1 — MVP lançado, 1-2 devs (mês 0-3 pós-launch)

**Trigger:** primeiro cliente pagante OU contratou primeiro dev.

### Setup mínimo (~3h totais de configuração)

1. **Branch protection no GitHub** (5 min)
   - Settings → Branches → main
   - Require PR + 1 review + CI passing
   - Inclui você — força disciplina

2. **PR template** (10 min)
   - Criar `.github/PULL_REQUEST_TEMPLATE.md`
   - Campos: o que mudou, como testar, screenshots, riscos

3. **Releases tagueadas** (1h)
   - A cada deploy: `git tag v0.x.y && git push --tags`
   - Rollback: `git checkout v0.x.(y-1) && rebuild && pm2 restart`
   - Considerar GitHub Release notes automáticas via `release-drafter`

4. **Migrações Prisma versionadas** (3h — alta prioridade)
   - Hoje: `prisma db push` (sem rollback)
   - Trocar por: `prisma migrate dev` em dev + `prisma migrate deploy` em prod
   - Cria arquivos em `prisma/migrations/` versionados no repo
   - Sem isso, rollback de mudança de schema é manual e arriscado

5. **Sentry para erros em produção** (2h)
   - Free tier: 5k events/mês — suficiente pra começar
   - Captura stack trace + user + URL quando algo crasha
   - Você vê antes do cliente reclamar

### Documentação adicional

- `docs/ONBOARDING.md` — dev novo roda tudo local em <30min
- Atualizar `docs/RUNBOOK.md` com os comandos de rollback

### Custo extra mensal

- $0 (Sentry free + GitHub free + tudo que já tem)

---

## Fase 2 — Time consolidado, 3-5 devs (mês 3-9 pós-launch)

**Trigger:** backlog passou de ~30 issues abertas OU contratou 2º dev pleno.

### Adicionar

1. **Tracking de issues + roadmap**
   - **GitHub Projects** (grátis) ou **Linear** ($10/dev/mês)
   - Recomendação: começar com Projects, migrar pra Linear se time
     reclamar de UX
   - Labels obrigatórias: `bug`, `feature`, `tech-debt`, `priority-{1,2,3}`
   - Estimativas grosseiras (S/M/L), não story points

2. **Code Owners**
   - `.github/CODEOWNERS` mapeia pastas pra reviewers
   - Ex.: `apps/core-service/src/modules/finance/ @charles @joao-financeiro`
   - PR pra aquela pasta requisita review desses

3. **Sprints informais**
   - Quinzenal, 30min de planning, zero cerimônia Scrum
   - Pega ~10 issues, divide, segue
   - Daily standup só se time virtual; presencial não precisa

4. **Sentry plano pago se necessário** ($26/mês)
   - Quando passar de 5k events ou precisar de retention >90 dias

5. **Status page público**
   - Better Stack ou statuspage.io
   - Cliente vê uptime sem precisar ligar

### Documentação adicional

- `docs/ARCHITECTURE-DECISIONS/` (ADRs) — toda decisão técnica
  importante vira um arquivo curto (template em `docs/adr/`).
  Ex.: "Por que IPoE é default", "Por que Prisma e não TypeORM"
- **Notion** ou similar pra docs de produto/operação (não-devs leem)

### Custo extra mensal

- ~$50-100 (Sentry pago + Linear se adotado)

---

## Fase 3 — Time grande, 6+ devs (mês 9+ pós-launch)

**Trigger:** vários times paralelos OU compliance/auditoria externa exigir.

### Adicionar

1. **Migrar pra plataforma robusta**
   - Linear (se ainda não migrou)
   - Possível: Jira + Confluence se cliente enterprise exigir
   - Datadog ou similar pra observability completa

2. **Squads / Times**
   - Time de Backend (core)
   - Time de Frontend (web + portal)
   - Time de Infra/DevOps
   - Cada squad com tech lead próprio

3. **CI/CD avançado**
   - Deploy automático em staging em cada PR
   - Promote pra prod via approval manual
   - Feature flags (LaunchDarkly ou similar) pra rollouts graduais

4. **Compliance**
   - SOC 2 Type 1 / ISO 27001 se enterprise exigir
   - Pen tests anuais
   - Backups testados (não só rodados, **restaurados** trimestralmente)

### Custo extra mensal

- $500-2000 dependendo de ferramentas e compliance

---

## Decisões já tomadas — não revisitar

Pra evitar bikeshedding quando o time crescer, registrar aqui o que **já está
escolhido e funciona**:

| Decisão | Stack |
|---|---|
| Linguagem backend | TypeScript + NestJS |
| Linguagem frontend | TypeScript + Next.js 14 (App Router) |
| ORM | Prisma 5 |
| Banco | PostgreSQL 16 |
| Cache/fila | Redis + RabbitMQ |
| Monorepo | Nx 19 |
| Estilo | TailwindCSS + componentes próprios |
| Auth | JWT (access 12h + refresh 90d) + MFA TOTP |
| i18n | next-intl (pt-BR / es-PY / en-US) |
| Default locale | es-PY (mercado primário Paraguai) |
| Auth contrato → RADIUS | IPoE (PPPoE legado opcional) |
| Multi-tenancy | tenantId em toda tabela + RLS no Postgres |
| Hospedagem | VPS Debian 12 + PM2 + Nginx |
| CI | GitHub Actions |

Mudanças aqui exigem ADR (Architecture Decision Record) escrito + aprovação.

---

## Quando contratar

Ordem de prioridade pra primeiras contratações:

1. **Dev fullstack pleno** (mês 0-1 pós-MVP) — alivia bottleneck do
   founder, especialmente em frontend que é onde mais acumula trabalho
2. **Dev backend sênior** (mês 3-6) — quando módulos financeiro/RADIUS
   começarem a pedir performance e integração externa (Asaas, D4Sign)
3. **DevOps part-time** (mês 6-9) — quando infra começar a crescer:
   múltiplas VPS, ambiente de staging, monitoramento
4. **QA / suporte técnico** (mês 9-12) — quando volume de tickets de
   cliente passar do que founder consegue absorver

**Antes do primeiro contratado**: tenha onboarding doc pronto, código
revisável, e pelo menos 2 semanas de runway pra mentoria (o dev novo
não vai produzir nas primeiras 2-3 semanas mesmo se for sênior).

---

## Sinais de que é hora de evoluir de fase

| Sinal | Próximo passo |
|---|---|
| Você foi acordado por um bug que cliente reportou | Fase 1: Sentry |
| Esqueceu o que mudou em uma release passada | Fase 1: tags + changelog |
| Rollback de mudança de banco virou pesadelo | Fase 1: prisma migrate |
| Backlog tem >30 issues e perdeu o controle | Fase 2: Projects/Linear |
| 2+ PRs em paralelo conflitando entre si | Fase 2: code owners + sprints |
| Cliente pergunta "quando fica pronto X?" e ninguém sabe | Fase 2: roadmap público |
| Time virtual com 4+ devs em fusos diferentes | Fase 3: squads + async-first |

---

## Em uma frase

**Não otimize antes da hora.** Cada item acima é resposta a uma dor
real que apareceu em produto SaaS depois do MVP. Se a dor não chegou,
o processo é só fricção. Releia este doc no dia que NetX V1.0 entrar
em produção e adote o que fizer sentido naquele momento.

---

_Última revisão: maio de 2026 — pré-MVP. Atualizar quando primeira fase
for adotada._
