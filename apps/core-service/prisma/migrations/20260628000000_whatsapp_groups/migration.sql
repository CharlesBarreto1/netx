-- Leitura de grupos do WhatsApp (canal WAHA / QR).
-- Grupos são opt-in por instância: por padrão o NetX continua ignorando @g.us
-- para não inundar a fila de atendimento. Quando ligado, as mensagens de grupo
-- viram conversas (contato isGroup) e cada mensagem guarda quem a enviou.

-- Opt-in por instância.
ALTER TABLE "whatsapp_instances"
  ADD COLUMN "capture_groups" BOOLEAN NOT NULL DEFAULT false;

-- Contato pode representar um grupo. Grupo não tem telefone (phone_e164 fica
-- null) e é identificado pelo JID do grupo (wa_group_id, ex.: 1203...@g.us).
ALTER TABLE "whatsapp_contacts"
  ALTER COLUMN "phone_e164" DROP NOT NULL;
ALTER TABLE "whatsapp_contacts"
  ADD COLUMN "is_group" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_contacts"
  ADD COLUMN "wa_group_id" VARCHAR(80);

-- Um grupo por (tenant, JID). Nulos são distintos no Postgres, então contatos
-- normais (wa_group_id null) não conflitam.
CREATE UNIQUE INDEX "whatsapp_contacts_tenant_id_wa_group_id_key"
  ON "whatsapp_contacts" ("tenant_id", "wa_group_id");

-- Autor da mensagem dentro do grupo (o participante que enviou).
ALTER TABLE "whatsapp_messages"
  ADD COLUMN "author_name" VARCHAR(255);
ALTER TABLE "whatsapp_messages"
  ADD COLUMN "author_phone" VARCHAR(20);
