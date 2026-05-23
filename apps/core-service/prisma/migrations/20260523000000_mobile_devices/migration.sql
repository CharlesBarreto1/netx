-- =============================================================================
-- Mobile — devices pareados ao app Expo do técnico em campo
-- =============================================================================
-- Cada install do app que faz pair com um User cria uma linha aqui. Permite
-- admin revogar device perdido sem matar sessão web. lastPulledAt vai
-- alimentar o endpoint /mobile/sync/pull (Fase 1+).
-- =============================================================================

CREATE TYPE "MobilePlatform" AS ENUM ('IOS', 'ANDROID');

CREATE TABLE "mobile_devices" (
  "id"             UUID            NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"      UUID            NOT NULL,
  "user_id"        UUID            NOT NULL,

  "device_id"      VARCHAR(128)    NOT NULL,
  "platform"       "MobilePlatform" NOT NULL,
  "model"          VARCHAR(120),
  "os_version"     VARCHAR(32),
  "app_version"    VARCHAR(32)     NOT NULL,
  "push_token"     VARCHAR(255),

  "last_pulled_at" TIMESTAMP(3),
  "last_seen_at"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at"     TIMESTAMP(3),
  "revoked_reason" VARCHAR(255),

  "created_at"     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3)    NOT NULL,

  CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "mobile_devices_tenant_user_device_unique"
  ON "mobile_devices"("tenant_id", "user_id", "device_id");

CREATE INDEX IF NOT EXISTS "mobile_devices_tenant_user_idx"
  ON "mobile_devices"("tenant_id", "user_id");

CREATE INDEX IF NOT EXISTS "mobile_devices_tenant_last_seen_idx"
  ON "mobile_devices"("tenant_id", "last_seen_at");

ALTER TABLE "mobile_devices"
  ADD CONSTRAINT "mobile_devices_tenant_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mobile_devices"
  ADD CONSTRAINT "mobile_devices_user_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
