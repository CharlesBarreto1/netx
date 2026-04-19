# Provisionamento — Debian 12 (Bookworm) para NetX

Guia passo a passo **de uma instalação limpa de Debian 12 até o NetX rodando em produção** com HTTPS, firewall, backups e restart automático.

> Pressupostos: você tem acesso `root` (via console do provedor ou senha inicial via SSH) e um IP público. Os exemplos usam `vps.netx.exemplo.com` como domínio — substitua pelo seu.

---

## 0. Antes de começar

Pré-requisitos no seu provedor:

- VPS Debian 12 limpa (mínimo 2 vCPU / 4 GB RAM / 40 GB SSD para dev/staging; 4 vCPU / 8 GB / 80 GB para produção).
- Um domínio apontado (registro **A**) para o IP da VPS — ex.: `vps.netx.exemplo.com`.
- Sua chave pública SSH (`~/.ssh/id_ed25519.pub` no seu computador). Se não tem, gere com `ssh-keygen -t ed25519 -C "seu-email"`.

---

## 1. Primeiro login e atualização do sistema

```bash
ssh root@IP_DA_VPS

# Atualiza tudo
apt update && apt upgrade -y

# Utilitários básicos
apt install -y curl wget git vim htop ufw fail2ban ca-certificates gnupg \
               lsb-release software-properties-common unattended-upgrades \
               apt-transport-https sudo rsync cron

# Timezone e locale
timedatectl set-timezone America/Sao_Paulo
dpkg-reconfigure locales   # marque en_US.UTF-8 e pt_BR.UTF-8; default pt_BR.UTF-8
```

Ative atualizações de segurança automáticas:

```bash
dpkg-reconfigure -plow unattended-upgrades   # responda Yes
```

---

## 2. Criar usuário não-root com sudo

Nunca rode aplicação como `root`.

```bash
adduser netx                # crie uma senha forte
usermod -aG sudo netx

# Libere sua chave SSH no novo usuário
mkdir -p /home/netx/.ssh
# cole sua chave pública (conteúdo do id_ed25519.pub) aqui:
nano /home/netx/.ssh/authorized_keys
chmod 700 /home/netx/.ssh
chmod 600 /home/netx/.ssh/authorized_keys
chown -R netx:netx /home/netx/.ssh
```

Teste em outra aba antes de fechar a sessão root:

```bash
ssh netx@IP_DA_VPS
```

---

## 3. Endurecer o SSH

Edite `/etc/ssh/sshd_config`:

```bash
sudo nano /etc/ssh/sshd_config
```

Garanta/edite estas linhas:

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers netx
```

Opcional: mudar a porta SSH para uma não-padrão (ex.: `Port 2222`) reduz ruído de bots. Se mudar, abra a nova porta no firewall antes de aplicar.

Recarregue:

```bash
sudo systemctl restart ssh
```

---

## 4. Firewall (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp        # SSH (ou a porta que você escolheu)
sudo ufw allow 80/tcp        # HTTP (Let's Encrypt + redirect)
sudo ufw allow 443/tcp       # HTTPS
sudo ufw enable
sudo ufw status verbose
```

**Não** abra diretamente 3000/3101/3200/5432/6379/5672 — o Nginx será o único ponto de entrada público.

---

## 5. Fail2ban

Protege SSH contra força bruta.

```bash
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo sed -i 's/^bantime.*=.*/bantime = 1h/' /etc/fail2ban/jail.local
sudo sed -i 's/^maxretry.*=.*/maxretry = 5/' /etc/fail2ban/jail.local
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

---

## 6. Instalar Docker Engine + Compose v2 (repositório oficial)

O `docker.io` dos repositórios do Debian é antigo — use o repositório oficial:

```bash
# Chave GPG oficial
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Repositório
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Instalar
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Rodar docker sem sudo
sudo usermod -aG docker netx
newgrp docker    # aplica o grupo na sessão atual
docker --version
docker compose version
```

---

## 7. Instalar Node.js 20 (NodeSource) e build tools

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3
node --version    # v20.x
npm --version
```

Opcional — se quiser gerenciar múltiplas versões com `nvm` no mesmo usuário:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20.15.0
nvm use 20.15.0
```

---

## 8. Nginx + Certbot (TLS via Let's Encrypt)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# Remove default site
sudo rm /etc/nginx/sites-enabled/default
```

Crie a config do NetX em `/etc/nginx/sites-available/netx`:

```bash
sudo nano /etc/nginx/sites-available/netx
```

Cole:

```nginx
# HTTP -> HTTPS (Certbot vai adicionar TLS depois)
server {
    listen 80;
    listen [::]:80;
    server_name vps.netx.exemplo.com;

    # Web (Next.js)
    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API Gateway
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Aumentar timeouts se houver endpoints longos
        proxy_connect_timeout 60s;
        proxy_send_timeout    60s;
        proxy_read_timeout    60s;

        client_max_body_size 25m;
    }

    # Bloqueie acesso direto a /docs em produção
    location /docs {
        return 404;
    }
}
```

Ative:

```bash
sudo ln -s /etc/nginx/sites-available/netx /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Emita o certificado (precisa do DNS já apontando para a VPS):

```bash
sudo certbot --nginx -d vps.netx.exemplo.com --agree-tos -m seu-email@exemplo.com --redirect
```

Renovação automática já vem configurada via `systemd timer`:

```bash
sudo systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

---

## 9. Deploy do código NetX

Como usuário `netx`:

```bash
su - netx
mkdir -p ~/apps && cd ~/apps

# Clone do seu repositório (ou use rsync/scp se for privado)
git clone git@seu-git:netx.git netx
cd netx

# Instale dependências
npm install
```

### 9.1 Configurar `.env` de produção

```bash
cp .env.example .env
nano .env
```

Ajustes mínimos para produção:

```bash
NODE_ENV=production
LOG_LEVEL=info

# Postgres: use credencial FORTE, não a default do exemplo
DATABASE_URL=postgresql://netx:SENHA_FORTE@localhost:5432/netx?schema=public

# Redis / RabbitMQ
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://netx:SENHA_FORTE@localhost:5672/

# Segredos JWT — GERE novos com `openssl rand -base64 48`
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...

# Argon2
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1

# Tenancy
TENANT_RESOLUTION_STRATEGY=jwt   # ou subdomain

# CORS
CORS_ORIGINS=https://vps.netx.exemplo.com
```

Gere segredos fortes:

```bash
openssl rand -base64 48   # rode 2x, cole em JWT_ACCESS_SECRET e JWT_REFRESH_SECRET
```

### 9.2 Subir infraestrutura (Postgres, Redis, RabbitMQ)

```bash
npm run infra:up           # docker compose up -d
docker ps                  # confira que está tudo Up
```

Em produção **não exponha** as portas do Postgres/Redis/RabbitMQ para o host — edite `infra/docker/docker-compose.yml` e comente as linhas `ports:` desses serviços (eles seguem acessíveis pela rede interna do Compose). A app conecta via `localhost` pelo Node no host; se for rodar a app também em container, use rede Docker e hostnames (`postgres`, `redis`, `rabbitmq`).

### 9.3 Migrar + seed

```bash
npm run db:generate
npm run db:migrate
npm run db:seed            # cria tenant default + admin@netx.local
```

**Troque imediatamente** a senha do admin ao primeiro login.

### 9.4 Build de produção

```bash
npm run build
```

---

## 10. Rodar como serviço (systemd + PM2)

Use **PM2** para gerenciar os 3 processos Node (api-gateway, core-service, web) e systemd para garantir que o PM2 sobe no boot.

```bash
sudo npm install -g pm2
```

Crie `~/apps/netx/ecosystem.config.js`:

```bash
nano ~/apps/netx/ecosystem.config.js
```

```js
module.exports = {
  apps: [
    {
      name: 'netx-core',
      cwd: '/home/netx/apps/netx/apps/core-service',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1G',
    },
    {
      name: 'netx-gateway',
      cwd: '/home/netx/apps/netx/apps/api-gateway',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
    },
    {
      name: 'netx-web',
      cwd: '/home/netx/apps/netx/apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3200',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
    },
  ],
};
```

Suba e persista:

```bash
cd ~/apps/netx
pm2 start ecosystem.config.js
pm2 save
pm2 status
pm2 logs --lines 50

# Configurar para iniciar no boot (via systemd)
pm2 startup systemd -u netx --hp /home/netx
# o comando acima vai imprimir uma linha `sudo env PATH=... pm2 startup...` — execute-a.
```

Teste um reboot:

```bash
sudo reboot
# após voltar:
ssh netx@IP
pm2 status    # todos devem estar 'online'
```

---

## 11. Backups

### 11.1 Postgres diário

Crie `/home/netx/bin/backup-postgres.sh`:

```bash
mkdir -p ~/bin ~/backups
nano ~/bin/backup-postgres.sh
```

```bash
#!/usr/bin/env bash
set -euo pipefail
DATE=$(date +%F-%H%M)
BACKUP_DIR="/home/netx/backups"
FILE="$BACKUP_DIR/netx-$DATE.sql.gz"

docker exec -t $(docker ps -qf "name=postgres") \
  pg_dump -U netx -d netx | gzip > "$FILE"

# Retenção: mantém últimos 14 dias
find "$BACKUP_DIR" -name 'netx-*.sql.gz' -mtime +14 -delete

echo "Backup OK: $FILE"
```

```bash
chmod +x ~/bin/backup-postgres.sh

# Agende diariamente às 03:15
crontab -e
```

Adicione:

```
15 3 * * * /home/netx/bin/backup-postgres.sh >> /home/netx/backups/cron.log 2>&1
```

**Recomendado:** replicar `~/backups` para armazenamento externo (S3, Backblaze B2, rsync.net) com `restic` ou `rclone`. Backup que vive só na mesma máquina não é backup.

### 11.2 Volumes Docker (opcional)

`docker volume ls` → para os volumes críticos (Postgres), agende `restic backup` do diretório `/var/lib/docker/volumes/<volume>/_data` ou prefira o dump lógico acima (mais portátil).

---

## 12. Monitoramento leve

Para produção pequena, comece com:

```bash
# CPU/RAM/Disco em tempo real
htop
df -h
docker stats

# Status do NetX
pm2 monit
```

Quando crescer, adicione Uptime Kuma (em container) para endpoints HTTP e Netdata (`curl https://my-netdata.io/kickstart.sh | sh`) para métricas do host. Logs da app estão em `pm2 logs` e em `~/.pm2/logs/`.

---

## 13. Checklist de segurança pós-deploy

- [ ] `root` sem login SSH (testar: `ssh root@IP` deve falhar)
- [ ] `PasswordAuthentication no` ativo
- [ ] UFW habilitado, só 22/80/443 abertas
- [ ] Fail2ban ativo (`fail2ban-client status sshd`)
- [ ] HTTPS válido (`curl -I https://seu-dominio` → `200 OK`, sem warning TLS)
- [ ] Senha do admin NetX trocada (não usar `ChangeMe!2026` em prod)
- [ ] Secrets JWT gerados via `openssl rand`, **não** copiados do `.env.example`
- [ ] Portas 5432/6379/5672 **não** expostas publicamente (`sudo ss -tlnp | grep LISTEN`)
- [ ] `/docs` (Swagger) bloqueado no Nginx em prod
- [ ] Backups rodando e **testados** (restaurar em staging mensalmente)
- [ ] `unattended-upgrades` ativo
- [ ] Monitoramento básico no lugar (uptime + alerta por email/Telegram)

---

## 14. Atualizações do NetX (deploy contínuo)

Fluxo manual simples para começar:

```bash
ssh netx@IP
cd ~/apps/netx

git pull
npm install
npm run db:migrate     # se houver migrations novas
npm run build
pm2 reload all         # zero-downtime
pm2 logs --lines 50    # verifique se subiu limpo
```

Depois evolua para GitHub Actions com SSH + `pm2 reload` automático, ou para imagem Docker + `docker compose pull && up -d`.

---

## 15. Problemas comuns

**`docker: permission denied`** — adicione o usuário ao grupo `docker` e faça logout/login (ou `newgrp docker`).

**`EADDRINUSE: :::3000`** — outro processo segura a porta; `sudo ss -tlnp | grep 3000` e mate o PID, ou ajuste `API_GATEWAY_PORT` no `.env`.

**`Prisma: Can't reach database`** — cheque `DATABASE_URL`, confirme que o container Postgres está Up, verifique firewall interno do container (`docker compose logs postgres`).

**Certbot falha na validação** — confirme que o DNS **A** aponta para o IP da VPS (`dig +short vps.netx.exemplo.com`) e que a porta 80 está aberta no UFW.

**PM2 não sobe após reboot** — rode novamente `pm2 startup systemd -u netx --hp /home/netx` e o `sudo env PATH=...` que ele imprimir.

---

Pronto. Nesta sequência, sai de Debian 12 limpa para NetX em HTTPS, com firewall, TLS, processos supervisionados e backups diários.
