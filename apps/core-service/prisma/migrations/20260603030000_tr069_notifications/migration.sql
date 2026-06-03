-- AlterEnum
ALTER TYPE "Tr069TaskAction" ADD VALUE 'SET_ATTRIBUTES';

-- AlterTable
ALTER TABLE "tr069_devices" ADD COLUMN     "notifications_armed_at" TIMESTAMP(3);

