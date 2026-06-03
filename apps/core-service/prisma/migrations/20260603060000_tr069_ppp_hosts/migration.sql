-- AlterEnum
ALTER TYPE "Tr069AlertType" ADD VALUE 'WAN_DOWN';

-- AlterTable
ALTER TABLE "tr069_diagnostics" ADD COLUMN     "hosts" JSONB,
ADD COLUMN     "hosts_count" INTEGER,
ADD COLUMN     "ppp_last_error" VARCHAR(64),
ADD COLUMN     "ppp_status" VARCHAR(32),
ADD COLUMN     "wan_uptime" INTEGER;

