-- Estoque Fase 3 — bem próprio instalado na rede (POP / equipamento da planta).
--
-- Até aqui o estoque só sabia entregar equipamento ao CLIENTE: ALLOCATED exige
-- contract_id. Bem da própria operação instalado num POP não tinha como ser
-- representado — ficava eternamente IN_STOCK (mentira contábil, o saldo
-- disponível contava um roteador que está em produção há meses) ou saía por
-- ADJUSTMENT_OUT (sumia do patrimônio). IN_USE fecha esse buraco.
--
-- Também liga "Técnico > Planta de rede > Equipamentos" ao estoque: até aqui
-- network_equipment não tinha sequer campo de número de série, então não havia
-- como saber QUAL bem físico era cada equipamento cadastrado.

ALTER TYPE "SerialStatus"  ADD VALUE IF NOT EXISTS 'IN_USE';
ALTER TYPE "MovementType"  ADD VALUE IF NOT EXISTS 'DEPLOY_OUT';
ALTER TYPE "MovementType"  ADD VALUE IF NOT EXISTS 'DEPLOY_RETURN';

-- ── Destino "rede própria" no bem ────────────────────────────────────────────
ALTER TABLE "serial_items" ADD COLUMN "pop_id" UUID;
ALTER TABLE "serial_items" ADD COLUMN "network_equipment_id" UUID;
ALTER TABLE "serial_items" ADD COLUMN "deployed_at" TIMESTAMP(3);

-- SET NULL nos dois: apagar o POP ou o equipamento não pode sumir com o bem do
-- patrimônio. Ele fica IN_USE "órfão" e o operador devolve ao estoque ou
-- re-vincula — mesma filosofia do R8.2 / netx_olt_id / netx_pop_id.
ALTER TABLE "serial_items"
  ADD CONSTRAINT "serial_items_pop_id_fkey"
  FOREIGN KEY ("pop_id") REFERENCES "network_pops"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "serial_items"
  ADD CONSTRAINT "serial_items_network_equipment_id_fkey"
  FOREIGN KEY ("network_equipment_id") REFERENCES "network_equipment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 1:1 com a planta — um equipamento cadastrado É um bem físico. Sem esta trava,
-- dois seriais poderiam reivindicar o mesmo equipamento e o patrimônio ficaria
-- ambíguo. NULLs não conflitam entre si no Postgres, então o acervo sem vínculo
-- (e todo equipamento legado) passa sem backfill.
CREATE UNIQUE INDEX "serial_items_network_equipment_id_key"
  ON "serial_items"("network_equipment_id");

-- "Que bens estão neste POP?" — pergunta de inventário de campo.
CREATE INDEX "serial_items_tenant_id_pop_id_idx"
  ON "serial_items"("tenant_id", "pop_id");

-- ── Rastro do movimento ──────────────────────────────────────────────────────
-- Quarta referência polimórfica do kardex, ao lado de purchase/contract/
-- service_order: DEPLOY_OUT e DEPLOY_RETURN apontam pro POP.
ALTER TABLE "stock_movements" ADD COLUMN "pop_id" UUID;
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_pop_id_fkey"
  FOREIGN KEY ("pop_id") REFERENCES "network_pops"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Depósito dentro de um POP ────────────────────────────────────────────────
-- Responde "o que tem de estoque neste POP" sem depender de convenção de
-- nomenclatura no código do local.
ALTER TABLE "stock_locations" ADD COLUMN "pop_id" UUID;
ALTER TABLE "stock_locations"
  ADD CONSTRAINT "stock_locations_pop_id_fkey"
  FOREIGN KEY ("pop_id") REFERENCES "network_pops"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
