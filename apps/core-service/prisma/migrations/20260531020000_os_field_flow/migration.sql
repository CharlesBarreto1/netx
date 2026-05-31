-- O.S em campo: lifecycle estendido (deslocamento + check-in) e fotos de
-- comprovação. Base da tela única do técnico (/os) + endpoint one-touch.

-- 1) Novo status EN_ROUTE ("a caminho"). PG16 permite ADD VALUE em transação
--    desde que o valor não seja usado na mesma migration (não é).
ALTER TYPE "ServiceOrderStatus" ADD VALUE IF NOT EXISTS 'EN_ROUTE' AFTER 'SCHEDULED';

-- 2) Timestamps do lifecycle de campo (deslocamento / chegada).
ALTER TABLE "service_orders" ADD COLUMN "en_route_at" TIMESTAMP(3);
ALTER TABLE "service_orders" ADD COLUMN "checkin_at" TIMESTAMP(3);

-- 3) Fotos de comprovação (keys no MinIO via StorageService).
CREATE TABLE "service_order_photos" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "service_order_id" UUID NOT NULL,
  "storage_key" VARCHAR(512) NOT NULL,
  "content_type" VARCHAR(120),
  "size_bytes" INTEGER,
  "caption" VARCHAR(255),
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_order_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_order_photos_tenant_id_service_order_id_idx"
  ON "service_order_photos"("tenant_id", "service_order_id");

ALTER TABLE "service_order_photos"
  ADD CONSTRAINT "service_order_photos_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_order_photos"
  ADD CONSTRAINT "service_order_photos_service_order_id_fkey"
  FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
