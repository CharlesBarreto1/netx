-- Auditoria de edição de compra: registra quem fez a ÚLTIMA edição do
-- lançamento (NULL = nunca editada). A trilha completa (o que mudou, quando,
-- por quem — toda edição) fica no audit_logs (action = 'purchase.updated').
ALTER TABLE "purchases"
    ADD COLUMN IF NOT EXISTS "updated_by_id" UUID
    REFERENCES "users"("id") ON DELETE RESTRICT;
