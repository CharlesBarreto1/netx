-- Classificação operacional do motivo da O.S (instalação / suporte / retirada),
-- pra ramificar o fluxo da tela de campo (/os).
CREATE TYPE "ServiceOrderReasonKind" AS ENUM ('INSTALLATION', 'SUPPORT', 'RETRIEVAL');

ALTER TABLE "service_order_reasons"
  ADD COLUMN "kind" "ServiceOrderReasonKind" NOT NULL DEFAULT 'SUPPORT';

-- Backfill: motivos já marcados como instalação viram INSTALLATION; resto SUPPORT.
UPDATE "service_order_reasons" SET "kind" = 'INSTALLATION' WHERE "is_installation" = true;
