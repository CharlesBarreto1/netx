-- Sequencial curto por tenant pro externalId/marquilla drop (ZUX-1, ZUX-2, …).
-- `seq` é nullable: linhas legadas (testes anteriores com externalId longo) ficam
-- com seq NULL e não entram no MAX(), então o próximo contrato começa em 1.
-- O índice único permite múltiplos NULL (comportamento padrão do Postgres).
ALTER TABLE "ufinet_services" ADD COLUMN "seq" INTEGER;

CREATE UNIQUE INDEX "ufinet_services_tenant_id_seq_key"
  ON "ufinet_services" ("tenant_id", "seq");
