-- R8.3 — PonPort: porta PON da OLT ligada a cabo+fibra.
-- Doc: docs/architecture/osp-network.md
--
-- Vínculo que destrava o power budget AUTOMÁTICO: dado uma fibra no meio da
-- planta, traversal volta até a PonPort de origem somando perdas no caminho.
--
-- Unique constraints:
--   - (olt_id, pon_index): porta física da OLT é única
--   - (cable_id, fiber_index): cada fibra atende UMA PON (parcial via NULLs
--     distintos do Postgres — cabos sem PON e PONs sem cabo ficam livres)

CREATE TABLE "pon_ports" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "olt_id"          UUID NOT NULL REFERENCES "olts"("id") ON DELETE CASCADE,
  "pon_index"       INTEGER NOT NULL CHECK ("pon_index" >= 1 AND "pon_index" <= 256),
  "cable_id"        UUID REFERENCES "fiber_cables"("id") ON DELETE SET NULL,
  "fiber_index"     INTEGER CHECK ("fiber_index" >= 1),
  "tx_power_dbm"    DECIMAL(4, 2) CHECK ("tx_power_dbm" >= -10 AND "tx_power_dbm" <= 20),
  "notes"           TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "pon_ports_olt_pon_idx" ON "pon_ports" ("olt_id", "pon_index");
CREATE UNIQUE INDEX "pon_ports_cable_fiber_idx"
  ON "pon_ports" ("cable_id", "fiber_index");
CREATE INDEX "pon_ports_tenant_olt_idx" ON "pon_ports" ("tenant_id", "olt_id");
