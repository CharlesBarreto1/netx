-- R4 — Fusões/emendas de fibra (FiberSplice).
-- Doc: docs/architecture/osp-network.md
--
-- Loss em DECIMAL(4,2) cobre 0.00..99.99 dB (mais que suficiente — fusão
-- decente fica <0.3 dB; >5 dB = problema crítico).
-- ON DELETE Restrict nos cabos: não apaga cabo se há fusão referenciando
-- (operador precisa apagar splices antes — evita "fibra orfã" no R5).

CREATE TABLE "fiber_splices" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,

  "latitude"          DECIMAL(9, 6) NOT NULL,
  "longitude"         DECIMAL(9, 6) NOT NULL,

  "cable_a_id"        UUID NOT NULL REFERENCES "fiber_cables"("id") ON DELETE RESTRICT,
  "fiber_a_index"     INTEGER NOT NULL CHECK ("fiber_a_index" >= 1),

  "cable_b_id"        UUID NOT NULL REFERENCES "fiber_cables"("id") ON DELETE RESTRICT,
  "fiber_b_index"     INTEGER NOT NULL CHECK ("fiber_b_index" >= 1),

  -- Atenuação (dB). Default 0.1 só na UI; backend permite NULL pra "não medido".
  "loss_db"           DECIMAL(4, 2) CHECK ("loss_db" >= 0 AND "loss_db" < 100),

  "photo_url"         VARCHAR(2000),
  "measured_at"       TIMESTAMP(3),
  "measured_by_id"    UUID REFERENCES "users"("id") ON DELETE SET NULL,

  "notes"             TEXT,

  "created_by_id"     UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_id"     UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  "deleted_at"        TIMESTAMP(3),

  -- Auto-fusão (cabo A == cabo B com fibras diferentes) é raro mas legítimo
  -- em pigtails de bandeja — não bloqueamos. Já fusão da mesma fibra com
  -- ela mesma (cableA=cableB E fiberA=fiberB) sim é nonsense, validado no service.
  CHECK (NOT ("cable_a_id" = "cable_b_id" AND "fiber_a_index" = "fiber_b_index"))
);

-- Index dual por lado A/B — R5 power budget faz traversal de grafo
-- buscando "todas as splices envolvendo fibra X do cabo Y".
CREATE INDEX "fiber_splices_tenant_cable_a_fiber_idx"
  ON "fiber_splices" ("tenant_id", "cable_a_id", "fiber_a_index");
CREATE INDEX "fiber_splices_tenant_cable_b_fiber_idx"
  ON "fiber_splices" ("tenant_id", "cable_b_id", "fiber_b_index");
