-- Correlação com a Planta de rede do NetX Core.
--
-- Os bancos são separados por decisão de arquitetura: o NMS roda TimescaleDB
-- próprio para as séries em metrics.* (8 hypertables), e o Core é Postgres
-- puro. Sem FK possível, a correlação é este id.
--
-- Por que não casar por mgmtIp: o IP de gerência muda (renumeração, troca de
-- VLAN, migração de POP) e aí o vínculo se perderia silenciosamente, voltando
-- ao problema dos dois cadastros paralelos. O id do equipamento não muda.
--
-- UNIQUE garante que o upsert do Core seja idempotente: reenviar o mesmo
-- equipamento (retry, reconciliação, edição) nunca cria device duplicado.
ALTER TABLE "device" ADD COLUMN "core_equipment_id" UUID;
CREATE UNIQUE INDEX "device_core_equipment_id_key" ON "device"("core_equipment_id");
