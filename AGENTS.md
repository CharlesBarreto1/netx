# NetX — guia operacional pra IA

> Doc denso e prático pra outra sessão (Claude / qualquer agente) assumir o
> trabalho sem precisar mapear tudo. Não é README de marketing — é manual
> de quem vai mexer no código. Mantenha atualizado quando algo estrutural
> mudar.
>
> Atualizado: 2026-05-23 · Owner: Charles Barreto (pt-BR / es-PY)

---

## TL;DR

NetX é um SaaS multi-tenant pra ISPs (BR + PY). Hoje (mai/2026) está em
produção PY rodando em VPS Debian 13 — IP `179.49.176.13`. Stack monorepo
Nx 22 com 4 apps NestJS/Next.js + integração FreeRADIUS + TR-069 ACS
próprio + Mikrotik BNG.

O usuário **Charles** é o owner e dev principal. Fala **português (pt-BR)
preferencialmente**. Decisões já tomadas na operação:
- **PPPoE como padrão de auth** (não IPoE) — decisão 2026-05-22.
- **ONT Huawei EG8145V5/X10 em modo roteador** — PY usa só esses 2 modelos.
- **Ufinet (rede neutra PY)** entrega L2 até o PoP; NetX termina PPPoE no
  seu Mikrotik. Aguardando doc API deles pra integrar provisionamento (task
  #29 — bloqueada).
- **Modo EXTERNAL** das OLTs é o padrão hoje (NoOpOltDriver) — admin
  provisiona OLT manualmente, NetX só registra ONT + faz TR-069 + RADIUS.

---

## Stack

| Camada | Versão / ferramenta |
|---|---|
| Monorepo | Nx 22 (npm workspaces) |
| Node | 24 (NodeSource, via repo `nodistro`) |
| Backend | NestJS 11 |
| Frontend | Next.js 16 (Turbopack) + Tailwind 4 (via `@theme`) |
| ORM | Prisma 6 + PostgreSQL 16 (via PGDG repo) |
| DTOs | Zod 4 em `@netx/shared` |
| Auth | JWT + Argon2 |
| RADIUS | FreeRADIUS 3.2 + backend SQL (schema `radius` no mesmo DB) |
| BNG | Mikrotik (RouterOS) — PPPoE server |
| TR-069 ACS | NetX próprio (`apps/cwmp-server`, porta 7547) |
| i18n web | next-intl — pt-BR, es-PY, en-US |
| Data fetching web | SWR |
| Logger | pino (estruturado JSON em prod) |
| Filas | RabbitMQ (instalado, hoje pouco usado) |
| Cache | Redis |
| OS alvo | Debian 13 (Trixie). Mínimo: 12 (Bookworm) |
| KMS | AES-256-GCM com chave em `/etc/netx/.secrets` (KMS_MASTER_KEY) |

---

## Estrutura do monorepo

```
apps/
  core-service/       # backend principal, porta 3101 (REST API)
  api-gateway/        # proxy HTTP, porta 3000, repassa /api/v1/* → core
  web/                # Next.js 16, porta 3200 (dashboard)
  cwmp-server/        # TR-069 ACS, porta 7547 (SOAP/XML)
  mobile/             # Expo SDK 52 + React Native (técnico de campo)

packages/
  shared/             # DTOs Zod + tipos (fonte da verdade contract entre front/back)
  auth/               # libs de auth compartilhadas
  config/             # loadConfig() — boot banner, env loading
  database/           # helpers Prisma
  logger/             # pino factory

infra/installer/
  install.sh          # entrypoint do bootstrap (roda em VPS nova)
  lib/                # módulos por concern (packages.sh, postgres.sh, ...)
  templates/          # systemd units, env.tmpl, nginx, etc
  scripts/
    netx-update.sh    # comando "sudo netx-update" — deploy de versão nova
    netx-radius-check.sh  # auditoria + reconciliação RADIUS manual
    backup/netx-backup.sh # backup diário (chamado pelo systemd timer)
    seed-admin.ts     # cria/reseta admin

AGENTS.md             # este arquivo
```

### Onde está o quê (core-service)

```
src/modules/
  auth/                  # login, JWT, MFA, sessions
  audit/                 # AuditService.log() — chame em toda mutação importante
  backups/               # listagem de backups + UI
  contracts/             # contratos, planos, faturas, RADIUS sync, OS overdue
    customer-status.ts   # auto-status do customer baseado nos contratos
    radius-sync.service.ts  # enfileira radius_events (PENDING)
    plans.service.ts     # CRUD do catálogo de planos
  crm/                   # customers, deals, pipelines, activities
  crypto/                # AES-256-GCM via KMS_MASTER_KEY (senhas, creds)
  disconnect/            # CoA disconnect estratégias (SSH Mikrotik, RADIUS CoA)
  finance/               # cobranças, caixas, descontos
  network/               # NAS (NetworkEquipment), POPs
  portal/                # portal do cliente final (público)
  prisma/                # PrismaService global (RLS infra-only)
  provisioning/          # OLT/ONT, drivers, install wizard
    drivers/             # NoOpOlt (EXTERNAL), Mock, Ufinet (stub), Huawei SSH (stub)
    tr069-paths.huawei.ts  # paths data model EG8145 (SSID, PPPoE, IPv6, VLAN)
    tr069-tasks.service.ts # enfileira Tr069Task (SET_PARAMS, REBOOT...)
  radius/                # applier (cron 30s), reconciler (cron 5min), CoA, accounting
    radius-applier.service.ts  # consome radius_events, escreve em radius.radcheck/radreply/radusergroup
    radius-reconciler.service.ts  # self-healing — corrige drift contracts↔radius
  reports/               # relatórios financeiros
  roles/                 # RBAC permissions
  service-orders/        # OS, motivos (Instalação trava sem comodato)
  sifen/                 # fatura eletrônica PY (DNIT/e-Kuatiá)
  stock/                 # produtos, fornecedores, locais (ACL), kardex, comodato
  tenants/               # tenant settings + features
  users/                 # CRUD users, MenuAccess
  whatsapp/              # módulo desativado (Evolution API foi descontinuado)
  mobile/                # MobileDevicesService — pair, sync (Fase 1+)
```

### apps/web — estrutura

```
src/
  app/(protected)/       # todas as rotas autenticadas (passa pelo AppShell)
    contracts/
    customers/new/       # wizard 3 passos: cliente → contrato → O.S. instalação
    provisioning/
      install/[contractId]/  # técnico ativa cliente em campo
      pending/             # fila de instalações pendentes
    settings/
      plans/               # catálogo de planos
      service-order-reasons/
      cash-registers/
      tenant/              # config da operação (país/locale/moeda)
      backups/
    olts/                  # admin OLTs (CRUD + test-connection)
    tr069/devices/         # devices TR-069 cadastrados
    stock/
  components/
    layout/AppShell.tsx    # sidebar + topbar + tema (dark mode toggle)
    contracts/NewContractInline.tsx  # form de contrato (usado em 3 lugares)
    ui/                    # primitivos (Button, Input, Modal, Tooltip…)
  lib/
    api.ts                 # cliente HTTP central (handle 401, ApiError)
    menus.ts               # catálogo de menus + visibleMenuGroups()
    session.ts             # hasPermission(), useSession()
    use-money.ts           # useFormatMoney() — formatação por tenant currency
  i18n/messages/{pt-BR,es-PY,en-US}.ts
```

---

## Como operar

### Em produção (VPS Debian)

```bash
# Atualizar pra versão mais recente (git pull + build + migrate + restart + smoke)
sudo netx-update

# Recovery total / VPS nova
sudo bash /opt/netx/infra/installer/install.sh

# Auditoria RADIUS (compara contracts ↔ radcheck/radusergroup)
sudo netx-radius-check          # só audita
sudo netx-radius-check --fix    # enfileira radius_events corretivos + remove órfãos

# Logs em tempo real
sudo journalctl -u netx-core-service -f
sudo journalctl -u netx-cwmp-server -f
sudo journalctl -u netx-web -f
sudo journalctl -u netx-api-gateway -f

# DB
sudo -u postgres psql netx_app
```

### Paths em produção

| Path | Conteúdo |
|---|---|
| `/opt/netx` | código (git clone do repo) |
| `/etc/netx/.env` | config principal (DATABASE_URL, portas, etc) |
| `/etc/netx/.secrets` | KMS_MASTER_KEY, JWT_SECRET, RADIUS_SECRET |
| `/var/log/netx/` | logs (backup, update, etc) |
| `/var/backups/netx/` | dumps diários + pre-migration snapshots |
| `/etc/systemd/system/netx-*.service` | units dos 4 apps + backup timer |
| `/etc/systemd/system/minio.service` | unit do MinIO (uploads do mobile) |
| `/var/lib/netx/minio/` | bucket files do MinIO (vai no backup) |

### Em dev

```bash
# Setup inicial
npm install
npm run db:generate         # prisma generate
npm run db:migrate:dev      # cria tabelas
npm run db:seed             # popula tenant default + roles + reasons + plans

# Rodar tudo
npm run dev                 # nx run-many -t dev (4 apps em paralelo)

# Ou individual
npm run dev:api-gateway
npm run dev:core
npm run dev:web

# Build
npm run build               # nx run-many -t build

# Lint / typecheck
npm run lint
```

---

## Convenções OBRIGATÓRIAS

1. **Multi-tenant strict** — TODA query tem `where: { tenantId }`. RLS no
   Postgres está instalado (migration `20260517000000`) mas enforcement
   é app-level. Esquecer = vazamento entre tenants.

2. **Soft delete** — modelos com histórico usam `deletedAt DateTime?`. Toda
   query lista filtra `deletedAt: null`. Hard-delete só em casos específicos.

3. **DTOs em `@netx/shared`** — schemas Zod compartilhados back↔front. Não
   duplicar tipos. Pra mudança de contrato de API: edita o Zod, ambos se
   ajustam.

4. **Audit log em TODA mutação importante** — `this.audit.log({ action,
   resource, resourceId, ...})`. Nunca pula. Senhas nunca vão no audit.

5. **Senhas/credenciais criptografadas** — usar `CryptoService.encrypt()`
   (AES-256-GCM com KMS_MASTER_KEY). Campos terminam em `Enc` (ex.
   `wifiPasswordEnc`, `sshPasswordEnc`).

6. **Migrations Prisma**:
   - `ALTER TYPE ... ADD VALUE` precisa de migration **separada** (não pode
     coabitar com `CREATE TABLE` que use o valor novo — Postgres impede).
   - `CREATE TYPE` (enum novo) pode coabitar com `CREATE TABLE` que use ele.
   - Sempre `IF NOT EXISTS` em índices criados manualmente.
   - Nomeação: `YYYYMMDDhhmmss_descricao_snake_case`.

7. **typedRoutes do Next 16**: `<Link href="/foo">` exige rota literal.
   Pra rotas dinâmicas: `as Route` ou definir como string genérica.

8. **Zod superRefine** — discriminated union no Zod v3 não aceita
   `ZodEffects`. Refinements ficam APÓS o `discriminatedUnion`, não dentro
   de branches.

9. **Lockfile sincronizado** — `package-lock.json` é versionado. Cuidado
   com `npm install` sem `--package-lock-only` se não quer mudar deps.

10. **Datas em JSON** — ISO 8601 string nas DTOs (não Date). Prisma já
    serializa OK; helpers no front: `formatDateTime`, `useFormatMoney`.

11. **Permissões via RBAC** — toda rota protegida tem `@RequirePermissions('x.y')`.
    Permissions são strings tipo `contracts.write`, `plans.manage`. Definidas
    no seed e atribuídas a roles (admin/operator/viewer).

12. **Idempotência** — operações de seed, migrations corretivas, reconcilers
    devem ser idempotentes. Re-rodar não deve duplicar/quebrar.

---

## Módulos principais — visão funcional

### CRM
- `Customer` (PF/PJ), `CustomerStatus` (LEAD/PROSPECT/ACTIVE/SUSPENDED/
  INACTIVE/CHURNED). Status é **auto-recalculado** pelos contratos (ver
  `modules/contracts/customer-status.ts`).
- `Deal`, `Pipeline`, `PipelineStage`, `Activity` — funil de vendas.
- `CustomerAddress` (futuro — hoje endereço fica no contrato).

### Contracts
- `Contract`: customer + plano + auth (PPPOE/IPOE) + status (PENDING_INSTALL,
  ACTIVE, SUSPENDED, CANCELLED) + Wi-Fi (ssid + senha encrypted).
- `Plan`: catálogo de velocidades + preço. Contract denormaliza ao criar.
- `ContractInvoice`: faturas mensais (cron diário em `OverdueScanService`).
- **Default ao criar**: `PENDING_INSTALL` + PPPoE + login derivado do nome
  do cliente + senha `1234` (decisão da operação).

### Provisioning (OLT/ONT + wizard ZTP)
- `Olt`: vendor + `providerMode` (DIRECT/ORCHESTRATOR/EXTERNAL).
- `Ont`: vinculada ao Contract, snGpon, MAC, posição PON, `wifiBandMode`
  (BAND_STEERING pra EG8145X6/X10; DUAL_BAND pra V5).
- `Tr069Device` + `Tr069Task` (SET_PARAMS, REBOOT, GET_PARAMS…).
- Driver pattern: `NoOpOltDriver` (EXTERNAL, hoje o padrão), `MockOltDriver`,
  `UfinetOrchestratorDriver` (stub, aguarda doc), `HuaweiSshDriver` (stub).
- `ProvisioningService.installCustomer()`: orquestra OLT authorize → Ont
  row → Tr069Task SET_PARAMS (Wi-Fi + PPPoE + VLAN + IPv6) → RADIUS sync.

### TR-069 ACS (apps/cwmp-server)
- Servidor SOAP/XML standalone na porta **7547**.
- `cwmp-soap.ts`: parser + builder de envelope SOAP CWMP.
- `cwmp-rpc.ts`: dispatcher de `Tr069Task` → XML RPC.
- `cwmp-session.service.ts`: state machine Inform → Response → RPCs.
- Data model focado em **Huawei EG8145V5/X10** — paths em
  `tr069-paths.huawei.ts`. Outros modelos exigiriam tabela própria.
- **WAN 2 = internet (PPPoE)**. WAN 1 = management (TR-069 mgmt VLAN).
  Pra mudar: env `HUAWEI_PPPOE_WAN_INDEX`.
- Sem auth no protocolo CWMP hoje (firewall confia em quem chega na 7547).
  TODO: HTTP Digest per-device.

### RADIUS (no core-service)
- Schema `radius` no mesmo DB (`radius.radcheck`, `radusergroup`, `radreply`).
- Tabela `radius_events` (schema public) é a fila — `radius-sync` escreve,
  `radius-applier` (cron 30s) consome.
- Pools: `ativos`, `bloqueados`, `cancelados`. Grupo `ativos` no
  `radgroupreply` entrega `Framed-Pool=ativos`, `Framed-IPv6-Pool=ipv6-wan`,
  `Delegated-IPv6-Prefix-Pool=ipv6-pd`, `Acct-Interim-Interval=300`.
- **Identificador**: PPPoE → `pppoeUsername`; IPoE → `circuitId ?? macAddress`.
- **Rate-limit**: `radius-applier.setRateLimit()` insere `Mikrotik-Rate-Limit`
  no `radreply` no AUTHORIZE — `{upload}M/{download}M` (rx/tx).
- `radius-reconciler` (cron 5min): self-healing — detecta drift (contratos
  ACTIVE sem radcheck, identificadores órfãos) e corrige.

### Stock (Fase 1 + 2)
- `Product` (PATRIMONIAL/CONSUMIVEL), `Supplier`, `StockLocation` com ACL
  por user, `StockLevel`, `SerialItem` (rastreio individual), `StockMovement`
  (kardex).
- Fase 2: **Comodato** (PATRIMONIAL vinculado a contrato) e **Consumo em OS**.
- Custo médio ponderado recalculado em `Purchase.create()`.
- Trava operacional: OS de **instalação não fecha sem comodato** vinculado
  (`ServiceOrderReason.isInstallation = true` + `ComodatoService.assertAllocatedToContract`).

### Service Orders
- Tipos via `ServiceOrderReason`. Motivos padrão seedados: Instalação
  (isInstallation=true), Suporte técnico, Manutenção, Mudança de endereço.
- Status: OPEN/SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED + OVERDUE derivado.
- Permite consumir material (`OsConsumptionService`).

### Finance
- Cobranças, caixas (cash registers), métodos de pagamento, descontos
  (perm `finance.discount.apply`).
- SIFEN (PY) — fatura eletrônica, módulo opcional.

### Backups
- Cron systemd (`netx-backup.timer`, diário ~03:17) → pg_dump + tar de
  `/var/lib/netx` + opcional rclone pra off-host.
- `safe-migrate.sh` faz snapshot pré-migration antes de `prisma migrate deploy`.
- Retenção local 30 dias (configurável).

### Mobile (`apps/mobile`) — app do técnico de campo
- Expo SDK 52 + React Native 0.76 + expo-router 4 (file-based).
- **Offline-first** com WatermelonDB (SQLite via JSI). Outbox pattern pra
  mutations + sync engine no backend (Fase 1+).
- Auth: mesmo `/v1/auth/login` da web. Tokens em `expo-secure-store`
  (keychain/keystore). Refresh automático em 401 via `lib/api.ts`.
- Device pairing: `POST /v1/mobile/devices/pair` (idempotente) — chamado
  após login. `MobileDevice` no schema permite admin revogar device perdido
  sem invalidar a sessão web do mesmo user.
- Storage de fotos: MinIO self-hosted em `127.0.0.1:9000` (bucket
  `netx-photos`), exposto via nginx em `/minio/*`. Mobile faz upload via
  presigned URL — bytes não passam pelo core-service.
- Dev: `cd apps/mobile && npm run dev` → Expo DevTools. App roda em
  Expo Go (debug rápido) ou dev client (acesso a libs nativas como
  WatermelonDB JSI, expo-secure-store).
- Build: `npm run build:android:preview` (APK interno via EAS).
- **Roadmap**: Fase 0 ✅ (auth + scaffolding), Fase 1 (OS + fotos + GPS),
  Fase 2 (estoque pessoal), Fase 3 (provisioning ZTP), Fase 4 (push + polish).

---

## Auto-status do Customer (regra crítica)

Em `modules/contracts/customer-status.ts`:

| Situação dos contratos | Customer status |
|---|---|
| Sem contrato | **PROSPECT** |
| Algum `PENDING_INSTALL` | **INACTIVE** |
| Algum `ACTIVE` | **ACTIVE** |
| Algum `SUSPENDED` (sem ACTIVE) | **SUSPENDED** |
| Todos `CANCELLED` | **CHURNED** |

Hierarquia: **ACTIVE > SUSPENDED > INACTIVE > CHURNED > PROSPECT**.

Chamado dentro de TX em: `Contracts.create/applySuspend/applyReactivate/
cancel/applyTrustExtend` + `Provisioning.installCustomer`. Backfill SQL em
`20260522040000_customer_status_backfill`.

---

## ZTP PPPoE — fluxo completo

```
1. Vendedor cria contrato → nasce PENDING_INSTALL + PPPoE (login do nome + senha 1234)
                            customer vira INACTIVE
        ↓
2. Técnico abre /provisioning/install/<id> → escolhe OLT (modo EXTERNAL),
   digita SN GPON da ONT, escolhe modelo (BAND_STEERING ou DUAL_BAND),
   SSID + senha Wi-Fi + VLAN 1010
        ↓
3. NetX backend, em UMA tx:
   - NoOpOltDriver.authorize → cria Ont row + wifiBandMode salvo
   - Contract.status = ACTIVE, salva SSID/wifiPasswordEnc + planId+banda
   - radius.enqueueSync (AUTHORIZE) → applier vai escrever em ≤30s:
       radcheck.Cleartext-Password = <senha PPPoE>
       radusergroup.groupname = "ativos"
       radreply.Mikrotik-Rate-Limit = "<up>M/<down>M"
   - Tr069Task SET_PARAMS enfileirada:
       SSID 2.4 + 5G (5G- prefix se DUAL_BAND), pwd Wi-Fi
       WANPPPConnection.Username/Password (WAN2)
       X_HW_VLAN = 1010, X_HW_IPv6Enable = 1
       PeriodicInformInterval = 60
   - customer vira ACTIVE
        ↓
4. ONT (já com TR-069 preset apontando pro nosso ACS) faz próximo Periodic
   Inform (≤60s) → cwmp-server entrega o SET_PARAMS → ONT aplica
        ↓
5. ONT disca PPPoE (WAN2) → Mikrotik → FreeRADIUS local autoriza →
   Mikrotik cria queue dinâmica com Mikrotik-Rate-Limit
   IPv6: Framed-IPv6-Pool + Delegated-IPv6-Prefix-Pool entregam /64 + /56
        ↓
6. Cliente online, dual-stack, Wi-Fi configurado, queue ativa.
   O.S. de instalação aguarda fechamento (precisa de comodato vinculado).
```

---

## Pegadinhas conhecidas (debugging recipes)

### "500 ao cancelar contrato"
Causa típica: `enqueueSync` chamado dentro de TX pra contrato IPoE sem
identificador (MAC/circuit-id). Solução: já está aplicada — RADIUS calls
ficam **fora da TX** com try/catch defensivo. Reconciler corrige drift em
≤5min se algo falhar.

### "Cliente aparece como LEAD em vez de PROSPECT"
Default antigo do schema era LEAD. Backfill `20260522040000` resolve. Se
ainda aparecer LEAD, rode `npm run db:seed` (idempotente).

### "Tooltip not in TooltipProvider"
`SimpleTooltip` já se auto-prove. Se aparecer em `<Tooltip>` raw, envolver
o trecho em `<TooltipProvider>`.

### "Modal sem scroll / trava o uso"
Já corrigido — `components/ui/Modal.tsx` tem `max-h-[calc(100dvh-2rem)]`
+ `overflow-y-auto` no body. Header/footer fixos, body rola.

### "RADIUS não enviou banda"
`radius-applier.setRateLimit` insere `Mikrotik-Rate-Limit` no `radreply`
do AUTHORIZE. Se cliente novo sem rate-limit:
```sql
SELECT * FROM radius.radreply WHERE attribute = 'Mikrotik-Rate-Limit';
```
Se vazio: aplicar manual via re-enqueue ou rodar `sudo netx-radius-check --fix`.

### "Build TS falha com tipo desconhecido"
Prisma generate provavelmente desatualizado. Rodar:
```bash
sudo -u netx -H bash -lc 'cd /opt/netx && npm run -w apps/core-service db:generate'
```

### "ONT não envia Inform pro ACS"
- Confere ACS URL na ONT: `http://<ip-vps>:7547/cwmp`.
- Confere firewall: `sudo ufw status | grep 7547`.
- `sudo tcpdump -i any -n port 7547` pra ver se chega SYN.
- ONT precisa de WAN management separada (preset da Ufinet) — não pode
  depender de PPPoE pra falar TR-069 (ovo-galinha).

### "Migration falha com ALTER TYPE em transaction"
Separar `ALTER TYPE ... ADD VALUE` em migration própria (sem outras DDLs).
Ex.: `20260520200000_contract_status_pending_install`.

### "Operador não vê menu novo"
Permissões mudaram → seed precisa rodar pra atualizar role. `npm run db:seed`
(idempotente). Se ainda não aparecer: `User.menuAccess` pode estar
filtrando — null = todos, lista = whitelist.

---

## Comandos SQL úteis

```sql
-- Estado de contratos por status
SELECT status, count(*) FROM contracts WHERE deleted_at IS NULL GROUP BY status;

-- Drift RADIUS (contratos ACTIVE sem radcheck)
SELECT c.id, c.code, coalesce(c.pppoe_username, c.circuit_id, c.mac_address) AS ident
  FROM contracts c
 WHERE c.status='ACTIVE' AND c.deleted_at IS NULL
   AND coalesce(c.pppoe_username, c.circuit_id, c.mac_address) NOT IN (
     SELECT username FROM radius.radcheck WHERE attribute IN ('Cleartext-Password','Auth-Type')
   );

-- Identificadores órfãos em radcheck (vazamento)
SELECT username FROM radius.radcheck
 WHERE attribute IN ('Cleartext-Password','Auth-Type')
   AND username NOT IN (
     SELECT coalesce(pppoe_username, circuit_id, mac_address) FROM contracts
      WHERE deleted_at IS NULL AND coalesce(pppoe_username, circuit_id, mac_address) IS NOT NULL
   );

-- Tasks TR-069 PENDING há mais de 1 hora (CPE não fez Inform)
SELECT id, action, contract_id, created_at FROM tr069_tasks
 WHERE status='PENDING' AND created_at < NOW() - INTERVAL '1 hour';

-- Migrations aplicadas
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 15;
```

---

## Estado pendente / decisões abertas

- **Task #29** (bloqueante): aguardando doc API Ufinet pra implementar
  `UfinetOrchestratorDriver`. Hoje OLTs estão em modo `EXTERNAL` (NetX
  registra ONT sem chamar OLT real — admin provisiona via web da Ufinet).
- **Driver BR** (Parks/Fiberhome/Nokia): planejado quando expandir pra BR.
  Modo EXTERNAL cobre por enquanto.
- **TR-069 auth**: hoje sem auth no protocolo. TODO HTTP Digest per-device.
- **Connection Request reverso**: implementado conceitualmente mas não
  ativo (CGNAT da Ufinet impede ACS → CPE). Mantemos confiando no
  Periodic Inform (60s).
- **Mikrotik IPv6 pools**: o RADIUS retorna `ipv6-wan` e `ipv6-pd` como
  nomes — o **admin precisa criar esses pools no Mikrotik** com prefixos
  reais. NetX não gerencia IPAM IPv6.
- **Multi-OLT por tenant**: schema suporta, UI lista, sem trabalho
  específico extra previsto.

---

## Como adicionar uma feature nova (template)

1. **Pensa multi-tenant primeiro** — todo modelo novo tem `tenantId`.
2. **Schema Prisma**: edita `apps/core-service/prisma/schema.prisma`.
3. **Migration**: `prisma migrate dev --name <descricao_snake>` (dev) OU
   cria pasta `prisma/migrations/YYYYMMDDhhmmss_descricao/migration.sql`
   manualmente (prod tem que rodar SQL bruto).
4. **DTOs em `@netx/shared`**: cria `packages/shared/src/<area>/<feature>.dto.ts`
   com schemas Zod (Request + Response). Exporta no `index.ts` da área.
5. **Service no core-service**: `apps/core-service/src/modules/<area>/
   <feature>.service.ts`. Sempre `tenantId` no `where`. Chama `audit.log`
   em mutações.
6. **Controller**: `@Controller('feature')` + `@RequirePermissions('x.y')` +
   `@ZodBody(MySchema)` ou `@ZodValidationPipe`.
7. **Registra no Module** (`controllers` + `providers`). Se o módulo é novo,
   importa em `app.module.ts`.
8. **Permissão no seed**: `prisma/seed.ts` — adiciona em `<area>Permissions`
   + atribui aos roles (admin/operator/viewer).
9. **Frontend lib**: `apps/web/src/lib/<feature>-api.ts` — cliente tipado.
   Mantém types locais (não importa de `@netx/shared` direto, exceto
   quando função utilitária pura).
10. **Páginas**: `apps/web/src/app/(protected)/<feature>/page.tsx`.
11. **Menu**: `apps/web/src/lib/menus.ts` — adiciona item + permissão.
    i18n key em pt-BR/es-PY/en-US.
12. **Testar local**: `npm run dev` + browser.
13. **Deploy**: commit → `sudo netx-update` na VPS. Migration roda, seed
    roda, build, restart.

---

## Comandos perigosos — não rode sem confirmação explícita do user

- `npm run db:reset` — derruba o banco. Protegido por `safe-reset.sh`
  (exige 3 confirmações em produção).
- `prisma migrate reset` — idem.
- `git push --force` em main/master.
- Apagar arquivos em `/etc/netx/` ou `/var/backups/netx/`.

---

## Persona / preferências do owner

- **Charles** — owner/dev. Fala **português pt-BR**. Pode pular pra es-PY
  ocasionalmente (operação PY).
- Prefere **respostas diretas e técnicas**. Sem hedge desnecessário.
  "Sincero, frio, calculista, focado em qualidade".
- Aceita opinião forte com justificativa. Diz "sem heresia, vira o sistema
  e pau na máquina" quando quer execução.
- Faz perguntas de **arquitetura** com frequência — vale dimensionar
  trade-offs antes de codar.
- Cuida da **arquitetura de rede** (VLANs, IPv6 pools, Mikrotik) do lado
  dele. NetX é o software-as-orchestrator.

---

## Quando você (IA) for assumir

1. Lê este doc inteiro.
2. Checa `git log --oneline -20` pra ver commits recentes (contexto fresco).
3. Checa `TaskList` se existir — tasks abertas indicam o que estava
   sendo trabalhado.
4. Pra alterações grandes, **explica o plano antes** e pede confirmação.
5. Pra alterações pequenas (bugfix óbvio, typo, etc), pode ir direto.
6. **Sempre** rode `sudo netx-update` mental check antes de declarar
   "feito" — features só estão deployadas em prod depois disso.
7. Os bugs do passado (timeout RADIUS, 500 no cancel, sync de MAC) **eram
   IPoE**. PPPoE remove essas arestas. Manter PPPoE como padrão.
8. O modo EXTERNAL é o que **funciona em produção hoje**. UfinetDriver
   é stub. Não tente "ativar" o Ufinet sem doc da task #29.

---

*EOF — bom trabalho. 🚀*
