-- =============================================================================
-- Módulo Estoque — Fase 1
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Cria:
--   - Enums: ProductType, SerialStatus, MovementType
--   - Tabelas: suppliers, products, stock_locations, stock_location_users,
--     stock_levels, serial_items, stock_movements, purchases, purchase_items
--   - Índices necessários pra performance de listing/kardex
--   - RLS habilitada nas tabelas com tenant_id (segue padrão da migration
--     20260517000000_enable_rls_tenant_isolation)
--
-- Fase 2 adiciona: tabelas sales/sale_items + colunas contract_id/service_order_id
-- em stock_movements e FK em serial_items.contract_id.
-- =============================================================================

-- 1) Enums ---------------------------------------------------------------------
CREATE TYPE "ProductType" AS ENUM ('PATRIMONIAL', 'CONSUMIVEL');

CREATE TYPE "SerialStatus" AS ENUM (
    'IN_STOCK',
    'ALLOCATED',
    'IN_TRANSIT',
    'DEFECTIVE',
    'WRITTEN_OFF'
);

CREATE TYPE "MovementType" AS ENUM (
    'PURCHASE',
    'PURCHASE_RETURN',
    'SALE',
    'SALE_RETURN',
    'COMODATO_OUT',
    'COMODATO_RETURN',
    'OS_CONSUMPTION',
    'ADJUSTMENT_IN',
    'ADJUSTMENT_OUT',
    'TRANSFER_OUT',
    'TRANSFER_IN'
);

-- 2) suppliers -----------------------------------------------------------------
CREATE TABLE "suppliers" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"    UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "name"         VARCHAR(255) NOT NULL,
    "tax_id"       VARCHAR(32),
    "tax_id_type"  VARCHAR(16),
    "email"        VARCHAR(255),
    "phone"        VARCHAR(40),
    "address"      VARCHAR(500),
    "city"         VARCHAR(120),
    "state"        VARCHAR(120),
    "notes"        TEXT,
    "is_active"    BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,
    "deleted_at"   TIMESTAMP(3)
);
CREATE UNIQUE INDEX "suppliers_tenant_id_tax_id_tax_id_type_key"
    ON "suppliers" ("tenant_id", "tax_id", "tax_id_type");
CREATE INDEX "suppliers_tenant_id_name_idx"      ON "suppliers" ("tenant_id", "name");
CREATE INDEX "suppliers_tenant_id_is_active_idx" ON "suppliers" ("tenant_id", "is_active");

-- 3) products ------------------------------------------------------------------
CREATE TABLE "products" (
    "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "sku"         VARCHAR(64) NOT NULL,
    "name"        VARCHAR(255) NOT NULL,
    "description" TEXT,
    "brand"       VARCHAR(120),
    "model"       VARCHAR(120),
    "type"        "ProductType" NOT NULL,
    "unit"        VARCHAR(16) NOT NULL DEFAULT 'un',
    "cost"        DECIMAL(14, 4) NOT NULL DEFAULT 0,
    "price"       DECIMAL(14, 4),
    "min_stock"   DECIMAL(14, 4) DEFAULT 0,
    "is_active"   BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,
    "deleted_at"  TIMESTAMP(3)
);
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products" ("tenant_id", "sku");
CREATE INDEX "products_tenant_id_type_idx"      ON "products" ("tenant_id", "type");
CREATE INDEX "products_tenant_id_name_idx"      ON "products" ("tenant_id", "name");
CREATE INDEX "products_tenant_id_is_active_idx" ON "products" ("tenant_id", "is_active");

-- 4) stock_locations -----------------------------------------------------------
CREATE TABLE "stock_locations" (
    "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"  UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "code"       VARCHAR(40) NOT NULL,
    "name"       VARCHAR(120) NOT NULL,
    "address"    VARCHAR(500),
    "is_active"  BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "stock_locations_tenant_id_code_key" ON "stock_locations" ("tenant_id", "code");
CREATE INDEX "stock_locations_tenant_id_is_active_idx"   ON "stock_locations" ("tenant_id", "is_active");

-- 5) stock_location_users (ACL m:n) --------------------------------------------
CREATE TABLE "stock_location_users" (
    "location_id" UUID NOT NULL REFERENCES "stock_locations"("id") ON DELETE CASCADE,
    "user_id"     UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "can_write"   BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY ("location_id", "user_id")
);
CREATE INDEX "stock_location_users_user_id_idx" ON "stock_location_users" ("user_id");

-- 6) stock_levels (saldo de consumíveis) ---------------------------------------
CREATE TABLE "stock_levels" (
    "tenant_id"   UUID NOT NULL,
    "product_id"  UUID NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
    "location_id" UUID NOT NULL REFERENCES "stock_locations"("id") ON DELETE CASCADE,
    "quantity"    DECIMAL(14, 4) NOT NULL DEFAULT 0,
    "updated_at"  TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("product_id", "location_id")
);
CREATE INDEX "stock_levels_tenant_id_product_id_idx"  ON "stock_levels" ("tenant_id", "product_id");
CREATE INDEX "stock_levels_tenant_id_location_id_idx" ON "stock_levels" ("tenant_id", "location_id");

-- 7) serial_items (unidades patrimoniais) --------------------------------------
CREATE TABLE "serial_items" (
    "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"        UUID NOT NULL,
    "product_id"       UUID NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
    "serial"           VARCHAR(120) NOT NULL,
    "status"           "SerialStatus" NOT NULL DEFAULT 'IN_STOCK',
    "location_id"      UUID REFERENCES "stock_locations"("id") ON DELETE SET NULL,
    -- contract_id sem FK por enquanto — adicionada na migration de Fase 2
    -- pra evitar ciclo com Contract → Customer → ... e simplificar rollback.
    "contract_id"      UUID,
    "acquisition_cost" DECIMAL(14, 4),
    "acquisition_date" TIMESTAMP(3),
    "allocated_at"     TIMESTAMP(3),
    "returned_at"      TIMESTAMP(3),
    "notes"            TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "serial_items_tenant_id_product_id_serial_key"
    ON "serial_items" ("tenant_id", "product_id", "serial");
CREATE INDEX "serial_items_tenant_id_status_idx"
    ON "serial_items" ("tenant_id", "status");
CREATE INDEX "serial_items_tenant_id_contract_id_idx"
    ON "serial_items" ("tenant_id", "contract_id");
CREATE INDEX "serial_items_tenant_id_location_id_status_idx"
    ON "serial_items" ("tenant_id", "location_id", "status");

-- 8) purchases -----------------------------------------------------------------
CREATE TABLE "purchases" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"      UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "supplier_id"    UUID NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
    "invoice_number" VARCHAR(64),
    "date"           TIMESTAMP(3) NOT NULL,
    "total_cost"     DECIMAL(14, 4) NOT NULL,
    "notes"          TEXT,
    "created_by_id"  UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "purchases_tenant_id_supplier_id_invoice_number_key"
    ON "purchases" ("tenant_id", "supplier_id", "invoice_number");
CREATE INDEX "purchases_tenant_id_date_idx" ON "purchases" ("tenant_id", "date" DESC);
CREATE INDEX "purchases_supplier_id_idx"    ON "purchases" ("supplier_id");

-- 9) purchase_items ------------------------------------------------------------
CREATE TABLE "purchase_items" (
    "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    "purchase_id" UUID NOT NULL REFERENCES "purchases"("id") ON DELETE CASCADE,
    "product_id"  UUID NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
    "location_id" UUID NOT NULL REFERENCES "stock_locations"("id") ON DELETE RESTRICT,
    "quantity"    DECIMAL(14, 4) NOT NULL,
    "unit_cost"   DECIMAL(14, 4) NOT NULL,
    "total_cost"  DECIMAL(14, 4) NOT NULL,
    "serials"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "notes"       TEXT
);
CREATE INDEX "purchase_items_purchase_id_idx" ON "purchase_items" ("purchase_id");
CREATE INDEX "purchase_items_product_id_idx"  ON "purchase_items" ("product_id");

-- 10) stock_movements (kardex) -------------------------------------------------
CREATE TABLE "stock_movements" (
    "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"        UUID NOT NULL,
    "type"             "MovementType" NOT NULL,
    "product_id"       UUID NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
    "serial_item_id"   UUID REFERENCES "serial_items"("id") ON DELETE SET NULL,
    "from_location_id" UUID REFERENCES "stock_locations"("id") ON DELETE SET NULL,
    "to_location_id"   UUID REFERENCES "stock_locations"("id") ON DELETE SET NULL,
    "quantity"         DECIMAL(14, 4) NOT NULL,
    "unit_cost"        DECIMAL(14, 4) NOT NULL,
    "total_cost"       DECIMAL(14, 4) NOT NULL,
    "purchase_id"      UUID REFERENCES "purchases"("id") ON DELETE SET NULL,
    "notes"            TEXT,
    "created_by_id"    UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "stock_movements_tenant_id_created_at_idx"
    ON "stock_movements" ("tenant_id", "created_at" DESC);
CREATE INDEX "stock_movements_tenant_id_product_id_created_at_idx"
    ON "stock_movements" ("tenant_id", "product_id", "created_at" DESC);
CREATE INDEX "stock_movements_tenant_id_type_created_at_idx"
    ON "stock_movements" ("tenant_id", "type", "created_at" DESC);
CREATE INDEX "stock_movements_purchase_id_idx"    ON "stock_movements" ("purchase_id");
CREATE INDEX "stock_movements_serial_item_id_idx" ON "stock_movements" ("serial_item_id");

-- 11) RLS (segue padrão da migration 20260517000000_enable_rls_tenant_isolation)
-- Tabelas com tenant_id direto: enable RLS + FORCE + policy.
DO $$
DECLARE
  t text;
  rls_tables text[] := ARRAY[
    'suppliers',
    'products',
    'stock_locations',
    'stock_levels',
    'serial_items',
    'stock_movements',
    'purchases',
    'purchase_items'
  ];
BEGIN
  FOREACH t IN ARRAY rls_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id()) '
      'WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- `stock_location_users` é m:n sem coluna tenant_id direta — isolamento via
-- JOIN com stock_locations. Não enable RLS aqui (acesso é via service que
-- valida tenant via location).
