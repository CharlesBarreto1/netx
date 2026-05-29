-- Ufinet (rede neutra PY) — integração API TM Forum assíncrona. Task #29.
--
-- 1 contrato = 1 serviço óptico Ufinet (1:1). Esta tabela guarda a identidade
-- estável do serviço (externalId, ids dos 4 sub-serviços, CTO_PORT) + a
-- operação TMF em voo (currentOrderId/attempts). O `lifecycle` é a fonte de
-- verdade; o poller (cron) avança os estados transientes.
--
-- CREATE TYPE pode coabitar com CREATE TABLE que usa o enum (Postgres permite).

CREATE TYPE "UfinetLifecycle" AS ENUM (
  'PENDING_PROVIDE',
  'PROVIDING',
  'RESERVED',
  'CONFIRMING_ONT',
  'CONFIRMING_SERVICE',
  'ACTIVE',
  'SUSPENDING',
  'SUSPENDED',
  'REACTIVATING',
  'CEASING',
  'CEASED',
  'CANCELLING',
  'CANCELLED',
  'FAILED'
);

-- Config NÃO-secreta do orquestrador (operator/region/contractId/polygonAlias/
-- nms/bandwidthProfile/scope/tokenUrl). Segredos seguem em api_credentials_enc.
ALTER TABLE "olts" ADD COLUMN IF NOT EXISTS "api_config" JSONB;

CREATE TABLE "ufinet_services" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contract_id"              UUID NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
  "olt_id"                   UUID NOT NULL REFERENCES "olts"("id") ON DELETE RESTRICT,

  "external_id"              VARCHAR(80) NOT NULL,
  "label_drop"               VARCHAR(80) NOT NULL,
  "bandwidth_profile"        VARCHAR(64) NOT NULL DEFAULT 'ZUX 1G',

  "lifecycle"                "UfinetLifecycle" NOT NULL DEFAULT 'PENDING_PROVIDE',

  "ufinet_contract_id"       VARCHAR(32),
  "service_order_id"         VARCHAR(32),
  "parent_service_id"        VARCHAR(32),
  "fiber_access_service_id"  VARCHAR(32),
  "hsd_service_id"           VARCHAR(32),
  "res_pon_access_service_id" VARCHAR(32),
  "cto_port"                 VARCHAR(64),
  "serial_number"            VARCHAR(32),

  "current_order_id"         VARCHAR(32),
  "ufinet_state"             VARCHAR(32),
  "waiting_code"             VARCHAR(16),
  "attempts"                 INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at"          TIMESTAMP(3),
  "last_response"            JSONB,
  "error"                    TEXT,

  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "ufinet_services_contract_id_key" ON "ufinet_services" ("contract_id");
CREATE UNIQUE INDEX "ufinet_services_tenant_id_external_id_key" ON "ufinet_services" ("tenant_id", "external_id");
CREATE INDEX "ufinet_services_tenant_id_lifecycle_idx" ON "ufinet_services" ("tenant_id", "lifecycle");
CREATE INDEX "ufinet_services_next_attempt_at_idx" ON "ufinet_services" ("next_attempt_at");
