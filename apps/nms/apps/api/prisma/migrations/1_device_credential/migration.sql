-- Troca credentials_ref por tabela device_credential (ADR 0002).
-- NOTA: as tabelas de métricas do Telegraf vivem no schema `metrics` (não em `public`),
-- por isso o Prisma não as gerencia e não devem ser dropadas aqui.

ALTER TABLE "device" DROP COLUMN "credentials_ref";

-- CreateTable
CREATE TABLE "device_credential" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_enc" TEXT,
    "ssh_key_enc" TEXT,
    "snmp_community_enc" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_credential_device_id_key" ON "device_credential"("device_id");

-- AddForeignKey
ALTER TABLE "device_credential" ADD CONSTRAINT "device_credential_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
