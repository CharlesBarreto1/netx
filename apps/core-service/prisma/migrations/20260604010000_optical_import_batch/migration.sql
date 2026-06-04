-- import_batch_id: agrupa o que um import KMZ/KML criou, pra desfazer o lote.

ALTER TABLE "optical_enclosures" ADD COLUMN "import_batch_id" UUID;
CREATE INDEX "optical_enclosures_tenant_id_import_batch_id_idx"
  ON "optical_enclosures"("tenant_id", "import_batch_id");

ALTER TABLE "fiber_cables" ADD COLUMN "import_batch_id" UUID;
CREATE INDEX "fiber_cables_tenant_id_import_batch_id_idx"
  ON "fiber_cables"("tenant_id", "import_batch_id");
