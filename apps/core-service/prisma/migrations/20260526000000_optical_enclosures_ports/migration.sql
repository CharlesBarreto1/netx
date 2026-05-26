-- R2 — Caixas ópticas (CTO/NAP/Splitter/Emenda) + portas.
-- Doc de visão: docs/architecture/osp-network.md
--
-- Modelagem:
--   OpticalEnclosure: caixa física georreferenciada com N portas.
--     - parentId permite cascateamento (CTO mãe → CTOs filhas).
--     - splitterRatio é o ratio óptico quando há splitter embutido — usado
--       no R5 power budget pra calcular loss.
--   OpticalPort: número 1..capacity. status=USED → contractId obrigatório.
--     Quando contrato é cancelado, contractId vira NULL (SetNull) — porta
--     volta a FREE. Histórico fica em audit log.

-- ─── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "OpticalEnclosureType" AS ENUM ('CTO', 'NAP', 'SPLITTER', 'EMENDA');
CREATE TYPE "SplitterRatio" AS ENUM (
  'ONE_TO_2', 'ONE_TO_4', 'ONE_TO_8',
  'ONE_TO_16', 'ONE_TO_32', 'ONE_TO_64'
);
CREATE TYPE "OpticalMountType" AS ENUM (
  'POSTE', 'AEREO', 'SUBTERRANEO', 'PAREDE', 'RACK'
);
CREATE TYPE "OpticalPortStatus" AS ENUM ('FREE', 'RESERVED', 'USED', 'DAMAGED');

-- ─── optical_enclosures ──────────────────────────────────────────────────────
CREATE TABLE "optical_enclosures" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "code"             VARCHAR(40) NOT NULL,
  "type"             "OpticalEnclosureType" NOT NULL,
  "parent_id"        UUID REFERENCES "optical_enclosures"("id") ON DELETE SET NULL,
  "latitude"         DECIMAL(9, 6) NOT NULL,
  "longitude"        DECIMAL(9, 6) NOT NULL,
  "mount_type"       "OpticalMountType",
  "splitter_ratio"   "SplitterRatio",
  "capacity"         INTEGER NOT NULL CHECK ("capacity" > 0 AND "capacity" <= 256),
  "location_label"   VARCHAR(255),
  "notes"            TEXT,
  "is_active"        BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by_id"    UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_id"    UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  "deleted_at"       TIMESTAMP(3)
);

CREATE UNIQUE INDEX "optical_enclosures_tenant_id_code_key"
  ON "optical_enclosures" ("tenant_id", "code");
CREATE INDEX "optical_enclosures_tenant_id_type_idx"
  ON "optical_enclosures" ("tenant_id", "type");
CREATE INDEX "optical_enclosures_tenant_id_parent_id_idx"
  ON "optical_enclosures" ("tenant_id", "parent_id");

-- ─── optical_ports ───────────────────────────────────────────────────────────
CREATE TABLE "optical_ports" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "enclosure_id"   UUID NOT NULL REFERENCES "optical_enclosures"("id") ON DELETE CASCADE,
  "number"         INTEGER NOT NULL CHECK ("number" >= 1),
  "status"         "OpticalPortStatus" NOT NULL DEFAULT 'FREE',
  "contract_id"    UUID REFERENCES "contracts"("id") ON DELETE SET NULL,
  "notes"          TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "optical_ports_enclosure_id_number_key"
  ON "optical_ports" ("enclosure_id", "number");
-- 1 contrato ocupa só 1 porta. Unique simples (não compound) — Prisma exige
-- isso pra modelar relação 1:1 com Contract. Múltiplos NULLs são distintos
-- no Postgres, então o constraint só fecha quando contractId está preenchido.
CREATE UNIQUE INDEX "optical_ports_contract_id_key"
  ON "optical_ports" ("contract_id");
CREATE INDEX "optical_ports_tenant_id_status_idx"
  ON "optical_ports" ("tenant_id", "status");
