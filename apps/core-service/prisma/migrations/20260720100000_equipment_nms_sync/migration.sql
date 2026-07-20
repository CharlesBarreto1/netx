-- Planta de rede → NMS: espelhar equipamento como device monitorado.
--
-- Opt-in por equipamento (`nms_monitored`): o NMS só tem driver pra juniper,
-- mikrotik e cisco_iosxe. Propagar Huawei/ZTE/FiberHome criaria device que ele
-- não consegue coletar — inventário mentindo, que é o oposto do objetivo.
--
-- Sem FK pro NMS: os bancos são separados por decisão de arquitetura (o NMS
-- roda TimescaleDB próprio pras séries em metrics.*, extensão que nem está
-- disponível no Postgres do Core). `nms_device_id` é só o id espelhado; a
-- correlação estável mora do outro lado, em device.core_equipment_id.
--
-- `nms_sync_error` existe porque a propagação NÃO bloqueia o cadastro (mesma
-- política do sync com RADIUS): sem este campo, uma falha de sync seria
-- silenciosa e o operador só descobriria pela ausência no NMS.
ALTER TABLE "network_equipment" ADD COLUMN "nms_monitored" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "network_equipment" ADD COLUMN "nms_device_id" UUID;
ALTER TABLE "network_equipment" ADD COLUMN "nms_synced_at" TIMESTAMP(3);
ALTER TABLE "network_equipment" ADD COLUMN "nms_sync_error" TEXT;

-- Alimenta a reconciliação (_resync-nms), que varre só os marcados.
CREATE INDEX "network_equipment_tenant_nms_monitored_idx"
  ON "network_equipment"("tenant_id", "nms_monitored");
