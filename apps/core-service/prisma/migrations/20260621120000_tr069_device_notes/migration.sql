-- CreateTable
CREATE TABLE "tr069_device_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_by_email" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tr069_device_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tr069_device_notes_tenant_id_device_id_deleted_at_idx" ON "tr069_device_notes"("tenant_id", "device_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "tr069_device_notes" ADD CONSTRAINT "tr069_device_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tr069_device_notes" ADD CONSTRAINT "tr069_device_notes_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "tr069_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

