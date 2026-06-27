-- Canal de transporte da instância + campos do canal oficial Meta Cloud API.
-- Aditivo e retrocompatível: instâncias existentes recebem channel = WAHA.

-- CreateEnum
CREATE TYPE "WaChannel" AS ENUM ('WAHA', 'META_CLOUD');

-- AlterTable
ALTER TABLE "whatsapp_instances"
  ADD COLUMN "channel" "WaChannel" NOT NULL DEFAULT 'WAHA',
  ADD COLUMN "waba_id" VARCHAR(40),
  ADD COLUMN "phone_number_id" VARCHAR(40),
  ADD COLUMN "verify_token" VARCHAR(120),
  ADD COLUMN "api_credentials_enc" TEXT;

-- api_key agora guarda ciphertext (base64url v1:iv:tag:ct) — pode passar de 255.
ALTER TABLE "whatsapp_instances" ALTER COLUMN "api_key" TYPE TEXT;

-- phone_number_id é único globalmente (defesa cross-tenant no webhook Meta).
-- Coluna nullable: Postgres permite múltiplos NULL, instâncias WAHA não colidem.
CREATE UNIQUE INDEX "whatsapp_instances_phone_number_id_key" ON "whatsapp_instances"("phone_number_id");
