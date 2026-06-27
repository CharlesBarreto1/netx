-- Templates HSM aprovados na Meta (canal META_CLOUD). Tenant-scoped com RLS,
-- consistente com as demais tabelas whatsapp_*.

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "instance_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "language" VARCHAR(10) NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "body_text" TEXT,
    "components" JSONB,
    "meta_template_id" VARCHAR(60),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_tenant_id_name_language_key" ON "whatsapp_templates"("tenant_id", "name", "language");
CREATE INDEX "whatsapp_templates_tenant_id_status_idx" ON "whatsapp_templates"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (isolamento por tenant) — mesmo padrão das outras tabelas whatsapp_*.
ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "whatsapp_templates"
  USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
  WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());
