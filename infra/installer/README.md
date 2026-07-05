# NetX Installer

Instalador idempotente do NetX em **Debian 13 (Trixie)**.

Em uma máquina limpa (VM, VPS ou bare metal), em ~10 minutos você sai de `apt update` até NetX rodando em `http://servidor/`.

## Pré-requisitos

- Debian 13 (Trixie) ou Debian 12 (Bookworm) fresh, instalação mínima
- 4 GB RAM (mínimo 2)
- 5 GB de disco livre
- Acesso root (sudo)
- Internet (acessa GitHub, deb.debian.org, deb.nodesource.com, apt.postgresql.org)

## Instalação rápida

```bash
curl -fsSL https://raw.githubusercontent.com/CharlesBarreto1/netx/main/infra/installer/install.sh \
  | sudo bash
```

O wizard pergunta:

1. **Domínio** — onde o NetX vai responder (deixe vazio pra usar IP)
2. **E-mail do admin**
3. **Senha do admin** — gerada aleatória ou definida por você
4. **Nome da empresa (ISP)** — esta instância atende **uma única empresa**
5. **País** — PY / BR / AR / outro

> **Sobre "tenant"**: o NetX foi pensado pra ser instalado **um por ISP**, em VPS própria do provedor (motivos: latência RADIUS, soberania de dados, blast radius). Internamente, cada instalação tem 1 `Tenant` que representa a empresa inteira. Não é um SaaS multi-tenant compartilhado. Veja `docs/architecture/tenancy.md` no repo pra detalhes.

No fim, mostra a URL e a senha do admin.

## Modo unattended (CI / Ansible / Terraform)

```bash
sudo NETX_SKIP_WIZARD=1 \
     NETX_DOMAIN=netx.minhaisp.com \
     NETX_ADMIN_EMAIL=admin@minhaisp.com \
     NETX_ADMIN_PASSWORD='SenhaForte123!' \
     NETX_TENANT_NAME='Minha ISP' \
     NETX_TENANT_COUNTRY=PY \
  bash install.sh
```

## O que é instalado

| Componente | Versão | Como |
|---|---|---|
| PostgreSQL | 16 | repo PGDG + extensões (pgcrypto, citext, **PostGIS** — requerida pelo FiberMap) |
| Redis | sistema | apt |
| RabbitMQ | sistema | apt + management plugin |
| FreeRADIUS | 3.x | apt + módulo postgresql + clients via SQL + site coa (:3799) |
| Node.js | 24 LTS | NodeSource |
| Nginx | sistema | reverse proxy 80 → web/:3200 + /api → api-gateway/:3000 + /minio → :9000 |
| MinIO | latest (binário) | object storage (fotos mobile/anexos) em `127.0.0.1:9000`, dados em `/var/lib/netx/minio` |
| WAHA | latest (Docker) | Canal QR do WhatsApp (engine NOWEB) em `localhost:3010`, sessões em `/var/lib/netx/waha` |
| Traccar | 6.x | rastreamento GPS da Frota em `127.0.0.1:8082` (opt-out: `NETX_ENABLE_TRACCAR=0`) |
| NMS | Docker (ecossistema) | API em `127.0.0.1:3300` via `apps/nms/infra/up-netx.sh` (pule com `NETX_NMS_SKIP=1`) |
| chrony | sistema | NTP local pros equipamentos (allowlist via `network_equipment`) |
| ffmpeg | sistema | conversão de mídia do chat WhatsApp |
| NetX | branch `main` | clone + build em `/opt/netx` |

## Layout no sistema

```
/opt/netx/                    # código + build (owner: netx)
/etc/netx/.env                # variáveis (mode 640, root:netx)
/etc/netx/.secrets            # senhas geradas (mode 600, root:root)
/var/lib/netx/                # dados runtime (backups, state)
/var/log/netx/                # logs do app (journalctl é o canal principal)
/var/log/netx-install.log     # log completo do installer
```

## Serviços systemd

```bash
systemctl status netx-core-service
systemctl status netx-api-gateway
systemctl status netx-web
systemctl status netx-cwmp-server     # TR-069 ACS (:7547)
systemctl status minio                # object storage (:9000)
systemctl status traccar              # GPS da Frota (:8082, se habilitado)
systemctl status netx-backup.timer    # pg_dump diário (03:17)
systemctl status netx-infra-sync      # reconcilia UFW + chrony no boot

journalctl -u netx-core-service -f
```

## Idempotência

O installer pode rodar várias vezes — só executa o que falta. Cada etapa tem um marker em `/var/lib/netx/install-state/<step>.done`.

Pra forçar re-execução de tudo:

```bash
sudo NETX_FORCE=1 bash install.sh
```

Pra forçar re-execução de uma etapa só, apague o marker:

```bash
sudo rm /var/lib/netx/install-state/freeradius.done
sudo bash install.sh
```

## Atualizar para uma nova versão

O caminho normal é o updater dedicado (symlink criado pelo installer):

```bash
sudo netx-update
```

Faz `git fetch + reset --hard`, `npm install`, build, migrations (com snapshot
pré-migration e guard de PostGIS), seeds idempotentes, restart dos serviços,
smoke test e atualização do NMS (Docker). Não toca em `.env`, nginx, systemd
nem segredos.

Pra re-provisionar a infra toda (pacotes, units, nginx, etc):

```bash
sudo NETX_FORCE=1 \
     NETX_REPO_BRANCH=main \
  bash /opt/netx/infra/installer/install.sh
```

## Variáveis de ambiente

| Variável | Default | Descrição |
|---|---|---|
| `NETX_REPO_URL` | github.com/CharlesBarreto1/netx | URL do repo |
| `NETX_REPO_BRANCH` | `main` | branch a clonar |
| `NETX_DOMAIN` | _(vazio = IP)_ | server_name no nginx |
| `NETX_ADMIN_EMAIL` | _(prompt)_ | login do admin |
| `NETX_ADMIN_PASSWORD` | _(gerada)_ | senha do admin |
| `NETX_TENANT_NAME` | "NetX Default" | nome da empresa (ISP) — esta instância atende uma única |
| `NETX_TENANT_COUNTRY` | `PY` | PY/BR/AR |
| `NETX_SKIP_WIZARD` | `0` | `1` = pula prompts |
| `NETX_FORCE` | `0` | `1` = re-roda tudo |
| `NETX_SKIP_WHATSAPP` | `0` | `1` = não instala WAHA/Docker (canal QR off) |
| `NETX_ENABLE_TRACCAR` | `1` | `0` = sem Traccar (frota sem GPS "Ao vivo") |
| `NETX_NMS_SKIP` | `0` | `1` = não sobe o módulo NMS (Docker) |
| `NETX_HUB_URL` / `NETX_LICENSE_KEY` | _(vazio = off)_ | licenciamento via Hub (fail-open) |
| `NETX_BACKUP_REMOTE` | _(vazio)_ | remote rclone pra backup off-host |

Portas (raramente precisa mexer):

| Variável | Default |
|---|---|
| `NETX_PORT_API_GATEWAY` | 3000 |
| `NETX_PORT_CORE_SERVICE` | 3101 |
| `NETX_PORT_WEB` | 3200 (também fixa na unit `netx-web.service` — mudar exige editar a unit) |
| `NETX_PORT_CWMP` | 7547 (TR-069 standard) |

## Desinstalar

```bash
# Remove app, mantém DB e segredos
sudo bash /opt/netx/infra/installer/uninstall.sh

# Remove TUDO incluindo dados
sudo bash /opt/netx/infra/installer/uninstall.sh --purge
```

## Troubleshooting

**Algum serviço não sobe.** Pega os últimos 50 logs:

```bash
journalctl -u netx-core-service -n 50 --no-pager
```

**FreeRADIUS reclama de config.** Roda em foreground com debug:

```bash
sudo systemctl stop freeradius
sudo freeradius -X
```

**Re-aplicar schema RADIUS sem mexer em mais nada:**

```bash
sudo rm /var/lib/netx/install-state/netx_app.done
sudo NETX_FORCE=1 bash /opt/netx/infra/installer/install.sh
```

**Onde fica a senha do admin se eu esqueci.** Ela está em texto plano em `/etc/netx/.secrets` apenas se você usou o modo "auto" do wizard. Se definiu manual, não está salva — use o reset por SQL:

```bash
sudo -u netx bash -c "cd /opt/netx/apps/core-service && \
  npx ts-node /opt/netx/infra/installer/scripts/seed-admin.ts"
```

(passando `NETX_ADMIN_EMAIL` e `NETX_ADMIN_PASSWORD` no env)

## Arquitetura do installer

```
infra/installer/
├── install.sh                  # entry point + orquestração
├── uninstall.sh                # remove app (--purge remove tudo)
├── lib/
│   ├── common.sh               # logging, helpers, state, secrets
│   ├── preflight.sh            # checks de root/OS/disco/rede
│   ├── packages.sh             # apt + repos PGDG/NodeSource (inclui postgis, ffmpeg)
│   ├── postgres.sh             # role + DB + extensões (pgcrypto/citext/postgis)
│   ├── redis.sh
│   ├── rabbitmq.sh             # vhost + user + management plugin
│   ├── minio.sh                # object storage + bucket netx-photos
│   ├── freeradius.sh           # mods sql + sites default/coa
│   ├── chrony.sh               # NTP local + allowlist por equipamento
│   ├── firewall.sh             # UFW base + NAS/OLT dinâmico + sudoers + boot sync
│   ├── waha.sh                 # WhatsApp QR (Docker, :3010)
│   ├── traccar.sh              # GPS da Frota (:8082 + token de serviço)
│   ├── nms.sh                  # módulo NMS (Docker, API :3300)
│   ├── licensing.sh            # instanceId + credenciais do Hub
│   ├── netx_app.sh             # clone + npm install + build + prisma + seeds
│   ├── systemd.sh              # 4 unidades (core/gateway/web/cwmp) + wait
│   ├── nginx.sh                # site + certbot opcional
│   ├── wizard.sh               # prompts de texto via /dev/tty
│   ├── backups.sh              # timer diário de pg_dump + logrotate
│   └── smoke.sh                # checks finais
├── templates/
│   ├── env.tmpl
│   ├── freeradius-sql.tmpl
│   ├── nginx-netx.tmpl
│   └── systemd/
│       ├── netx-core-service.service
│       ├── netx-api-gateway.service
│       ├── netx-web.service
│       ├── netx-cwmp-server.service
│       └── timers/netx-backup.{service,timer}
└── scripts/
    ├── seed-admin.ts            # bootstrapa tenant + admin
    ├── netx-update.sh           # updater (symlink /usr/local/bin/netx-update)
    ├── netx-radius-check.sh     # auditoria contracts × radcheck
    ├── sync-firewall.sh         # UFW + restart FreeRADIUS (hook da UI + boot)
    ├── sync-ntp.sh              # allowlist chrony (hook da UI + boot)
    └── backup/netx-backup.sh    # pg_dump diário (ExecStart do timer)
```

Cada lib expõe **uma função pública** com o nome do componente (`postgres_setup`, `redis_setup`, etc), chamada pelo `install.sh` via `step <id> <fn>`. O wrapper `step()` em `common.sh` cuida de marker de idempotência e timing.
