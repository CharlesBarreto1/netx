-- =============================================================================
-- NetX — Postgres initialization
-- Runs once when the postgres container is bootstrapped with an empty volume.
-- =============================================================================

-- Enable commonly used extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";        -- case-insensitive text (emails)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- trigram search
CREATE EXTENSION IF NOT EXISTS "unaccent";      -- search accent-insensitive
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Audit schema for append-only audit logs (optional, kept separate from
-- the main schema so retention policies can differ).
CREATE SCHEMA IF NOT EXISTS audit;

-- NMS module schema (ecossistema modular, invariante 3 — cada módulo é dono
-- exclusivo do seu schema). O NMS conecta com ?schema=nms e o Prisma dele cria
-- as tabelas aqui. Criado aqui também pra dev que não usa o profile ecosystem.
-- Ver docs/ecosystem/INTEGRATION-RUNBOOK.md §A.
CREATE SCHEMA IF NOT EXISTS nms;

-- Application role used by the NestJS services (Prisma connects as this user).
-- The superuser 'netx' created by POSTGRES_USER already has full privileges
-- in dev. In staging/prod, create a separate least-privilege role.

-- Placeholder for Row-Level Security policies. The actual policies are defined
-- by Prisma migrations once the tables exist (see apps/core-service/prisma).
