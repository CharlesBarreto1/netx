-- R6 — Eventos OTDR (rompimentos / atenuações detectadas).
-- Doc: docs/architecture/osp-network.md
--
-- distance_meters = leitura do OTDR. latitude/longitude = calculados pelo
-- backend caminhando pela polyline do cabo (Haversine inline). Quando
-- cable.path muda, os eventos podem ficar com coordenada errada — service
-- recalcula em batch num future TODO.

CREATE TYPE "FiberEventType" AS ENUM (
  'BREAK',
  'BEND',
  'REFLECTION',
  'ATTENUATION',
  'CONNECTOR',
  'OTHER'
);

CREATE TABLE "fiber_events" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "cable_id"        UUID NOT NULL REFERENCES "fiber_cables"("id") ON DELETE CASCADE,

  "distance_meters" DECIMAL(12, 2) NOT NULL CHECK ("distance_meters" >= 0),
  "fiber_index"     INTEGER CHECK ("fiber_index" >= 1),

  "latitude"        DECIMAL(9, 6) NOT NULL,
  "longitude"       DECIMAL(9, 6) NOT NULL,

  "type"            "FiberEventType" NOT NULL,
  "loss_db"         DECIMAL(4, 2) CHECK ("loss_db" >= 0 AND "loss_db" < 100),

  "reported_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reported_by_id"  UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at"     TIMESTAMP(3),
  "resolved_by_id"  UUID REFERENCES "users"("id") ON DELETE SET NULL,

  "photo_url"       VARCHAR(2000),
  "notes"           TEXT,

  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  "deleted_at"      TIMESTAMP(3)
);

CREATE INDEX "fiber_events_tenant_cable_idx"
  ON "fiber_events" ("tenant_id", "cable_id");
-- Filtro principal do mapa: "eventos ATIVOS deste tenant" — usar índice
-- parcial pra economizar (resolvido = histórico, raramente consultado).
CREATE INDEX "fiber_events_tenant_active_idx"
  ON "fiber_events" ("tenant_id")
  WHERE "resolved_at" IS NULL AND "deleted_at" IS NULL;
