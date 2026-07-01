-- Respostas rápidas (mensagens predefinidas) do atendimento WhatsApp.
-- owner_user_id NULL = biblioteca compartilhada da equipe (gerida em
-- Configurações por chat.admin); preenchido = resposta pessoal do operador.
CREATE TABLE "whatsapp_quick_replies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_user_id" UUID,
    "category" VARCHAR(40) NOT NULL DEFAULT 'geral',
    "title" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "shortcut" VARCHAR(40),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_quick_replies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_quick_replies_tenant_id_owner_user_id_idx"
    ON "whatsapp_quick_replies"("tenant_id", "owner_user_id");

ALTER TABLE "whatsapp_quick_replies"
    ADD CONSTRAINT "whatsapp_quick_replies_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_quick_replies"
    ADD CONSTRAINT "whatsapp_quick_replies_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
