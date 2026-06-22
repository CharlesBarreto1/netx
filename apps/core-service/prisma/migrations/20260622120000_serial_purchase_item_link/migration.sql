-- Vincula cada SerialItem à linha de compra (PurchaseItem) que o originou.
-- Habilita entrada incremental de seriais e reversão/rename por FK em vez de
-- casar por string. Coluna nullable (ajustes de entrada ficam sem vínculo).

ALTER TABLE "serial_items" ADD COLUMN "purchase_item_id" UUID;

-- Backfill: liga seriais existentes à sua linha de compra pelo par
-- (tenant, produto) + pertencimento ao array desnormalizado purchase_items.serials.
-- Se o mesmo serial aparecesse em duas linhas (não deveria — unique por
-- tenant+produto+serial garante 1 SerialItem), o ANY casaria a primeira; ok.
UPDATE "serial_items" si
SET "purchase_item_id" = pi."id"
FROM "purchase_items" pi
WHERE si."tenant_id" = pi."tenant_id"
  AND si."product_id" = pi."product_id"
  AND si."serial" = ANY(pi."serials");

ALTER TABLE "serial_items"
  ADD CONSTRAINT "serial_items_purchase_item_id_fkey"
  FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "serial_items_purchase_item_id_idx" ON "serial_items"("purchase_item_id");
