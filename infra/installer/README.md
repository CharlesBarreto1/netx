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
curl -fsSL https://raw.githubusercontent.com/charlesbarreto/netx/main/infra/installer/install.sh \
  | sudo bash
```

O wizard pergunta:

1. **Domínio** — onde o NetX vai responder (deixe vazio pra usar IP)
2. **E-mail do admin**
3. **Senha do admin** — gerada aleatória ou definida por você
4. **Nome do tenant inicial**
5. **País** — PY / BR / AR / outro

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
| PostgreSQL | 16 | repo PGDG |
| Redis | sistema | apt |
| RabbitMQ | sistema | apt + management plugin |
| FreeRADIUS | 3.x | apt + módulo postgresql + clients via SQL |
| Node.js | 20 LTS | NodeSource |
| Nginx | sistema | reverse proxy 80 → web/:3200 + /api → api-gateway/:3000 |
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

```bash
sudo NETX_FORCE=1 \
     NETX_REPO_BRANCH=main \
  bash /opt/netx/infra/installer/install.sh
```

Isso faz `git fetch + reset --hard`, re-builda, aplica novas migrações Prisma e reinicia os serviços. Os segredos são preservados.

## Variáveis de ambiente

| Variável | Default | Descrição |
|---|---|---|
| `NETX_REPO_URL` | github.com/charlesbarreto/netx | URL do repo |
| `NETX_REPO_BRANCH` | `main` | branch a clonar |
| `NETX_DOMAIN` | _(vazio = IP)_ | server_name no nginx |
| `NETX_ADMIN_EMAIL` | _(prompt)_ | login do admin |
| `NETX_ADMIN_PASSWORD` | _(gerada)_ | senha do admin |
| `NETX_TENANT_NAME` | "NetX Default" | nome do tenant inicial |
| `NETX_TENANT_COUNTRY` | `PY` | PY/BR/AR |
| `NETX_SKIP_WIZARD` | `0` | `1` = pula prompts |
| `NETX_FORCE` | `0` | `1` = re-roda tudo |

Portas (raramente precisa mexer):

| Variável | Default |
|---|---|
| `NETX_PORT_API_GATEWAY` | 3000 |
| `NETX_PORT_CORE_SERVICE` | 3101 |
| `NETX_PORT_WEB` | 3200 |

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
├── uninstall.sh
├── lib/
│   ├── common.sh               # logging, helpers, state, secrets
│   ├── preflight.sh            # checks de root/OS/disco/rede
│   ├── packages.sh             # apt + repos PGDG/NodeSource
│   ├── postgres.sh             # role + DB + search_path + radius schema
│   ├── redis.sh
│   ├── rabbitmq.sh             # vhost + user + management plugin
│   ├── freeradius.sh           # mods sql + sites default
│   ├── netx_app.sh             # clone + npm ci + build + prisma + seed
│   ├── systemd.sh              # 3 unidades + enable + wait
│   ├── nginx.sh                # site + reload
│   ├── wizard.sh               # whiptail prompts
│   └── smoke.sh                # checks finais
├── templates/
│   ├── env.tmpl
│   ├── freeradius-sql.tmpl
│   ├── nginx-netx.tmpl
│   └── systemd/
│       ├── netx-core-service.service
│       ├── netx-api-gateway.service
│       └── netx-web.service
└── scripts/
    └── seed-admin.ts            # bootstrapa tenant + admin
```

Cada lib expõe **uma função pública** com o nome do componente (`postgres_setup`, `redis_setup`, etc), chamada pelo `install.sh` via `step <id> <fn>`. O wrapper `step()` em `common.sh` cuida de marker de idempotência e timing.
