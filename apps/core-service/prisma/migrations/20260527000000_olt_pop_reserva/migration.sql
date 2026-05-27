-- R8.2 — Reserva técnica como tipo próprio + Olt.popId.
-- Doc: docs/architecture/osp-network.md
--
-- Reserva = sobra de cabo enrolada no poste (10-30m guardados pra reparos
-- futuros). Antes era CTO marcada via notes; agora é tipo dedicado.
--
-- Olt.popId vincula a OLT ao POP físico onde está instalada — operador
-- gerencia tudo do POP num lugar só (estúdio de mapeamento R8.1+).

-- ── Adiciona valor RESERVA ao enum OpticalEnclosureType ─────────────────────
ALTER TYPE "OpticalEnclosureType" ADD VALUE 'RESERVA';

-- ── OLT.pop_id (FK opcional → network_pops) ─────────────────────────────────
ALTER TABLE "olts"
  ADD COLUMN "pop_id" UUID REFERENCES "network_pops"("id") ON DELETE SET NULL;

CREATE INDEX "olts_tenant_pop_idx" ON "olts" ("tenant_id", "pop_id");
