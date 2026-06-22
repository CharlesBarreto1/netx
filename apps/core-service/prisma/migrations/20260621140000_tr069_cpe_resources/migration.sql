-- AlterTable: recursos do CPE (DeviceInfo) na série de diagnóstico
ALTER TABLE "tr069_diagnostics" ADD COLUMN     "cpu_usage" INTEGER,
ADD COLUMN     "device_temp" INTEGER,
ADD COLUMN     "mem_usage" INTEGER;
