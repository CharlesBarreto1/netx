-- Última leitura de níveis ópticos da ONT (STATUS_ONT), persistida no serviço
-- Ufinet pra sempre exibir no contrato do cliente com timestamp.
ALTER TABLE "ufinet_services" ADD COLUMN "last_signal_levels" JSONB;
ALTER TABLE "ufinet_services" ADD COLUMN "last_signal_at" TIMESTAMP(3);
