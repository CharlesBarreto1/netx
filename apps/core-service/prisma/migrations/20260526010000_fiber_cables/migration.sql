-- R3 — Cabos de fibra (FiberCable).
-- Doc de visão: docs/architecture/osp-network.md
--
-- LineString geo armazenada como Json (array de [lng, lat] no formato GeoJSON).
-- Sem PostGIS — cálculo de comprimento e queries geo ficam no Node via turf.js,
-- evita dependência extra na VPS.

CREATE TYPE "FiberCableType" AS ENUM ('BACKBONE', 'DISTRIBUTION', 'DROP');

CREATE TABLE "fiber_cables" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "code"           VARCHAR(40) NOT NULL,
  "type"           "FiberCableType" NOT NULL,
  -- 2..288: valores comuns de mercado FTTH. CHECK frouxo pra não bloquear
  -- variações exóticas (ex: 432 em backbone metro). DTO Zod aplica regra mais estrita.
  "fiber_count"    INTEGER NOT NULL CHECK ("fiber_count" >= 1 AND "fiber_count" <= 432),
  -- LineString GeoJSON. Validação de formato fica no DTO Zod (mínimo 2 pontos,
  -- cada ponto [lng, lat] com bounds globais).
  "path"           JSONB NOT NULL,
  -- Comprimento em metros. Backend calcula via Haversine ao salvar; operador
  -- pode override (cabo "frouxo" no poste tem 10-15% a mais que distância reta).
  "length_meters"  DECIMAL(12, 2) NOT NULL CHECK ("length_meters" >= 0),
  "notes"          TEXT,
  "is_active"      BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by_id"  UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_id"  UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  "deleted_at"     TIMESTAMP(3)
);

CREATE UNIQUE INDEX "fiber_cables_tenant_id_code_key"
  ON "fiber_cables" ("tenant_id", "code");
CREATE INDEX "fiber_cables_tenant_id_type_idx"
  ON "fiber_cables" ("tenant_id", "type");
