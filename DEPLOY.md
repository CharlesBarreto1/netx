# Deploy do NetX Hub numa VPS (Debian)

Guia para subir o Hub (API + painel admin + central do cliente) numa VPS limpa.
São 3 peças: **Postgres**, **API** (NestJS, :4000), **Web** (Next, :4100), atrás
de **nginx**. Não há installer automático (diferente do NetX) — siga os passos.

> O painel admin e a central são servidos pelo MESMO app web. "Instalar o admin"
> = subir o Hub inteiro; o admin fica em `https://seu-dominio/admin`.

## 0. Pré-requisitos na VPS

```bash
# Node 24 (NodeSource), Postgres, nginx, git
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt install -y nodejs postgresql nginx git
```

## 1. Levar o código pra VPS

O repo é local (sem remote). Escolha **um**:

**a) Via GitHub (recomendado):** crie um repo PRIVADO e suba:
```bash
# na sua máquina, dentro de netx-hub/netx-hub
git remote add origin git@github.com:SEU_USER/netx-hub.git
git push -u origin main
# na VPS:
sudo git clone https://github.com/SEU_USER/netx-hub.git /opt/netx-hub
```

**b) Via rsync (sem GitHub):**
```bash
# na sua máquina
rsync -az --exclude node_modules --exclude .next --exclude dist \
  ~/Documents/netx-hub/netx-hub/  root@IP_DA_VPS:/opt/netx-hub/
```

## 2. Usuário + banco

```bash
sudo useradd -r -m -d /opt/netx-hub -s /usr/sbin/nologin netxhub || true
sudo chown -R netxhub:netxhub /opt/netx-hub

# Postgres: banco + usuário do Hub
sudo -u postgres psql -c "CREATE USER netxhub WITH PASSWORD 'TROQUE_ESTA_SENHA';"
sudo -u postgres psql -c "CREATE DATABASE netxhub OWNER netxhub;"
```

## 3. Segredos e .env

```bash
sudo mkdir -p /etc/netx-hub
# Gere as chaves de assinatura de licença (PROD — par novo, não o de dev):
cd /opt/netx-hub && sudo -u netxhub npm ci && sudo -u netxhub npm run keygen
#  → copie a PRIVADA pro .env abaixo (LICENSE_PRIVATE_KEY_B64)
#  → copie a PÚBLICA pro NetX: packages/shared/src/licensing/public-key.ts
#    (e rode `sudo netx-update` nos clientes pra propagar)

# Crie /etc/netx-hub/.env a partir do exemplo:
sudo cp /opt/netx-hub/.env.example /etc/netx-hub/.env
sudo nano /etc/netx-hub/.env
```

Preencha no `.env` (mínimo pra subir):
```
DATABASE_URL=postgresql://netxhub:TROQUE_ESTA_SENHA@localhost:5432/netxhub?schema=public
PORT=4000
LICENSE_PRIVATE_KEY_B64=<privada do keygen>
HUB_ADMIN_JWT_SECRET=<openssl rand -hex 24>     # login da equipe NetX
HUB_PORTAL_JWT_SECRET=<openssl rand -hex 24>    # login da central do cliente
HUB_PUBLIC_URL=https://hub.seu-dominio.com
# Backup off-site (opcional): rclone remote, ex. b2:netxhub-bkp/
HUB_BACKUP_REMOTE=
# EFI (Pix) — opcional; deixe EFI_ENABLED=false até ter as credenciais
EFI_ENABLED=false
```
```bash
sudo chown root:netxhub /etc/netx-hub/.env && sudo chmod 640 /etc/netx-hub/.env
```

## 4. Build + migrations

```bash
cd /opt/netx-hub
# API
sudo -u netxhub npm ci
sudo -u netxhub --preserve-env=DATABASE_URL bash -c 'set -a; . /etc/netx-hub/.env; set +a; npx prisma migrate deploy && npx prisma generate && npm run build'

# Web — NEXT_PUBLIC_HUB_API é EMBUTIDO no build (URL pública da API):
cd /opt/netx-hub/web
sudo -u netxhub npm ci
sudo -u netxhub NEXT_PUBLIC_HUB_API=https://hub.seu-dominio.com/v1 npm run build
```

> Se ainda não criou migrations (repo veio só com `schema.prisma`), rode UMA vez
> na sua máquina de dev com Postgres: `npm run db:migrate:dev --name init` e
> versione a pasta `prisma/migrations/`. Em produção use sempre `migrate deploy`.

## 5. systemd (API + Web)

```bash
sudo cp /opt/netx-hub/deploy/netx-hub-api.service /etc/systemd/system/
sudo cp /opt/netx-hub/deploy/netx-hub-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now netx-hub-api netx-hub-web
sudo systemctl status netx-hub-api netx-hub-web
# logs: journalctl -u netx-hub-api -f
```

## 6. nginx + HTTPS

```bash
sudo cp /opt/netx-hub/deploy/nginx.conf.example /etc/nginx/sites-available/netx-hub
sudo nano /etc/nginx/sites-available/netx-hub      # ajuste server_name
sudo ln -sf /etc/nginx/sites-available/netx-hub /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# HTTPS (Let's Encrypt):
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d hub.seu-dominio.com
```

## 7. Primeiro acesso (login da equipe)

O painel admin usa login e-mail+senha. Crie o PRIMEIRO usuário:
```bash
cd /opt/netx-hub
sudo -u netxhub bash -c 'set -a; . /etc/netx-hub/.env; set +a; \
  ADMIN_EMAIL=voce@netx.com.br ADMIN_PASSWORD="SenhaForte123" npm run create-admin'
```
- Acesse `https://hub.seu-dominio.com/` (hotsite) → "Equipe NetX" ou `/admin`.
- Entre com o e-mail/senha. Cadastre o primeiro cliente, vincule a instância,
  crie o acesso da central. Pode criar mais usuários admin pelo próprio painel.

## 8. Backup automático (Postgres)

```bash
sudo cp /opt/netx-hub/deploy/backup/netx-hub-backup.service /etc/systemd/system/
sudo cp /opt/netx-hub/deploy/backup/netx-hub-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now netx-hub-backup.timer
# Testar agora: sudo systemctl start netx-hub-backup.service ; journalctl -u netx-hub-backup
```
Dump diário (03:30) em `/var/backups/netx-hub/auto`, validado com `pg_restore
--list`, retenção `BACKUP_RETENTION_DAYS` (30). Off-site opcional: configure
`rclone` (`rclone config`) e `HUB_BACKUP_REMOTE` no `.env`.

## Atualizar versão

```bash
cd /opt/netx-hub && sudo -u netxhub git pull
sudo -u netxhub bash -c 'set -a; . /etc/netx-hub/.env; set +a; npm ci && npx prisma migrate deploy && npm run build'
cd web && sudo -u netxhub NEXT_PUBLIC_HUB_API=https://hub.seu-dominio.com/v1 npm ci && sudo -u netxhub NEXT_PUBLIC_HUB_API=https://hub.seu-dominio.com/v1 npm run build
sudo systemctl restart netx-hub-api netx-hub-web
```
