-- Preferências do operador no Chat/Atendimento (saudação automática + mostrar nome).
-- JSON único pra evitar tabela nova; lido/escrito pelo módulo whatsapp.
ALTER TABLE "users" ADD COLUMN "chat_prefs" JSONB;
