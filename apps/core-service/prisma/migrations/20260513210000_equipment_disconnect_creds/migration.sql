-- =============================================================================
-- Multi-vendor disconnect: credenciais e estratégia por NetworkEquipment.
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Adiciona suporte a CoA/RouterOS-API/SSH por equipamento. Credenciais ficam
-- cifradas com AES-256-GCM (KMS_MASTER_KEY no .env) — esta migração só cria
-- as colunas. A camada de aplicação garante encrypt no write/decrypt no read.
-- =============================================================================

-- 1) Enum DisconnectStrategy --------------------------------------------------
CREATE TYPE "DisconnectStrategy" AS ENUM (
    'AUTO',
    'COA',
    'MIKROTIK_API',
    'SSH'
);

-- 2) Colunas em network_equipment --------------------------------------------
ALTER TABLE "network_equipment"
    ADD COLUMN "disconnect_strategy" "DisconnectStrategy" NOT NULL DEFAULT 'AUTO',
    ADD COLUMN "coa_port"            INTEGER,
    -- RouterOS API
    ADD COLUMN "api_host"            VARCHAR(255),
    ADD COLUMN "api_port"            INTEGER,
    ADD COLUMN "api_user"            VARCHAR(64),
    ADD COLUMN "api_password_enc"    TEXT,
    ADD COLUMN "api_tls_enabled"     BOOLEAN NOT NULL DEFAULT false,
    -- SSH
    ADD COLUMN "ssh_host"            VARCHAR(255),
    ADD COLUMN "ssh_port"            INTEGER DEFAULT 22,
    ADD COLUMN "ssh_user"            VARCHAR(64),
    ADD COLUMN "ssh_password_enc"    TEXT,
    ADD COLUMN "ssh_key_name"        VARCHAR(128),
    ADD COLUMN "ssh_disconnect_cmd"  TEXT,
    -- Health check
    ADD COLUMN "last_reachable_at"   TIMESTAMP(3),
    ADD COLUMN "last_reach_error"    TEXT;
