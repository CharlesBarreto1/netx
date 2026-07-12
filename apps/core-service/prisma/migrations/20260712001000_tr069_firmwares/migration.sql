-- =============================================================================
-- Catálogo de firmware TR-069 — imagem por fabricante/modelo.
-- =============================================================================
-- Arquivo fica em disco (TR069_FIRMWARE_DIR, default /var/lib/netx/firmware,
-- nome <id>.bin) e é servido ao CPE pelo cwmp-server em GET /fw/{id} — mesma
-- origem HTTP que o CPE já alcança pro ACS (:7547), sem tocar nginx/MinIO.
-- O rollout cria Tr069Tasks DOWNLOAD com payload.firmwareId.

-- CreateTable
CREATE TABLE "tr069_firmwares" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vendor" VARCHAR(16) NOT NULL,
    "product_class" VARCHAR(64) NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tr069_firmwares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tr069_firmwares_tenant_id_vendor_product_class_idx" ON "tr069_firmwares"("tenant_id", "vendor", "product_class");

-- AddForeignKey
ALTER TABLE "tr069_firmwares" ADD CONSTRAINT "tr069_firmwares_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
