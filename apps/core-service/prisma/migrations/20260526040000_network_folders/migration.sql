-- R4.5e — Pastas pra organização administrativa da planta.
-- Doc: docs/architecture/osp-network.md
--
-- Cada caixa/cabo pode estar em UMA pasta (FK opcional). Pasta tem
-- hierarquia (parentId auto-ref). Cliente vê só itens das pastas que
-- ele selecionou — útil pra equipes regionais ou separação por projeto.

CREATE TABLE "network_folders" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "parent_id"     UUID REFERENCES "network_folders"("id") ON DELETE SET NULL,
  "name"          VARCHAR(120) NOT NULL,
  "color"         VARCHAR(7),
  "position"      INTEGER NOT NULL DEFAULT 0,
  "notes"         TEXT,
  "created_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "deleted_at"    TIMESTAMP(3)
);

CREATE INDEX "network_folders_tenant_parent_idx"
  ON "network_folders" ("tenant_id", "parent_id");

-- ── FK em caixas e cabos ────────────────────────────────────────────────────
ALTER TABLE "optical_enclosures"
  ADD COLUMN "folder_id" UUID REFERENCES "network_folders"("id") ON DELETE SET NULL;

CREATE INDEX "optical_enclosures_tenant_folder_idx"
  ON "optical_enclosures" ("tenant_id", "folder_id");

ALTER TABLE "fiber_cables"
  ADD COLUMN "folder_id" UUID REFERENCES "network_folders"("id") ON DELETE SET NULL;

CREATE INDEX "fiber_cables_tenant_folder_idx"
  ON "fiber_cables" ("tenant_id", "folder_id");
