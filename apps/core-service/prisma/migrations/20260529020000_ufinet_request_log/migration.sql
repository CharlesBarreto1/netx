-- Trilha de request/response NetX↔Ufinet (evidência pra chamados). Sem segredos.
CREATE TABLE "ufinet_request_logs" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"     UUID NOT NULL,
  "external_id"   VARCHAR(80) NOT NULL,
  "method"        VARCHAR(8) NOT NULL,
  "path"          VARCHAR(255) NOT NULL,
  "status"        INTEGER,
  "duration_ms"   INTEGER NOT NULL,
  "request_body"  JSONB,
  "response_body" JSONB,
  "error"         TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ufinet_request_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ufinet_request_logs_tenant_id_external_id_created_at_idx"
  ON "ufinet_request_logs" ("tenant_id", "external_id", "created_at");
