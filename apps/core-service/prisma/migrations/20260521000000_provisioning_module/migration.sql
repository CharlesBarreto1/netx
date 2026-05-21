-- =============================================================================
-- Módulo Provisionamento — Fase 1: Olt, Ont, Tr069Device, Tr069Task
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Schema do fluxo de ativação ZTP (zero-touch provisioning):
--   1. Vendedor cria Contract PENDING_INSTALL
--   2. Técnico vincula ONT (SN GPON) à OLT via /provisioning/install
--   3. Driver-pattern (DIRECT SSH ou ORCHESTRATOR API) autoriza a ONT
--   4. Tr069Task agendada (Fase 3 ACS aplica Wi-Fi via SetParameterValues)
--   5. RadiusSyncService enfileira AUTHORIZE → cliente online
--
-- Fase 1 entrega schema + UI + mock driver. UfinetOrchestratorDriver e
-- HuaweiSshDriver são stubs até as integrações reais (Fase 2/4).
-- =============================================================================

-- 0) Enums novos --------------------------------------------------------------
CREATE TYPE "OltVendor" AS ENUM (
  'HUAWEI', 'ZTE', 'DATACOM', 'FIBERHOME', 'NOKIA', 'PARKS', 'UFINET', 'GENERIC'
);
CREATE TYPE "OltProviderMode" AS ENUM ('DIRECT', 'ORCHESTRATOR');
CREATE TYPE "OltStatus" AS ENUM ('ONLINE', 'OFFLINE', 'UNREACHABLE', 'UNKNOWN');
CREATE TYPE "OntStatus" AS ENUM (
  'PENDING_AUTH', 'AUTHORIZED', 'ONLINE', 'OFFLINE', 'LOS', 'FAULT'
);
CREATE TYPE "Tr069TaskAction" AS ENUM (
  'SET_PARAMS', 'GET_PARAMS', 'REBOOT', 'FACTORY_RESET',
  'DOWNLOAD', 'ADD_OBJECT', 'DELETE_OBJECT'
);
CREATE TYPE "Tr069TaskStatus" AS ENUM (
  'PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'
);
CREATE TYPE "ProvisioningEventStatus" AS ENUM (
  'PENDING', 'SUCCESS', 'FAILED', 'TIMEOUT'
);
CREATE TYPE "ProvisioningEventAction" AS ENUM (
  'OLT_AUTHORIZE', 'OLT_DEAUTHORIZE', 'OLT_STATUS_POLL', 'OLT_TEST_CONNECTION',
  'TR069_TASK_ENQUEUE', 'TR069_INFORM_RECEIVED',
  'RADIUS_ENQUEUE', 'CONTRACT_ACTIVATE'
);

-- (PENDING_INSTALL adicionado ao enum ContractStatus em migration anterior:
--  20260520200000_contract_status_pending_install — separada pra evitar
--  conflito de transação no Postgres com `ALTER TYPE ... ADD VALUE`.)

-- 1) Campos novos em contracts (Wi-Fi pra TR-069 aplicar na ONT) -------------
ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "ssid" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "wifi_password_enc" TEXT;

-- 3) Tabela olts --------------------------------------------------------------
CREATE TABLE "olts" (
  "id"                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                UUID         NOT NULL,
  "name"                     VARCHAR(128) NOT NULL,
  "vendor"                   "OltVendor"  NOT NULL,
  "model"                    VARCHAR(64)  NOT NULL,
  "provider_mode"            "OltProviderMode" NOT NULL DEFAULT 'DIRECT',

  -- DIRECT mode
  "management_ip"            INET,
  "ssh_port"                 INTEGER      NOT NULL DEFAULT 22,
  "ssh_user"                 VARCHAR(64),
  "ssh_password_enc"         TEXT,
  "enable_secret_enc"        TEXT,

  -- ORCHESTRATOR mode
  "api_endpoint"             VARCHAR(255),
  "api_auth_type"            VARCHAR(32),
  "api_credentials_enc"      TEXT,
  "api_webhook_secret"       VARCHAR(128),

  -- Defaults
  "service_vlan_id"          INTEGER,
  "default_up_profile"       VARCHAR(64),
  "default_down_profile"     VARCHAR(64),

  -- Telemetria
  "status"                   "OltStatus"  NOT NULL DEFAULT 'UNKNOWN',
  "last_seen_at"             TIMESTAMP(3),
  "last_error"               TEXT,

  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,
  "deleted_at"               TIMESTAMP(3),

  CONSTRAINT "olts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "olts_tenant_id_name_key" ON "olts" ("tenant_id", "name");
CREATE INDEX "olts_tenant_id_idx" ON "olts" ("tenant_id");
CREATE INDEX "olts_tenant_id_status_idx" ON "olts" ("tenant_id", "status");

-- 4) Tabela onts --------------------------------------------------------------
CREATE TABLE "onts" (
  "id"                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                UUID         NOT NULL,
  "contract_id"              UUID         NOT NULL UNIQUE,
  "olt_id"                   UUID         NOT NULL,

  "sn_gpon"                  VARCHAR(32)  NOT NULL,
  "mac_address"              VARCHAR(17),
  "serial_physical"          VARCHAR(64),

  "pon_frame"                INTEGER,
  "pon_slot"                 INTEGER,
  "pon_onu_index"            INTEGER,

  "status"                   "OntStatus"  NOT NULL DEFAULT 'PENDING_AUTH',
  "last_rx_power"            DECIMAL(6,2),
  "last_tx_power"            DECIMAL(6,2),

  "authorized_at"            TIMESTAMP(3),
  "last_seen_at"             TIMESTAMP(3),
  "last_error"               TEXT,
  "notes"                    TEXT,

  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,

  CONSTRAINT "onts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "onts_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT,
  CONSTRAINT "onts_olt_id_fkey"
    FOREIGN KEY ("olt_id") REFERENCES "olts"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "onts_olt_id_sn_gpon_key"
  ON "onts" ("olt_id", "sn_gpon");
CREATE UNIQUE INDEX "onts_olt_id_pon_position_key"
  ON "onts" ("olt_id", "pon_frame", "pon_slot", "pon_onu_index")
  WHERE "pon_frame" IS NOT NULL
    AND "pon_slot"  IS NOT NULL
    AND "pon_onu_index" IS NOT NULL;
CREATE INDEX "onts_tenant_id_status_idx"      ON "onts" ("tenant_id", "status");
CREATE INDEX "onts_tenant_id_mac_address_idx" ON "onts" ("tenant_id", "mac_address");

-- 5) Tabela tr069_devices -----------------------------------------------------
CREATE TABLE "tr069_devices" (
  "id"                            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                     UUID         NOT NULL,
  "ont_id"                        UUID         UNIQUE,

  "device_id"                     VARCHAR(128) NOT NULL UNIQUE,
  "manufacturer"                  VARCHAR(64),
  "oui"                           VARCHAR(6),
  "product_class"                 VARCHAR(64),
  "hardware_version"              VARCHAR(32),
  "software_version"              VARCHAR(32),
  "provisioning_code"             VARCHAR(128),

  "connection_request_url"        VARCHAR(255),
  "connection_request_user"       VARCHAR(64),
  "connection_request_pwd_enc"    TEXT,

  "parameters_snapshot"           JSONB,

  "status"                        VARCHAR(32)  NOT NULL DEFAULT 'UNKNOWN',
  "last_inform_at"                TIMESTAMP(3),
  "last_inform_reason"            VARCHAR(64),

  "created_at"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tr069_devices_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "tr069_devices_ont_id_fkey"
    FOREIGN KEY ("ont_id") REFERENCES "onts"("id") ON DELETE SET NULL
);

CREATE INDEX "tr069_devices_tenant_id_status_idx"
  ON "tr069_devices" ("tenant_id", "status");
CREATE INDEX "tr069_devices_tenant_id_last_inform_at_idx"
  ON "tr069_devices" ("tenant_id", "last_inform_at");

-- 6) Tabela tr069_tasks -------------------------------------------------------
CREATE TABLE "tr069_tasks" (
  "id"            UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     UUID              NOT NULL,
  "device_id"     UUID              NOT NULL,
  "contract_id"   UUID,

  "action"        "Tr069TaskAction" NOT NULL,
  "payload"       JSONB             NOT NULL,
  "result"        JSONB,

  "status"        "Tr069TaskStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"      INTEGER           NOT NULL DEFAULT 0,
  "error"         TEXT,

  "created_at"    TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3)      NOT NULL,
  "started_at"    TIMESTAMP(3),
  "completed_at"  TIMESTAMP(3),

  CONSTRAINT "tr069_tasks_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "tr069_tasks_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "tr069_devices"("id") ON DELETE CASCADE
);

CREATE INDEX "tr069_tasks_tenant_id_device_id_status_idx"
  ON "tr069_tasks" ("tenant_id", "device_id", "status");
CREATE INDEX "tr069_tasks_tenant_id_status_created_at_idx"
  ON "tr069_tasks" ("tenant_id", "status", "created_at");

-- 7) Tabela provisioning_events (auditoria detalhada) -------------------------
CREATE TABLE "provisioning_events" (
  "id"            UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     UUID                       NOT NULL,
  "contract_id"   UUID,
  "ont_id"        UUID,
  "olt_id"        UUID,

  "action"        "ProvisioningEventAction"  NOT NULL,
  "status"        "ProvisioningEventStatus"  NOT NULL DEFAULT 'PENDING',
  "payload"       JSONB,
  "error"         TEXT,
  "duration_ms"   INTEGER,

  "actor_user_id" UUID,
  "actor_kind"    VARCHAR(32)                NOT NULL DEFAULT 'user',

  "created_at"    TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provisioning_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "provisioning_events_tenant_contract_created_idx"
  ON "provisioning_events" ("tenant_id", "contract_id", "created_at");
CREATE INDEX "provisioning_events_tenant_ont_idx"
  ON "provisioning_events" ("tenant_id", "ont_id");
CREATE INDEX "provisioning_events_tenant_status_created_idx"
  ON "provisioning_events" ("tenant_id", "status", "created_at");

-- 8) updated_at triggers ------------------------------------------------------
-- Mantém consistência com o resto do schema (Prisma @updatedAt depende do app
-- mas trigger garante mesmo se UPDATE vier por SQL direto).
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'olts_set_updated_at') THEN
    CREATE TRIGGER olts_set_updated_at BEFORE UPDATE ON "olts"
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'onts_set_updated_at') THEN
    CREATE TRIGGER onts_set_updated_at BEFORE UPDATE ON "onts"
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr069_devices_set_updated_at') THEN
    CREATE TRIGGER tr069_devices_set_updated_at BEFORE UPDATE ON "tr069_devices"
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr069_tasks_set_updated_at') THEN
    CREATE TRIGGER tr069_tasks_set_updated_at BEFORE UPDATE ON "tr069_tasks"
      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
  END IF;
END $$;

-- 9) RLS: provisioning tables seguem mesmo padrão do schema -------------------
-- (instalado por migration 20260517000000_enable_rls_tenant_isolation, mas
--  tabelas novas precisam ser ativadas explicitamente)
ALTER TABLE "olts"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "olts"                FORCE  ROW LEVEL SECURITY;
ALTER TABLE "onts"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onts"                FORCE  ROW LEVEL SECURITY;
ALTER TABLE "tr069_devices"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tr069_devices"       FORCE  ROW LEVEL SECURITY;
ALTER TABLE "tr069_tasks"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tr069_tasks"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "provisioning_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provisioning_events" FORCE  ROW LEVEL SECURITY;

-- Policy permissiva (compatível com modelo atual onde app.tenant_id pode ser
-- null e BYPASSRLS está ativo pro role netx). Quando enforcement RLS for
-- ligado de verdade (vide postgres.sh:60), só essa policy precisa de update.
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['olts','onts','tr069_devices','tr069_tasks','provisioning_events']
  LOOP
    EXECUTE format($f$
      CREATE POLICY %I_tenant_isolation ON %I
      USING (current_setting('app.tenant_id', true) IS NULL
             OR tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (current_setting('app.tenant_id', true) IS NULL
             OR tenant_id::text = current_setting('app.tenant_id', true))
    $f$, tbl, tbl);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN
  -- Policy já existe (re-run idempotente em dev)
  NULL;
END $$;
