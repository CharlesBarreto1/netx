-- Forma de cobrança BR por CONTRATO (substitui a escolha por-tenant).
-- MANUAL = sem gateway; EFI/BTG fazem a fatura nascer já no gateway.
-- Contratos existentes ficam MANUAL (default) — opt-in por edição.

-- CreateEnum
CREATE TYPE "BrBillingGateway" AS ENUM ('MANUAL', 'EFI', 'BTG');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "br_billing_gateway" "BrBillingGateway" NOT NULL DEFAULT 'MANUAL';
