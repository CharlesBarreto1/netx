-- NetX Field (offline-first) — idempotência de requisições reenviadas pela outbox.
-- Dedupe por (tenant_id, key): op já completada devolve a resposta guardada em
-- vez de reaplicar (nunca reconsome material num retry). Ver IdempotencyInterceptor.

CREATE TABLE "idempotency_keys" (
  "id"            UUID         NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"     UUID         NOT NULL,
  "user_id"       UUID,
  "key"           VARCHAR(200) NOT NULL,
  "method"        VARCHAR(8)   NOT NULL,
  "path"          VARCHAR(500) NOT NULL,
  "status"        VARCHAR(16)  NOT NULL,
  "status_code"   INTEGER,
  "response_body" JSONB,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_keys_tenant_key_uq" ON "idempotency_keys" ("tenant_id", "key");
CREATE INDEX "idempotency_keys_tenant_created_idx" ON "idempotency_keys" ("tenant_id", "created_at");

ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_tenant_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (obrigatório p/ tabela multi-tenant nova — usa o helper app_current_tenant_id()).
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "idempotency_keys_tenant_isolation" ON "idempotency_keys"
  USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())
  WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id());
