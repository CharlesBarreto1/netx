-- FiberMap — vínculo device OLT ↔ OLT do inventário (/olts), spec §11.
-- Coluna real (não metadata.netx_olt_id) pra ter FK de integridade e a trava
-- de unicidade: uma OLT do inventário só pode estar colocada em UM elemento
-- vivo da planta (POP/Armário). A regra de negócio (tipo do elemento, erro
-- amigável) fica no service; o índice é a rede de segurança sob concorrência.

ALTER TABLE "fibermap_devices" ADD COLUMN "netx_olt_id" UUID;

-- SET NULL: excluir a OLT do inventário não destrói o desenho da planta —
-- o device vira "sem vínculo" e o operador re-vincula depois (filosofia R8.2).
ALTER TABLE "fibermap_devices"
  ADD CONSTRAINT "fibermap_devices_netx_olt_id_fkey"
  FOREIGN KEY ("netx_olt_id") REFERENCES "olts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Parcial: soft-delete (deleted_at) libera a OLT pra ser colocada de novo.
CREATE UNIQUE INDEX "fibermap_devices_netx_olt_uniq"
  ON "fibermap_devices"("netx_olt_id")
  WHERE "deleted_at" IS NULL;
