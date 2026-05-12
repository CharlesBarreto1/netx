-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TRIAL', 'CHURNED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AuditLevel" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('LEAD', 'PROSPECT', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'CHURNED');

-- CreateEnum
CREATE TYPE "TaxIdType" AS ENUM ('CPF', 'CNPJ', 'CI', 'RUC', 'VAT', 'NIF', 'RFC', 'CUIT', 'RUT', 'NIT', 'SSN', 'EIN', 'OTHER');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('BILLING', 'SERVICE', 'SHIPPING', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('EMAIL', 'PHONE', 'MOBILE', 'WHATSAPP', 'TELEGRAM', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('MARKETING_EMAIL', 'MARKETING_SMS', 'MARKETING_WHATSAPP', 'MARKETING_VOICE', 'DATA_PROCESSING', 'THIRD_PARTY_SHARING', 'CREDIT_SCORE_QUERY', 'CONTRACT_NOTIFICATION', 'SUPPORT_RECORDING', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'REVOKED', 'PENDING', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('WEB_FORM', 'EMAIL', 'IN_PERSON', 'VOICE', 'API', 'IMPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "DealLostReason" AS ENUM ('PRICE', 'COMPETITOR', 'TIMING', 'NO_BUDGET', 'NO_DECISION', 'NO_RESPONSE', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'MEETING', 'EMAIL', 'TASK', 'WHATSAPP', 'VISIT', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractAuthMethod" AS ENUM ('PPPOE', 'IPOE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractSuspendReason" AS ENUM ('MANUAL', 'OVERDUE_PAYMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "RadiusAction" AS ENUM ('AUTHORIZE', 'BLOCK', 'CANCEL', 'DISCONNECT');

-- CreateEnum
CREATE TYPE "RadiusEventStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ServiceOrderStatus" AS ENUM ('OPEN', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CashRegisterType" AS ENUM ('CASH', 'BANK', 'PIX', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "CashRegisterRole" AS ENUM ('OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PIX', 'CARD', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "OneTimeChargeStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('INCOME', 'OUTCOME', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CashMovementSource" AS ENUM ('INVOICE', 'CHARGE', 'TRANSFER', 'MANUAL');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NetworkEquipmentType" AS ENUM ('BNG', 'OLT', 'ROUTER', 'SWITCH', 'OTHER');

-- CreateEnum
CREATE TYPE "NetworkEquipmentVendor" AS ENUM ('MIKROTIK', 'HUAWEI', 'ZTE', 'FIBERHOME', 'CISCO', 'JUNIPER', 'OTHER');

-- CreateEnum
CREATE TYPE "WaInstanceStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "WaConversationStatus" AS ENUM ('OPEN', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WaMsgDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "WaMsgType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'LOCATION', 'STICKER', 'CONTACT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WaMsgStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "legal_name" VARCHAR(255),
    "tax_id" VARCHAR(32),
    "country" CHAR(2) NOT NULL,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logo_url" TEXT,
    "primary_color" VARCHAR(7),
    "trial_ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_features" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "feature" VARCHAR(128) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "password_hash" TEXT,
    "first_name" VARCHAR(120) NOT NULL,
    "last_name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(32),
    "avatar_url" TEXT,
    "locale" VARCHAR(10),
    "timezone" VARCHAR(64),
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" INET,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" TEXT,
    "mfa_backup_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "menu_access" JSONB,
    "invited_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(255),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(128) NOT NULL,
    "resource" VARCHAR(64) NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "description" VARCHAR(255),
    "module" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" VARCHAR(512),
    "ip" INET,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" VARCHAR(12) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "actor" VARCHAR(128),
    "action" VARCHAR(128) NOT NULL,
    "resource" VARCHAR(64),
    "resource_id" VARCHAR(64),
    "level" "AuditLevel" NOT NULL DEFAULT 'INFO',
    "ip" INET,
    "user_agent" VARCHAR(512),
    "before_state" JSONB,
    "after_state" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(32),
    "type" "CustomerType" NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'LEAD',
    "first_name" VARCHAR(120),
    "last_name" VARCHAR(120),
    "birth_date" DATE,
    "gender" VARCHAR(32),
    "mother_name" VARCHAR(255),
    "company_name" VARCHAR(255),
    "trade_name" VARCHAR(255),
    "founded_at" DATE,
    "state_registration" VARCHAR(64),
    "municipal_registration" VARCHAR(64),
    "display_name" VARCHAR(255) NOT NULL,
    "tax_id" VARCHAR(32),
    "tax_id_type" "TaxIdType",
    "tax_id_country" CHAR(2),
    "tax_id_verified_at" TIMESTAMP(3),
    "primary_email" CITEXT,
    "primary_phone" VARCHAR(32),
    "preferred_language" VARCHAR(10),
    "timezone" VARCHAR(64),
    "short_note" VARCHAR(500),
    "metadata" JSONB,
    "portal_access_hash" VARCHAR(255),
    "portal_access_expires_at" TIMESTAMP(3),
    "portal_last_login_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "AddressType" NOT NULL DEFAULT 'BILLING',
    "label" VARCHAR(64),
    "country" CHAR(2) NOT NULL,
    "state" VARCHAR(120),
    "city" VARCHAR(120) NOT NULL,
    "district" VARCHAR(120),
    "street" VARCHAR(255) NOT NULL,
    "number" VARCHAR(32),
    "complement" VARCHAR(120),
    "postal_code" VARCHAR(16),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "ContactType" NOT NULL,
    "label" VARCHAR(64),
    "value" VARCHAR(255) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tags" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "color" VARCHAR(7),
    "description" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tag_assignments" (
    "customer_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assigned_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_tag_assignments_pkey" PRIMARY KEY ("customer_id","tag_id")
);

-- CreateTable
CREATE TABLE "customer_consents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "ConsentMethod" NOT NULL DEFAULT 'WEB_FORM',
    "granted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "policy_version" VARCHAR(32),
    "source_ip" INET,
    "source_user_agent" VARCHAR(512),
    "evidence_url" TEXT,
    "notes" VARCHAR(500),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "author_id" UUID,
    "title" VARCHAR(255),
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "description" VARCHAR(500),
    "color" VARCHAR(7),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "order" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "color" VARCHAR(7),
    "is_won" BOOLEAN NOT NULL DEFAULT false,
    "is_lost" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "probability" INTEGER,
    "expected_close_at" DATE,
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "lost_reason" "DealLostReason",
    "lost_note" VARCHAR(500),
    "position" INTEGER NOT NULL DEFAULT 0,
    "customer_id" UUID,
    "owner_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID NOT NULL,
    "fromStatus" "DealStatus",
    "toStatus" "DealStatus" NOT NULL,
    "changed_by_id" UUID,
    "reason" VARCHAR(500),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'PENDING',
    "title" VARCHAR(255) NOT NULL,
    "notes" TEXT,
    "location" VARCHAR(255),
    "duration_min" INTEGER,
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "deal_id" UUID,
    "customer_id" UUID,
    "owner_id" UUID,
    "created_by_id" UUID,
    "completed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "code" VARCHAR(32),
    "auth_method" "ContractAuthMethod" NOT NULL DEFAULT 'IPOE',
    "pppoe_username" VARCHAR(64),
    "pppoe_password" VARCHAR(128),
    "circuit_id" VARCHAR(128),
    "remote_id" VARCHAR(128),
    "mac_address" VARCHAR(17),
    "framed_ip_address" VARCHAR(45),
    "vlan_id" INTEGER,
    "installation_address" VARCHAR(500) NOT NULL,
    "installation_maps_url" VARCHAR(500),
    "monthly_value" DECIMAL(12,2) NOT NULL,
    "bandwidth_mbps" INTEGER NOT NULL,
    "due_day" INTEGER NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspend_reason" "ContractSuspendReason",
    "activated_at" TIMESTAMP(3),
    "suspended_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "trust_extension_until" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "paid_at" TIMESTAMP(3),
    "paid_amount" DECIMAL(12,2),
    "discount_amount" DECIMAL(12,2),
    "paid_via" "PaymentMethod",
    "cash_register_id" UUID,
    "payment_note" VARCHAR(255),
    "reference" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radius_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "action" "RadiusAction" NOT NULL,
    "status" "RadiusEventStatus" NOT NULL DEFAULT 'PENDING',
    "pppoe_username" VARCHAR(128) NOT NULL,
    "target_pool" VARCHAR(64),
    "note" VARCHAR(500),
    "error" TEXT,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radius_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_reasons" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_order_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "reason_id" UUID NOT NULL,
    "code" VARCHAR(32),
    "status" "ServiceOrderStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "open_description" TEXT NOT NULL,
    "close_description" TEXT,
    "city" VARCHAR(120),
    "state" VARCHAR(120),
    "assigned_to_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "type" "CashRegisterType" NOT NULL DEFAULT 'CASH',
    "color" VARCHAR(7),
    "currency" CHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_register_memberships" (
    "cash_register_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "CashRegisterRole" NOT NULL DEFAULT 'OPERATOR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_register_memberships_pkey" PRIMARY KEY ("cash_register_id","user_id")
);

-- CreateTable
CREATE TABLE "one_time_charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "contract_id" UUID,
    "code" VARCHAR(32),
    "description" VARCHAR(500) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OneTimeChargeStatus" NOT NULL DEFAULT 'OPEN',
    "paid_at" TIMESTAMP(3),
    "paid_amount" DECIMAL(12,2),
    "discount_amount" DECIMAL(12,2),
    "paid_via" "PaymentMethod",
    "cash_register_id" UUID,
    "payment_note" VARCHAR(500),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "one_time_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cash_register_id" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "source" "CashMovementSource" NOT NULL DEFAULT 'MANUAL',
    "amount" DECIMAL(14,2) NOT NULL,
    "description" VARCHAR(500),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_id" UUID,
    "transfer_group_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "size_bytes" BIGINT,
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_pops" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(32),
    "city" VARCHAR(120),
    "state" VARCHAR(120),
    "address" VARCHAR(500),
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "network_pops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_equipment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pop_id" UUID,
    "type" "NetworkEquipmentType" NOT NULL,
    "vendor" "NetworkEquipmentVendor" NOT NULL DEFAULT 'OTHER',
    "name" VARCHAR(120) NOT NULL,
    "hostname" VARCHAR(255),
    "ip_address" VARCHAR(45) NOT NULL,
    "radius_secret" VARCHAR(64),
    "radius_nas_type" VARCHAR(30),
    "snmp_community" VARCHAR(64),
    "snmp_version" VARCHAR(10),
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "network_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_instances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "evolution_url" VARCHAR(255) NOT NULL DEFAULT 'http://localhost:8080',
    "api_key" VARCHAR(255) NOT NULL,
    "instance_name" VARCHAR(120) NOT NULL,
    "webhook_secret" VARCHAR(64) NOT NULL,
    "phone_e164" VARCHAR(20),
    "status" "WaInstanceStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "qr_code" TEXT,
    "last_error" TEXT,
    "connected_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "phone_e164" VARCHAR(20) NOT NULL,
    "push_name" VARCHAR(255),
    "customer_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" "WaConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_user_id" UUID,
    "assigned_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "last_inbound_at" TIMESTAMP(3),
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" "WaMsgDirection" NOT NULL,
    "type" "WaMsgType" NOT NULL,
    "body" TEXT,
    "media_url" VARCHAR(500),
    "media_mime_type" VARCHAR(100),
    "media_size" INTEGER,
    "evolution_msg_id" VARCHAR(120),
    "from_user_id" UUID,
    "status" "WaMsgStatus" NOT NULL DEFAULT 'SENT',
    "error_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_conversation_views" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "viewer_user_id" UUID NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_conversation_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_country_idx" ON "tenants"("country");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key_key" ON "tenant_settings"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_features_tenant_id_feature_key" ON "tenant_features"("tenant_id", "feature");

-- CreateIndex
CREATE INDEX "users_tenant_id_status_idx" ON "users"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "permissions_resource_action_idx" ON "permissions"("resource", "action");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_resource_resource_id_idx" ON "audit_logs"("resource", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "customers_tenant_id_status_idx" ON "customers"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "customers_tenant_id_type_idx" ON "customers"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "customers_tenant_id_display_name_idx" ON "customers"("tenant_id", "display_name");

-- CreateIndex
CREATE INDEX "customers_tenant_id_primary_email_idx" ON "customers"("tenant_id", "primary_email");

-- CreateIndex
CREATE INDEX "customers_tenant_id_primary_phone_idx" ON "customers"("tenant_id", "primary_phone");

-- CreateIndex
CREATE INDEX "customers_tenant_id_created_at_idx" ON "customers"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_code_key" ON "customers"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_tax_id_tax_id_type_key" ON "customers"("tenant_id", "tax_id", "tax_id_type");

-- CreateIndex
CREATE INDEX "customer_addresses_tenant_id_customer_id_idx" ON "customer_addresses"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_addresses_tenant_id_postal_code_idx" ON "customer_addresses"("tenant_id", "postal_code");

-- CreateIndex
CREATE INDEX "customer_addresses_tenant_id_city_idx" ON "customer_addresses"("tenant_id", "city");

-- CreateIndex
CREATE INDEX "customer_contacts_tenant_id_customer_id_idx" ON "customer_contacts"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_contacts_tenant_id_type_value_idx" ON "customer_contacts"("tenant_id", "type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contacts_tenant_id_customer_id_type_value_key" ON "customer_contacts"("tenant_id", "customer_id", "type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tags_tenant_id_name_key" ON "customer_tags"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "customer_tag_assignments_tag_id_idx" ON "customer_tag_assignments"("tag_id");

-- CreateIndex
CREATE INDEX "customer_tag_assignments_tenant_id_customer_id_idx" ON "customer_tag_assignments"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_consents_tenant_id_customer_id_idx" ON "customer_consents"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_consents_tenant_id_purpose_status_idx" ON "customer_consents"("tenant_id", "purpose", "status");

-- CreateIndex
CREATE INDEX "customer_notes_tenant_id_customer_id_created_at_idx" ON "customer_notes"("tenant_id", "customer_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_notes_tenant_id_pinned_idx" ON "customer_notes"("tenant_id", "pinned");

-- CreateIndex
CREATE INDEX "pipelines_tenant_id_is_archived_idx" ON "pipelines"("tenant_id", "is_archived");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_tenant_id_slug_key" ON "pipelines"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "pipeline_stages_tenant_id_pipeline_id_idx" ON "pipeline_stages"("tenant_id", "pipeline_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_order_key" ON "pipeline_stages"("pipeline_id", "order");

-- CreateIndex
CREATE INDEX "deals_tenant_id_pipeline_id_stage_id_position_idx" ON "deals"("tenant_id", "pipeline_id", "stage_id", "position");

-- CreateIndex
CREATE INDEX "deals_tenant_id_status_idx" ON "deals"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "deals_tenant_id_owner_id_idx" ON "deals"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "deals_tenant_id_customer_id_idx" ON "deals"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "deals_tenant_id_expected_close_at_idx" ON "deals"("tenant_id", "expected_close_at");

-- CreateIndex
CREATE INDEX "deal_history_tenant_id_deal_id_created_at_idx" ON "deal_history"("tenant_id", "deal_id", "created_at");

-- CreateIndex
CREATE INDEX "deal_history_tenant_id_to_stage_id_idx" ON "deal_history"("tenant_id", "to_stage_id");

-- CreateIndex
CREATE INDEX "activities_tenant_id_deal_id_due_at_idx" ON "activities"("tenant_id", "deal_id", "due_at");

-- CreateIndex
CREATE INDEX "activities_tenant_id_customer_id_due_at_idx" ON "activities"("tenant_id", "customer_id", "due_at");

-- CreateIndex
CREATE INDEX "activities_tenant_id_owner_id_status_due_at_idx" ON "activities"("tenant_id", "owner_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "activities_tenant_id_status_due_at_idx" ON "activities"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_customer_id_idx" ON "contracts"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_status_idx" ON "contracts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_due_day_idx" ON "contracts"("tenant_id", "due_day");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_auth_method_idx" ON "contracts"("tenant_id", "auth_method");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_tenant_id_pppoe_username_key" ON "contracts"("tenant_id", "pppoe_username");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_tenant_id_circuit_id_key" ON "contracts"("tenant_id", "circuit_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_tenant_id_mac_address_key" ON "contracts"("tenant_id", "mac_address");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_tenant_id_code_key" ON "contracts"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "contract_invoices_tenant_id_contract_id_idx" ON "contract_invoices"("tenant_id", "contract_id");

-- CreateIndex
CREATE INDEX "contract_invoices_tenant_id_cash_register_id_idx" ON "contract_invoices"("tenant_id", "cash_register_id");

-- CreateIndex
CREATE INDEX "contract_invoices_tenant_id_status_due_date_idx" ON "contract_invoices"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "radius_events_tenant_id_contract_id_created_at_idx" ON "radius_events"("tenant_id", "contract_id", "created_at");

-- CreateIndex
CREATE INDEX "radius_events_tenant_id_status_idx" ON "radius_events"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "service_order_reasons_tenant_id_is_active_order_idx" ON "service_order_reasons"("tenant_id", "is_active", "order");

-- CreateIndex
CREATE UNIQUE INDEX "service_order_reasons_tenant_id_name_key" ON "service_order_reasons"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "service_orders_tenant_id_status_idx" ON "service_orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "service_orders_tenant_id_contract_id_idx" ON "service_orders"("tenant_id", "contract_id");

-- CreateIndex
CREATE INDEX "service_orders_tenant_id_scheduled_at_idx" ON "service_orders"("tenant_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "service_orders_tenant_id_city_idx" ON "service_orders"("tenant_id", "city");

-- CreateIndex
CREATE INDEX "service_orders_tenant_id_assigned_to_id_status_idx" ON "service_orders"("tenant_id", "assigned_to_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_orders_tenant_id_code_key" ON "service_orders"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "cash_registers_tenant_id_is_active_idx" ON "cash_registers"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_tenant_id_name_key" ON "cash_registers"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "cash_register_memberships_user_id_idx" ON "cash_register_memberships"("user_id");

-- CreateIndex
CREATE INDEX "one_time_charges_tenant_id_status_idx" ON "one_time_charges"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "one_time_charges_tenant_id_customer_id_idx" ON "one_time_charges"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "one_time_charges_tenant_id_due_date_idx" ON "one_time_charges"("tenant_id", "due_date");

-- CreateIndex
CREATE INDEX "one_time_charges_tenant_id_cash_register_id_idx" ON "one_time_charges"("tenant_id", "cash_register_id");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_charges_tenant_id_code_key" ON "one_time_charges"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "cash_movements_tenant_id_cash_register_id_occurred_at_idx" ON "cash_movements"("tenant_id", "cash_register_id", "occurred_at");

-- CreateIndex
CREATE INDEX "cash_movements_transfer_group_id_idx" ON "cash_movements"("transfer_group_id");

-- CreateIndex
CREATE INDEX "cash_movements_source_source_id_idx" ON "cash_movements"("source", "source_id");

-- CreateIndex
CREATE INDEX "backups_tenant_id_created_at_idx" ON "backups"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "backups_status_idx" ON "backups"("status");

-- CreateIndex
CREATE INDEX "network_pops_tenant_id_is_active_idx" ON "network_pops"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "network_pops_tenant_id_name_key" ON "network_pops"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "network_pops_tenant_id_code_key" ON "network_pops"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "network_equipment_tenant_id_type_idx" ON "network_equipment"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "network_equipment_pop_id_idx" ON "network_equipment"("pop_id");

-- CreateIndex
CREATE UNIQUE INDEX "network_equipment_tenant_id_name_key" ON "network_equipment"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "network_equipment_tenant_id_ip_address_key" ON "network_equipment"("tenant_id", "ip_address");

-- CreateIndex
CREATE INDEX "whatsapp_instances_tenant_id_status_idx" ON "whatsapp_instances"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_instances_tenant_id_instance_name_key" ON "whatsapp_instances"("tenant_id", "instance_name");

-- CreateIndex
CREATE INDEX "whatsapp_contacts_tenant_id_customer_id_idx" ON "whatsapp_contacts"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_tenant_id_phone_e164_key" ON "whatsapp_contacts"("tenant_id", "phone_e164");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_tenant_id_status_last_message_at_idx" ON "whatsapp_conversations"("tenant_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_tenant_id_assigned_user_id_idx" ON "whatsapp_conversations"("tenant_id", "assigned_user_id");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_instance_id_contact_id_idx" ON "whatsapp_conversations"("instance_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_evolution_msg_id_key" ON "whatsapp_messages"("evolution_msg_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_conversation_id_created_at_idx" ON "whatsapp_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_conversation_views_conversation_id_viewed_at_idx" ON "whatsapp_conversation_views"("conversation_id", "viewed_at");

-- CreateIndex
CREATE INDEX "whatsapp_conversation_views_viewer_user_id_viewed_at_idx" ON "whatsapp_conversation_views"("viewer_user_id", "viewed_at");

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_features" ADD CONSTRAINT "tenant_features_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tag_assignments" ADD CONSTRAINT "customer_tag_assignments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tag_assignments" ADD CONSTRAINT "customer_tag_assignments_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "customer_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tag_assignments" ADD CONSTRAINT "customer_tag_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_history" ADD CONSTRAINT "deal_history_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_history" ADD CONSTRAINT "deal_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_invoices" ADD CONSTRAINT "contract_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_invoices" ADD CONSTRAINT "contract_invoices_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_invoices" ADD CONSTRAINT "contract_invoices_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radius_events" ADD CONSTRAINT "radius_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radius_events" ADD CONSTRAINT "radius_events_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_reasons" ADD CONSTRAINT "service_order_reasons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "service_order_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_register_memberships" ADD CONSTRAINT "cash_register_memberships_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_register_memberships" ADD CONSTRAINT "cash_register_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_charges" ADD CONSTRAINT "one_time_charges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_charges" ADD CONSTRAINT "one_time_charges_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_charges" ADD CONSTRAINT "one_time_charges_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_charges" ADD CONSTRAINT "one_time_charges_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_charges" ADD CONSTRAINT "one_time_charges_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_charges" ADD CONSTRAINT "one_time_charges_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backups" ADD CONSTRAINT "backups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backups" ADD CONSTRAINT "backups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_pops" ADD CONSTRAINT "network_pops_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_pops" ADD CONSTRAINT "network_pops_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_pops" ADD CONSTRAINT "network_pops_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_equipment" ADD CONSTRAINT "network_equipment_pop_id_fkey" FOREIGN KEY ("pop_id") REFERENCES "network_pops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_equipment" ADD CONSTRAINT "network_equipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_equipment" ADD CONSTRAINT "network_equipment_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_equipment" ADD CONSTRAINT "network_equipment_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "whatsapp_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversation_views" ADD CONSTRAINT "whatsapp_conversation_views_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversation_views" ADD CONSTRAINT "whatsapp_conversation_views_viewer_user_id_fkey" FOREIGN KEY ("viewer_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

