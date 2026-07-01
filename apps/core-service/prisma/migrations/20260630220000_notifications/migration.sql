-- Centro de notificações do NetX (sino global). Genérico: qualquer módulo
-- dispara (chat.mention, task.assigned, nms.alarm, ...).
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT,
    "href" VARCHAR(500),
    "icon" VARCHAR(40),
    "data" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_tenant_id_user_id_read_at_idx"
    ON "notifications"("tenant_id", "user_id", "read_at");

CREATE INDEX "notifications_user_id_created_at_idx"
    ON "notifications"("user_id", "created_at");

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
