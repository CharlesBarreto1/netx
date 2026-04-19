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

-- Application role used by the NestJS services (Prisma connects as this user).
-- The superuser 'netx' created by POSTGRES_USER already has full privileges
-- in dev. In staging/prod, create a separate least-privilege role.

-- Placeholder for Row-Level Security policies. The actual policies are defined
-- by Prisma migrations once the tables exist (see apps/core-service/prisma).
