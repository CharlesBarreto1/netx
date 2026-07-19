-- FiberMap — vínculo elemento POP ↔ POP da planta de rede (/network/pops).
--
-- Espelha 20260706150000_fibermap_olt_binding. Até aqui o FiberMap tinha o
-- valor POP no enum de tipo de elemento, mas nenhuma FK para network_pops:
-- cadastrar um POP em Técnico > Planta de rede e desenhá-lo no mapa eram dois
-- cadastros independentes, com nome, endereço e coordenada próprios, livres
-- para divergir em silêncio.
--
-- Coluna real (não metadata) pra ter FK de integridade e a trava de unicidade.
-- A regra de negócio (só type=POP aceita vínculo, erro amigável) fica no
-- service; o índice é a rede de segurança sob concorrência.

ALTER TABLE "fibermap_elements" ADD COLUMN "netx_pop_id" UUID;

-- SET NULL: excluir o POP do inventário não destrói o desenho da planta —
-- o elemento vira "sem vínculo" e o operador re-vincula depois (filosofia R8.2).
ALTER TABLE "fibermap_elements"
  ADD CONSTRAINT "fibermap_elements_netx_pop_id_fkey"
  FOREIGN KEY ("netx_pop_id") REFERENCES "network_pops"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Parcial: soft-delete (deleted_at) libera o POP pra ser colocado de novo.
CREATE UNIQUE INDEX "fibermap_elements_netx_pop_uniq"
  ON "fibermap_elements"("netx_pop_id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "fibermap_elements_netx_pop_id_idx"
  ON "fibermap_elements"("netx_pop_id");
