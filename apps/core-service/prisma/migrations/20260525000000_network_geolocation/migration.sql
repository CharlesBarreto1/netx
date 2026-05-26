-- R1 — geolocalização nos equipamentos físicos de rede.
-- DECIMAL(9,6) = mesmo padrão de Contract/CustomerAddress (erro <11cm).
-- Nullable: equipamentos antigos ficam sem coord até admin marcar no mapa.

-- ─── POPs ────────────────────────────────────────────────────────────────────
ALTER TABLE "network_pops"
  ADD COLUMN "latitude"  DECIMAL(9, 6) NULL,
  ADD COLUMN "longitude" DECIMAL(9, 6) NULL;

CREATE INDEX IF NOT EXISTS "network_pops_tenant_geo_idx"
  ON "network_pops" ("tenant_id")
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;

-- ─── Equipamentos (BNG/OLT/Router/Switch) ───────────────────────────────────
ALTER TABLE "network_equipment"
  ADD COLUMN "latitude"  DECIMAL(9, 6) NULL,
  ADD COLUMN "longitude" DECIMAL(9, 6) NULL;

CREATE INDEX IF NOT EXISTS "network_equipment_tenant_geo_idx"
  ON "network_equipment" ("tenant_id")
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;

-- ─── OLTs (modelo provisioning, separado de network_equipment) ──────────────
-- Sim, redundância intencional: olts é o modelo "rico" usado pelo wizard
-- de provisão TR-069; network_equipment é o registro genérico no inventário.
-- Operador marca lat/lng só na OLT detalhada (a network_equipment OLT
-- correspondente herda visualmente, mas backend não copia).
ALTER TABLE "olts"
  ADD COLUMN "latitude"  DECIMAL(9, 6) NULL,
  ADD COLUMN "longitude" DECIMAL(9, 6) NULL;

CREATE INDEX IF NOT EXISTS "olts_tenant_geo_idx"
  ON "olts" ("tenant_id")
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;
