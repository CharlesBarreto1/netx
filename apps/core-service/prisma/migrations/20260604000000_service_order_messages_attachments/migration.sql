-- ServiceOrderMessage + ServiceOrderAttachment
-- Thread de mensagens (atendente ↔ técnico) e anexos avulsos da O.S.

-- ─── Mensagens ───────────────────────────────────────────────────────────────
CREATE TABLE "service_order_messages" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "service_order_id" UUID NOT NULL,
  "author_id" UUID,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_order_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "so_messages_tenant_so_created_idx"
  ON "service_order_messages"("tenant_id", "service_order_id", "created_at");

ALTER TABLE "service_order_messages"
  ADD CONSTRAINT "service_order_messages_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_order_messages"
  ADD CONSTRAINT "service_order_messages_service_order_id_fkey"
  FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_order_messages"
  ADD CONSTRAINT "service_order_messages_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Anexos ──────────────────────────────────────────────────────────────────
CREATE TABLE "service_order_attachments" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "service_order_id" UUID NOT NULL,
  "storage_key" VARCHAR(512) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(120),
  "size_bytes" INTEGER,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_order_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "so_attachments_tenant_so_created_idx"
  ON "service_order_attachments"("tenant_id", "service_order_id", "created_at");

ALTER TABLE "service_order_attachments"
  ADD CONSTRAINT "service_order_attachments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_order_attachments"
  ADD CONSTRAINT "service_order_attachments_service_order_id_fkey"
  FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_order_attachments"
  ADD CONSTRAINT "service_order_attachments_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
