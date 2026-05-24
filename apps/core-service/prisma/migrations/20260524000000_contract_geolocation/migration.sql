-- Contract: latitude/longitude para o módulo Mapeamento.
-- DECIMAL(9,6) cobre toda superfície terrestre com erro <11cm — mais que
-- suficiente pra fixar residências. Nullable: contratos antigos ficam sem
-- coord até o operador marcar no mapa (UI: LocationPicker no EditContract).
ALTER TABLE "contracts"
  ADD COLUMN "latitude"  DECIMAL(9, 6) NULL,
  ADD COLUMN "longitude" DECIMAL(9, 6) NULL;

-- Index parcial: o endpoint /v1/mapping/customers filtra
-- (tenantId + latitude IS NOT NULL + longitude IS NOT NULL).
-- Com parcial economiza espaço (só linhas geo-marcadas entram no índice)
-- e mantém o query rápido conforme operação cresce.
CREATE INDEX IF NOT EXISTS "contracts_tenant_geo_idx"
  ON "contracts" ("tenant_id")
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;
