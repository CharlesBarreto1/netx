-- =============================================================================
-- Migração: adicionar `users.must_change_password`
--
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Quando true, o login bem-sucedido devolve um claim que faz o frontend
-- redirecionar pra /first-login. Limpado pelo endpoint POST
-- /v1/users/me/change-password.
--
-- Idempotente via IF NOT EXISTS (Postgres 9.6+).
-- =============================================================================

ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;
