-- Costura FiberMap ↔ contratos (integração CTO/porta, FIBERMAP-SPEC §11).
--
-- contracts.fibermap_port_id: porta de drop (splitter OUT dentro de uma CTO
-- do FiberMap) que atende o contrato. FK no lado do contrato — a porta segue
-- sendo um nó puro do grafo óptico. Unique parcial via unique index padrão do
-- Postgres (múltiplos NULLs são distintos). SET NULL: apagar a planta não
-- mexe no contrato.

ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "fibermap_port_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "contracts_fibermap_port_id_key"
  ON "contracts"("fibermap_port_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_fibermap_port_id_fkey'
  ) THEN
    ALTER TABLE "contracts"
      ADD CONSTRAINT "contracts_fibermap_port_id_fkey"
      FOREIGN KEY ("fibermap_port_id") REFERENCES "fibermap_optical_ports"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
