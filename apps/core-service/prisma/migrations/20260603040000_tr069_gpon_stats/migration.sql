-- AlterTable
ALTER TABLE "tr069_diagnostics" ADD COLUMN     "drop_rate" DECIMAL(8,3),
ADD COLUMN     "error_rate" DECIMAL(8,3),
ADD COLUMN     "fec_errors" BIGINT,
ADD COLUMN     "gpon_status" VARCHAR(16),
ADD COLUMN     "hec_errors" BIGINT;

