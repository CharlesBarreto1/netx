-- R4.5a — Pontas físicas do cabo (endpointA/B → OpticalEnclosure).
-- Doc: docs/architecture/osp-network.md
--
-- Sem isso, o cabo flutua sem topologia conhecida e a vista esquemática
-- (R4.5b) não pode renderizar "cabos entrando nesta caixa". Também é
-- pré-requisito pro power budget (R5) que traversa caixa→cabo→caixa.
-- Nullable: cabos existentes ficam órfãos até operador associar.
-- SetNull em delete: caixa apagada não cascateia em cabo apagado.

ALTER TABLE "fiber_cables"
  ADD COLUMN "endpoint_a_id" UUID REFERENCES "optical_enclosures"("id") ON DELETE SET NULL,
  ADD COLUMN "endpoint_b_id" UUID REFERENCES "optical_enclosures"("id") ON DELETE SET NULL;

CREATE INDEX "fiber_cables_tenant_endpoint_a_idx"
  ON "fiber_cables" ("tenant_id", "endpoint_a_id");
CREATE INDEX "fiber_cables_tenant_endpoint_b_idx"
  ON "fiber_cables" ("tenant_id", "endpoint_b_id");
