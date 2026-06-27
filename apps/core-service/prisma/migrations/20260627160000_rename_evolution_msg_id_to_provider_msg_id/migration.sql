-- Generaliza o id de mensagem do provider (Evolution -> WAHA | Meta).
-- Rename puro de coluna + índice: preserva dados e unicidade. Aditivo: template_name.

ALTER TABLE "whatsapp_messages" RENAME COLUMN "evolution_msg_id" TO "provider_msg_id";
ALTER INDEX "whatsapp_messages_evolution_msg_id_key" RENAME TO "whatsapp_messages_provider_msg_id_key";
ALTER TABLE "whatsapp_messages" ADD COLUMN "template_name" VARCHAR(120);
