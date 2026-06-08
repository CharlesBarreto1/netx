-- Etapa 1 do one-touch de instalação: marca a O.S como provisionada em campo,
-- aguardando o técnico confirmar o cliente online e fechar (etapa 2).

ALTER TABLE "service_orders"
  ADD COLUMN IF NOT EXISTS "field_provisioned_at" TIMESTAMP(3);
