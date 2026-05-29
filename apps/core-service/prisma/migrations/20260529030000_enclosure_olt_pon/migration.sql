-- Vínculo direto CTO→OLT(+PON) pro provisionamento. PON null quando a OLT é
-- ORCHESTRATOR (Ufinet abstrai a porta). SetNull pra não derrubar a caixa se a
-- OLT/porta for removida.
ALTER TABLE "optical_enclosures" ADD COLUMN "olt_id" UUID;
ALTER TABLE "optical_enclosures" ADD COLUMN "pon_port_id" UUID;

ALTER TABLE "optical_enclosures"
  ADD CONSTRAINT "optical_enclosures_olt_id_fkey"
  FOREIGN KEY ("olt_id") REFERENCES "olts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "optical_enclosures"
  ADD CONSTRAINT "optical_enclosures_pon_port_id_fkey"
  FOREIGN KEY ("pon_port_id") REFERENCES "pon_ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "optical_enclosures_tenant_id_olt_id_idx"
  ON "optical_enclosures" ("tenant_id", "olt_id");
