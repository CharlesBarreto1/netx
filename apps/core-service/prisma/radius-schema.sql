-- =============================================================================
-- NetX — Schema FreeRADIUS (PostgreSQL)
--
-- Cria o schema `radius` com as tabelas padrão do FreeRADIUS 3.x (rlm_sql)
-- e popula os grupos `ativos`, `bloqueados` e `cancelados` com o atributo
-- `Framed-Pool` — os mesmos nomes que o Mikrotik deve ter em `/ip pool`.
--
-- Idempotente: pode rodar múltiplas vezes sem erro.
--
-- Uso:
--   psql "$DATABASE_URL" -f apps/core-service/prisma/radius-schema.sql
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS radius;

-- -----------------------------------------------------------------------------
-- radcheck — atributos de verificação por usuário (senha, allowed ports, etc)
-- Uma linha "Cleartext-Password := <senha>" por PPPoE user.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius.radcheck (
    id        BIGSERIAL PRIMARY KEY,
    username  VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op        CHAR(2)     NOT NULL DEFAULT '==',
    value     VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS radcheck_username_idx ON radius.radcheck (username);

-- -----------------------------------------------------------------------------
-- radreply — atributos devolvidos no Access-Accept por usuário (sobrescrevem grupo)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius.radreply (
    id        BIGSERIAL PRIMARY KEY,
    username  VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op        CHAR(2)     NOT NULL DEFAULT '=',
    value     VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS radreply_username_idx ON radius.radreply (username);

-- -----------------------------------------------------------------------------
-- radgroupcheck — check attributes por grupo
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius.radgroupcheck (
    id        BIGSERIAL PRIMARY KEY,
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op        CHAR(2)     NOT NULL DEFAULT '==',
    value     VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS radgroupcheck_groupname_idx ON radius.radgroupcheck (groupname);

-- -----------------------------------------------------------------------------
-- radgroupreply — reply attributes por grupo (é aqui que mora o Framed-Pool)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius.radgroupreply (
    id        BIGSERIAL PRIMARY KEY,
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op        CHAR(2)     NOT NULL DEFAULT '=',
    value     VARCHAR(253) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS radgroupreply_groupname_idx ON radius.radgroupreply (groupname);

-- -----------------------------------------------------------------------------
-- radusergroup — mapeia PPPoE user -> grupo (ativos/bloqueados/cancelados)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius.radusergroup (
    id        BIGSERIAL PRIMARY KEY,
    username  VARCHAR(64) NOT NULL DEFAULT '',
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    priority  INTEGER     NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS radusergroup_username_idx ON radius.radusergroup (username);
-- Um usuário em um único grupo por vez (nosso caso); facilita UPSERT
CREATE UNIQUE INDEX IF NOT EXISTS radusergroup_username_priority_uidx
    ON radius.radusergroup (username, priority);

-- -----------------------------------------------------------------------------
-- radacct — accounting (sessões). O FreeRADIUS popula automaticamente.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius.radacct (
    radacctid           BIGSERIAL PRIMARY KEY,
    acctsessionid       VARCHAR(64)  NOT NULL DEFAULT '',
    acctuniqueid        VARCHAR(32)  NOT NULL UNIQUE,
    username            VARCHAR(64)  NOT NULL DEFAULT '',
    groupname           VARCHAR(64)  NOT NULL DEFAULT '',
    realm               VARCHAR(64)           DEFAULT '',
    nasipaddress        INET         NOT NULL,
    nasportid           VARCHAR(32)           DEFAULT NULL,
    nasporttype         VARCHAR(32)           DEFAULT NULL,
    acctstarttime       TIMESTAMP WITH TIME ZONE,
    acctupdatetime      TIMESTAMP WITH TIME ZONE,
    acctstoptime        TIMESTAMP WITH TIME ZONE,
    acctinterval        BIGINT,
    acctsessiontime     BIGINT,
    acctauthentic       VARCHAR(32),
    connectinfo_start   VARCHAR(50),
    connectinfo_stop    VARCHAR(50),
    acctinputoctets     BIGINT,
    acctoutputoctets    BIGINT,
    calledstationid     VARCHAR(50)  NOT NULL DEFAULT '',
    callingstationid    VARCHAR(50)  NOT NULL DEFAULT '',
    acctterminatecause  VARCHAR(32)  NOT NULL DEFAULT '',
    servicetype         VARCHAR(32),
    framedprotocol      VARCHAR(32),
    framedipaddress     INET,
    framedipv6address   INET,
    framedipv6prefix    INET,
    framedinterfaceid   VARCHAR(44),
    delegatedipv6prefix INET,
    class               VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS radacct_username_idx         ON radius.radacct (username);
CREATE INDEX IF NOT EXISTS radacct_acctstoptime_idx     ON radius.radacct (acctstoptime);
CREATE INDEX IF NOT EXISTS radacct_active_session_idx   ON radius.radacct (acctstoptime) WHERE acctstoptime IS NULL;
CREATE INDEX IF NOT EXISTS radacct_nasipaddress_idx     ON radius.radacct (nasipaddress);

-- -----------------------------------------------------------------------------
-- radpostauth — log de tentativas de autenticação (sucesso + falha)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius.radpostauth (
    id          BIGSERIAL PRIMARY KEY,
    username    VARCHAR(64) NOT NULL DEFAULT '',
    pass        VARCHAR(64) NOT NULL DEFAULT '',
    reply       VARCHAR(32) NOT NULL DEFAULT '',
    calledstationid  VARCHAR(50) NOT NULL DEFAULT '',
    callingstationid VARCHAR(50) NOT NULL DEFAULT '',
    authdate    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    class       VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS radpostauth_username_idx ON radius.radpostauth (username);
CREATE INDEX IF NOT EXISTS radpostauth_authdate_idx ON radius.radpostauth (authdate);

-- -----------------------------------------------------------------------------
-- nas — concentradores (Mikrotiks) autorizados a falar com o FreeRADIUS.
-- O FreeRADIUS lê dessa tabela em tempo de boot (naslist sql).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius.nas (
    id          BIGSERIAL PRIMARY KEY,
    nasname     VARCHAR(128) NOT NULL,        -- IP ou hostname do Mikrotik
    shortname   VARCHAR(32),
    type        VARCHAR(30) NOT NULL DEFAULT 'mikrotik',
    ports       INTEGER,
    secret      VARCHAR(60) NOT NULL,
    server      VARCHAR(64),
    community   VARCHAR(50),
    description VARCHAR(200) DEFAULT 'NetX managed'
);
CREATE UNIQUE INDEX IF NOT EXISTS nas_nasname_uidx ON radius.nas (nasname);

-- =============================================================================
-- Seed dos grupos de pool — idempotente via DELETE + INSERT dentro de CTE
-- =============================================================================

-- Remove linhas antigas dos 3 grupos conhecidos (mantém outros intactos)
DELETE FROM radius.radgroupreply
 WHERE groupname IN ('ativos', 'bloqueados', 'cancelados')
   AND attribute IN ('Framed-Pool', 'Acct-Interim-Interval');

-- ativos: pool "ativos" + accounting interim a cada 5 min
INSERT INTO radius.radgroupreply (groupname, attribute, op, value) VALUES
    ('ativos',      'Framed-Pool',            ':=', 'ativos'),
    ('ativos',      'Acct-Interim-Interval',  ':=', '300'),
    ('bloqueados',  'Framed-Pool',            ':=', 'bloqueados'),
    ('bloqueados',  'Acct-Interim-Interval',  ':=', '300'),
    ('cancelados',  'Framed-Pool',            ':=', 'cancelados'),
    ('cancelados',  'Acct-Interim-Interval',  ':=', '300');

-- Sanity check: listar grupos populados
DO $$
BEGIN
  RAISE NOTICE 'radius schema pronto. Grupos: %',
    (SELECT string_agg(DISTINCT groupname, ', ') FROM radius.radgroupreply);
END $$;

-- -----------------------------------------------------------------------------
-- nas — clients RADIUS dinâmicos (BNGs cadastrados via NetX).
--
-- O FreeRADIUS lê esta tabela quando configurado com `read_clients = yes`
-- no módulo SQL. Cada linha vira um `client { ... }` em runtime sem
-- precisar editar `clients.conf`.
--
-- O NetX (NetworkModule) faz INSERT/UPDATE/DELETE aqui automaticamente
-- quando admin cadastra um Equipamento type=BNG.
--
-- Schema padrão FreeRADIUS 3.x — não mude colunas ou dialup.conf quebra.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radius.nas (
    id          BIGSERIAL PRIMARY KEY,
    nasname     VARCHAR(128) NOT NULL,           -- IP ou hostname do BNG
    shortname   VARCHAR(32),                     -- alias curto
    type        VARCHAR(30) DEFAULT 'other',     -- mikrotik, cisco, juniper, other
    ports       INTEGER,
    secret      VARCHAR(60) NOT NULL DEFAULT 'secret',
    server      VARCHAR(64),
    community   VARCHAR(50),
    description VARCHAR(200) DEFAULT 'NetX-managed'
);
CREATE UNIQUE INDEX IF NOT EXISTS nas_nasname_uidx ON radius.nas (nasname);

-- =============================================================================
-- Configuração FreeRADIUS necessária pra ler clientes desta tabela:
--
--   /etc/freeradius/3.0/mods-available/sql:
--     read_clients = yes
--     client_table = "nas"
--
--   /etc/freeradius/3.0/clients.conf:
--     # No fim do arquivo, libera leitura via SQL:
--     #   $INCLUDE sql.conf  (se já existe)
--     # OU adicione manualmente:
--     #   client sql {}      (vazio — força ler do SQL)
--
--   Após editar: sudo systemctl restart freeradius
--
-- Pra que o FreeRADIUS pegue mudanças sem restart, configure:
--   /etc/freeradius/3.0/mods-config/sql/main/postgresql/queries.conf
--   client_query = "SELECT id, nasname, shortname, type, secret, server, community, description FROM radius.nas"
-- =============================================================================
