-- Estoque — código de patrimônio (asset tag) do item serializado.
--
-- Até aqui o único identificador de um bem era `serial`, que é do FABRICANTE:
-- só é único por produto, e é editável (renameSerial). Isso não serve de
-- identidade patrimonial — a etiqueta física precisa de um número próprio da
-- operação, único no tenant e imutável.
--
-- `asset_seq` guarda o sequencial cru (MAX+1 na criação, mesmo padrão de
-- contracts.seq); `asset_tag` é a forma legível "{prefix}-{seq}" com padding.
-- Ambos NULL no acervo existente: etiquetar bem já instalado exige visita
-- física, então o backfill é decisão da operação, não da migration.

ALTER TABLE "tenants" ADD COLUMN "asset_prefix" VARCHAR(8);

ALTER TABLE "serial_items" ADD COLUMN "asset_tag" VARCHAR(32);
ALTER TABLE "serial_items" ADD COLUMN "asset_seq" INTEGER;

-- Únicos por TENANT (não por produto, ao contrário de serial). São a rede de
-- segurança da corrida do MAX+1: duas entradas simultâneas colidem em P2002 e
-- o service re-tenta, em vez de emitir duas etiquetas com o mesmo número.
-- NULLs não conflitam entre si no Postgres, então o acervo sem tag passa.
CREATE UNIQUE INDEX "serial_items_tenant_asset_tag_key"
  ON "serial_items"("tenant_id", "asset_tag");
CREATE UNIQUE INDEX "serial_items_tenant_asset_seq_key"
  ON "serial_items"("tenant_id", "asset_seq");
