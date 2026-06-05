-- Anexos de movimento de caixa (ex.: NF/recibo de uma sangria/despesa).
-- Mesmo padrão presigned (MinIO) dos anexos de O.S.

CREATE TABLE "cash_movement_attachments" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "cash_movement_id" UUID NOT NULL,
  "storage_key" VARCHAR(512) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(120),
  "size_bytes" INTEGER,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_movement_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_mov_attachments_tenant_mov_created_idx"
  ON "cash_movement_attachments"("tenant_id", "cash_movement_id", "created_at");

ALTER TABLE "cash_movement_attachments"
  ADD CONSTRAINT "cash_movement_attachments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cash_movement_attachments"
  ADD CONSTRAINT "cash_movement_attachments_cash_movement_id_fkey"
  FOREIGN KEY ("cash_movement_id") REFERENCES "cash_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cash_movement_attachments"
  ADD CONSTRAINT "cash_movement_attachments_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
