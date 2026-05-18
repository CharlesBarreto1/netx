-- =============================================================================
-- Row-Level Security (RLS): isolamento multi-tenant via Postgres policies.
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- Defense-in-depth: até hoje o isolamento dependia 100% do app sempre incluir
-- `WHERE tenant_id = ?` em cada query. Um esquecimento, um raw query ou um
-- SQL injection contornam tudo. Esta migration ativa RLS no Postgres: o banco
-- recusa linhas de outros tenants mesmo se a query não filtrar.
--
-- Como funciona:
--   1. Cada request seta a session var `app.tenant_id` (feito pelo Prisma
--      extension em src/modules/prisma/prisma.service.ts).
--   2. Todas as policies fazem `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`.
--   3. Quando a var NÃO está setada (current_setting retorna NULL com o flag
--      `true`), a policy permite — usado em migrations e scripts admin.
--   4. `FORCE ROW LEVEL SECURITY` aplica RLS até pro table owner (sem isso,
--      o role `netx` que é dono das tabelas escaparia).
--
-- Bypass para migrations: o segundo arg de `current_setting('x', true)` faz
-- retornar NULL se a var não existe (ao invés de raise). Migrations rodam sem
-- setar app.tenant_id → policy permite tudo. ATENÇÃO: isso significa que um
-- atacante com SQL injection que NÃO seta app.tenant_id também bypassa.
-- Mitigação real seria role separado `netx_app` sem BYPASSRLS — futuro work.
-- =============================================================================

-- Helper function: extrai tenant_id da session OU retorna NULL se não setado.
-- A flag `true` no segundo arg evita erro quando a var nunca foi SET.
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- =============================================================================
-- Macro: ativa RLS + FORCE + cria policy de isolamento em cada tabela.
-- Tabelas com tenant_id NOT NULL: filtro estrito.
-- Tabelas com tenant_id NULLABLE (roles globais, audit_logs sistema): permite
-- NULL passar (são "globais").
-- =============================================================================

-- Tabelas com tenant_id NOT NULL (filtro estrito) -----------------------------
DO $$
DECLARE
  t text;
  strict_tables text[] := ARRAY[
    'tenant_settings',
    'tenant_features',
    'users',
    'sessions',
    'api_keys',
    'customers',
    'customer_addresses',
    'customer_contacts',
    'customer_tags',
    'customer_tag_assignments',
    'customer_consents',
    'customer_notes',
    'pipelines',
    'pipeline_stages',
    'deals',
    'deal_history',
    'activities',
    'contracts',
    'contract_invoices',
    'radius_events',
    'service_order_reasons',
    'service_orders',
    'cash_registers',
    'one_time_charges',
    'cash_movements',
    'backups',
    'network_pops',
    'network_equipment',
    'whatsapp_instances',
    'whatsapp_contacts',
    'whatsapp_conversations',
    'sifen_documents'
  ];
BEGIN
  FOREACH t IN ARRAY strict_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id()) '
      'WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id = app_current_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- Tabelas com tenant_id NULLABLE (NULL = global/sistema) ----------------------
-- Roles globais (tenantId IS NULL) são visíveis a todos os tenants — read-only
-- via app code. AuditLog system-level também.
DO $$
DECLARE
  t text;
  nullable_tables text[] := ARRAY['roles', 'audit_logs'];
BEGIN
  FOREACH t IN ARRAY nullable_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (app_current_tenant_id() IS NULL OR tenant_id IS NULL OR tenant_id = app_current_tenant_id()) '
      'WITH CHECK (app_current_tenant_id() IS NULL OR tenant_id IS NULL OR tenant_id = app_current_tenant_id())',
      t
    );
  END LOOP;
END $$;
