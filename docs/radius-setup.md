# Setup RADIUS (FreeRADIUS 3.x + PostgreSQL + Mikrotik)

Instalação do FreeRADIUS na mesma VPS do `netx-core`, lendo o schema `radius`
do Postgres do NetX. F1 com CoA — suspensão e reativação derrubam a sessão
PPPoE imediatamente, sem esperar a próxima reconexão.

## Pré-requisitos

- VPS Debian 12 com `netx-core` / `netx-gateway` / `netx-web` já rodando.
- Postgres local com o banco do NetX acessível via `DATABASE_URL`.
- Mikrotik(s) em rede alcançável a partir da VPS (porta 1812/udp + 1813/udp
  saindo; 3799/udp entrando da VPS pro Mikrotik).

## 1. Aplicar o schema `radius`

```bash
cd /home/netx/apps/netx
psql "$DATABASE_URL" -f apps/core-service/prisma/radius-schema.sql
```

Esperado no final:

```
NOTICE:  radius schema pronto. Grupos: ativos, bloqueados, cancelados
```

## 2. Instalar FreeRADIUS + utilitários

```bash
sudo apt update
sudo apt install -y freeradius freeradius-postgresql freeradius-utils

# O serviço vem habilitado; pare enquanto configura
sudo systemctl stop freeradius
```

## 3. Configurar o módulo SQL

Edite `/etc/freeradius/3.0/mods-available/sql`. Alvos-chave:

```conf
sql {
    driver = "rlm_sql_postgresql"
    dialect = "postgresql"

    server   = "localhost"
    port     = 5432
    login    = "netx"
    password = "netx_dev_password"     # mesmo user do netx-core
    radius_db = "netx"                 # mesmo database

    # Todas as queries apontam pro schema radius
    read_clients = yes
    client_table = "radius.nas"

    # Tabelas (schema-qualified)
    authcheck_table  = "radius.radcheck"
    authreply_table  = "radius.radreply"
    groupcheck_table = "radius.radgroupcheck"
    groupreply_table = "radius.radgroupreply"
    usergroup_table  = "radius.radusergroup"
    acct_table1      = "radius.radacct"
    acct_table2      = "radius.radacct"
    postauth_table   = "radius.radpostauth"

    pool {
        start = 5
        min = 4
        max = 10
        lifetime = 0
        idle_timeout = 60
    }
}
```

Ative o módulo e o `sqlcounter` padrão:

```bash
sudo ln -sf ../mods-available/sql /etc/freeradius/3.0/mods-enabled/sql
```

## 4. Habilitar SQL nos sites

Edite `/etc/freeradius/3.0/sites-enabled/default` e descomente `sql` dentro
das seções `authorize`, `accounting`, `session` e `post-auth`.

Mesma coisa em `/etc/freeradius/3.0/sites-enabled/inner-tunnel` (authorize e
post-auth).

## 5. Cadastrar um Mikrotik NAS

Rode no banco (substitua IP e secret pelos reais):

```sql
INSERT INTO radius.nas (nasname, shortname, type, secret, description)
VALUES ('10.0.0.1', 'mk-core-01', 'mikrotik', 'shared_secret_aqui', 'Concentrador PPPoE principal')
ON CONFLICT (nasname) DO UPDATE
  SET secret = EXCLUDED.secret, description = EXCLUDED.description;
```

Para testes adicione o localhost também (permite `radtest` local):

```sql
INSERT INTO radius.nas (nasname, shortname, type, secret, description)
VALUES ('127.0.0.1', 'localhost', 'other', 'testing123', 'smoke tests')
ON CONFLICT (nasname) DO UPDATE SET secret = EXCLUDED.secret;
```

## 6. Ajustar firewall local

Portas UDP que o FreeRADIUS precisa abrir pra dentro:

```bash
sudo ufw allow from <IP-do-Mikrotik> to any port 1812,1813 proto udp
```

Se a VPS também precisa mandar CoA pro Mikrotik (porta 3799 destino), não
precisa de regra inbound — só saída. Garanta que o Mikrotik aceita 3799 do IP
da VPS.

## 7. Subir em modo debug (primeira vez)

```bash
sudo systemctl stop freeradius
sudo freeradius -X
```

O log deve terminar com `Ready to process requests`. Ficar nessa janela aberta
enquanto testa.

Em outro terminal:

```bash
# Cria um contrato pelo NetX (ou via API) e veja se populou
psql "$DATABASE_URL" -c "SELECT username, attribute, value FROM radius.radcheck ORDER BY id DESC LIMIT 5;"
psql "$DATABASE_URL" -c "SELECT username, groupname FROM radius.radusergroup ORDER BY id DESC LIMIT 5;"

# Autenticação local (usa o secret 'testing123' do NAS localhost)
radtest <pppoe.username> <senha> 127.0.0.1 0 testing123
```

Esperado: `Received Access-Accept` com `Framed-Pool = "ativos"`.

Se deu certo:

```bash
# ctrl-c no freeradius -X
sudo systemctl start freeradius
sudo systemctl enable freeradius
```

## 8. Configurar o Mikrotik

RouterOS v6 ou v7 — sintaxe idêntica para o essencial.

```mikrotik
# 8.1. Registrar o RADIUS (authentication + accounting + CoA)
/radius
add service=ppp address=<IP-DA-VPS> secret=<MESMO-SECRET-DO-NAS> \
    authentication-port=1812 accounting-port=1813 timeout=3s

# 8.2. Habilitar CoA (Disconnect) vindo da VPS
/radius incoming
set accept=yes port=3799

# 8.3. Dizer ao PPP para usar RADIUS
/ppp aaa
set use-radius=yes accounting=yes interim-update=5m

# 8.4. Criar os três pools que o Framed-Pool vai referenciar
/ip pool
add name=ativos ranges=10.100.0.2-10.100.255.254
add name=bloqueados ranges=100.64.0.2-100.64.3.254
add name=cancelados ranges=100.64.4.2-100.64.4.254

# 8.5. Profile PPP default — o Framed-Pool do RADIUS sobrescreve este
/ppp profile
set default local-address=10.100.0.1 remote-address=ativos only-one=yes
```

> Os ranges dos pools são exemplos; use o seu plano de endereçamento. O nome
> dos pools ("ativos", "bloqueados", "cancelados") **deve** bater exatamente
> com o que o FreeRADIUS devolve em `Framed-Pool` (definidos em
> `radius-schema.sql`).

### Walled garden do pool "bloqueados"

Sem redirecionamento HTTP, basta que os IPs do pool `bloqueados` só tenham
acesso a recursos internos/essenciais. Exemplo mínimo:

```mikrotik
/ip firewall address-list
add address=100.64.0.0/22 list=bloqueados-src
add address=100.64.4.0/24 list=cancelados-src

/ip firewall filter
add chain=forward src-address-list=bloqueados-src action=drop comment="bloqueia internet p/ suspensos"
add chain=forward src-address-list=cancelados-src action=drop comment="bloqueia internet p/ cancelados"
```

Quando evoluir para página de aviso HTTP, trocar o `drop` por `dst-nat` para
o IP do portal interno.

## 9. Conectar a VPS ao PPP

Pega um CPE real, aponta o PPPoE pro Mikrotik com as credenciais do contrato
criado no NetX. Deve:

1. Autenticar (log do `freeradius -X` mostra `Access-Accept`).
2. Receber IP do pool `ativos`.
3. Aparecer em `SELECT * FROM radius.radacct WHERE acctstoptime IS NULL;`.

## 10. Smoke test de CoA (suspender e observar queda)

Com o cliente conectado:

```bash
# Via API
curl -X POST $DOMAIN/api/v1/contracts/$CONTRACT_ID/suspend \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"reason":"MANUAL","note":"smoke test CoA"}'

# Força o applier a processar já, sem esperar 30s
curl -X POST $DOMAIN/api/v1/radius/_tasks/run-applier \
  -H "Authorization: Bearer $TOKEN"
```

Esperado dentro de ~2s:

- Sessão do cliente cai (aparece `acctstoptime` preenchido em `radius.radacct`).
- Cliente reconecta automaticamente; `radius.radusergroup` mostra
  `groupname = 'bloqueados'`; o CPE recebe IP do novo pool.

Baixar a fatura reverte na mesma velocidade.

## 11. Operação

- **Logs:** `sudo journalctl -u freeradius -f`
- **Queue de intenção:** `SELECT * FROM radius_events ORDER BY created_at DESC LIMIT 20;`
- **Eventos FAILED:** `SELECT id, action, pppoe_username, error FROM radius_events WHERE status='FAILED';`
  (reprocessar: `UPDATE radius_events SET status='PENDING', error=NULL WHERE id=...` e
  rodar `POST /v1/radius/_tasks/run-applier`).
- **Desabilitar applier temporariamente:** `pm2 stop netx-core` (o cron mora
  dentro do processo; parando, eventos só acumulam).

## Variáveis de ambiente relevantes

| Var | Default | Função |
|-----|---------|--------|
| `RADIUS_COA_PORT` | `3799` | Porta UDP de CoA no Mikrotik |
| `RADCLIENT_BIN` | `radclient` | Caminho do binário (mudar só se instalou custom) |

## Referências

- FreeRADIUS docs: <https://wiki.freeradius.org/config/SQL>
- Mikrotik User Manager / RADIUS: <https://help.mikrotik.com/docs/display/ROS/RADIUS>
- Lista de atributos CoA Mikrotik: <https://help.mikrotik.com/docs/display/ROS/RADIUS#RADIUS-CoA>
