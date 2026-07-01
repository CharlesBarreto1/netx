-- Atendimento compartilhado de GRUPOS (NOC): vários operadores podem "entrar"
-- numa conversa de grupo simultaneamente. Só membros respondem e são notificados.
CREATE TABLE "whatsapp_conversation_members" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_conversation_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_conversation_members_conversation_id_user_id_key"
    ON "whatsapp_conversation_members"("conversation_id", "user_id");

CREATE INDEX "whatsapp_conversation_members_user_id_idx"
    ON "whatsapp_conversation_members"("user_id");

ALTER TABLE "whatsapp_conversation_members"
    ADD CONSTRAINT "whatsapp_conversation_members_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_conversation_members"
    ADD CONSTRAINT "whatsapp_conversation_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
