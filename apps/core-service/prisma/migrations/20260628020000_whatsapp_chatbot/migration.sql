-- Chatbot de atendimento (WhatsApp). Híbrido: menu determinístico + IA agêntica.
-- O bot só conduz conversas sem atendente humano; ações de escrita são autônomas
-- porém auditadas.

-- Config por tenant.
CREATE TABLE "whatsapp_bot_configs" (
  "id"            UUID NOT NULL,
  "tenant_id"     UUID NOT NULL,
  "enabled"       BOOLEAN NOT NULL DEFAULT false,
  "ai_enabled"    BOOLEAN NOT NULL DEFAULT false,
  "greeting"      TEXT,
  "menu_json"     JSONB,
  "fallback_text" TEXT,
  "handoff_text"  TEXT,
  "unknown_text"  TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_bot_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_bot_configs_tenant_id_key"
  ON "whatsapp_bot_configs" ("tenant_id");

ALTER TABLE "whatsapp_bot_configs"
  ADD CONSTRAINT "whatsapp_bot_configs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Estado do bot na conversa.
ALTER TABLE "whatsapp_conversations"
  ADD COLUMN "bot_active" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_conversations"
  ADD COLUMN "bot_context" JSONB;

-- Mensagem enviada pelo bot (não por humano).
ALTER TABLE "whatsapp_messages"
  ADD COLUMN "is_bot" BOOLEAN NOT NULL DEFAULT false;
