-- JID real do WhatsApp no contato (@c.us ou @lid). Necessário para responder no
-- destino correto: o WhatsApp às vezes entrega o remetente como LID (@lid), e
-- responder remontando <digits>@c.us não entrega. Guardamos o JID e respondemos nele.
ALTER TABLE "whatsapp_contacts" ADD COLUMN "wa_chat_id" VARCHAR(80);
