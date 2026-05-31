-- =============================================================================
-- RH — Recursos Humanos / colaboradores
-- =============================================================================
-- Modelos: employees, employee_documents, document_signatures, time_entries,
-- time_correction_requests, payslips, salary_payments, company_posts.
--
-- Decisões (ver memória project_netx_rh):
--   - Login do colaborador = User do sistema (employees.user_id 1:1).
--   - Folha = lançamento MANUAL (payslips.items JSONB), sem cálculo legal.
--   - Anexos via StorageModule (MinIO) — guardamos só storage_key.
--   - "Assinatura" de documento = aceite eletrônico (document_signatures),
--     NÃO é certificado digital ICP.
--
-- Ordem: CREATE TYPE → CREATE TABLE → índices → FKs (no fim, evita ordenação).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE "EmployeeStatus"       AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED');
CREATE TYPE "EmploymentType"       AS ENUM ('CLT', 'PJ', 'INTERN', 'TEMPORARY', 'RELACION_DEPENDENCIA', 'OTHER');
CREATE TYPE "PayFrequency"         AS ENUM ('MONTHLY', 'BIWEEKLY', 'WEEKLY');
CREATE TYPE "EmployeeDocumentType" AS ENUM ('CONTRACT', 'AMENDMENT', 'MEDICAL_CERTIFICATE', 'WARNING', 'SUSPENSION', 'ID_DOCUMENT', 'CERTIFICATE', 'PAYSLIP', 'PAYMENT_RECEIPT', 'OTHER');
CREATE TYPE "TimeEntryType"        AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END');
CREATE TYPE "TimeEntrySource"      AS ENUM ('PORTAL', 'MOBILE', 'MANUAL');
CREATE TYPE "TimeCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "TimeCorrectionKind"   AS ENUM ('ADD', 'EDIT', 'REMOVE');
CREATE TYPE "PayslipStatus"        AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');
CREATE TYPE "CompanyPostStatus"    AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- -----------------------------------------------------------------------------
-- employees
-- -----------------------------------------------------------------------------
CREATE TABLE "employees" (
  "id"                  UUID             NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"           UUID             NOT NULL,
  "registration"        VARCHAR(32),
  "full_name"           VARCHAR(180)     NOT NULL,
  "preferred_name"      VARCHAR(80),
  "document"            VARCHAR(32),
  "document_type"       VARCHAR(16),
  "social_security_no"  VARCHAR(32),
  "birth_date"          DATE,
  "gender"              VARCHAR(16),
  "marital_status"      VARCHAR(24),
  "nationality"         VARCHAR(48),
  "email"               VARCHAR(160),
  "phone"               VARCHAR(32),
  "emergency_contact"   VARCHAR(180),
  "emergency_phone"     VARCHAR(32),
  "address"             VARCHAR(500),
  "department"          VARCHAR(120),
  "position"            VARCHAR(120),
  "employment_type"     "EmploymentType" NOT NULL DEFAULT 'CLT',
  "status"              "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
  "hired_at"            DATE,
  "probation_ends_at"   DATE,
  "terminated_at"       DATE,
  "termination_reason"  VARCHAR(500),
  "base_salary"         DECIMAL(12,2),
  "pay_frequency"       "PayFrequency"   NOT NULL DEFAULT 'MONTHLY',
  "weekly_hours"        DECIMAL(5,2),
  "work_schedule"       VARCHAR(255),
  "clock_tolerance_min" INTEGER          NOT NULL DEFAULT 10,
  "skills"              TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"               TEXT,
  "user_id"             UUID,
  "manager_id"          UUID,
  "created_by_id"       UUID,
  "updated_by_id"       UUID,
  "created_at"          TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3)     NOT NULL,
  "deleted_at"          TIMESTAMP(3),
  CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- employee_documents
-- -----------------------------------------------------------------------------
CREATE TABLE "employee_documents" (
  "id"                 UUID                   NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"          UUID                   NOT NULL,
  "employee_id"        UUID                   NOT NULL,
  "type"               "EmployeeDocumentType" NOT NULL DEFAULT 'OTHER',
  "title"              VARCHAR(200)           NOT NULL,
  "description"        VARCHAR(500),
  "storage_key"        VARCHAR(500),
  "file_name"          VARCHAR(255),
  "mime_type"          VARCHAR(120),
  "file_size"          INTEGER,
  "file_hash"          VARCHAR(64),
  "issued_at"          DATE,
  "expires_at"         DATE,
  "requires_signature" BOOLEAN                NOT NULL DEFAULT false,
  "uploaded_by_id"     UUID,
  "created_at"         TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3)           NOT NULL,
  "deleted_at"         TIMESTAMP(3),
  CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- document_signatures (1:1 com employee_documents — aceite eletrônico)
-- -----------------------------------------------------------------------------
CREATE TABLE "document_signatures" (
  "id"               UUID         NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"        UUID         NOT NULL,
  "document_id"      UUID         NOT NULL,
  "employee_id"      UUID         NOT NULL,
  "signed_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "signed_file_hash" VARCHAR(64),
  "ip_address"       VARCHAR(64),
  "user_agent"       VARCHAR(400),
  "accepted_text"    VARCHAR(1000),
  CONSTRAINT "document_signatures_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- time_entries (marcações de ponto)
-- -----------------------------------------------------------------------------
CREATE TABLE "time_entries" (
  "id"            UUID              NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"     UUID              NOT NULL,
  "employee_id"   UUID              NOT NULL,
  "type"          "TimeEntryType"   NOT NULL,
  "occurred_at"   TIMESTAMP(3)      NOT NULL,
  "source"        "TimeEntrySource" NOT NULL DEFAULT 'PORTAL',
  "latitude"      DOUBLE PRECISION,
  "longitude"     DOUBLE PRECISION,
  "ip_address"    VARCHAR(64),
  "correction_id" UUID,
  "notes"         VARCHAR(500),
  "created_by_id" UUID,
  "created_at"    TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3)      NOT NULL,
  "deleted_at"    TIMESTAMP(3),
  CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- time_correction_requests (solicitação → aprovação RH)
-- -----------------------------------------------------------------------------
CREATE TABLE "time_correction_requests" (
  "id"             UUID                   NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"      UUID                   NOT NULL,
  "employee_id"    UUID                   NOT NULL,
  "kind"           "TimeCorrectionKind"   NOT NULL DEFAULT 'ADD',
  "target_date"    DATE                   NOT NULL,
  "target_entry_id" UUID,
  "proposed_type"  "TimeEntryType",
  "proposed_time"  TIMESTAMP(3),
  "reason"         VARCHAR(1000)          NOT NULL,
  "status"         "TimeCorrectionStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_id" UUID,
  "reviewed_at"    TIMESTAMP(3),
  "review_notes"   VARCHAR(1000),
  "created_at"     TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3)           NOT NULL,
  CONSTRAINT "time_correction_requests_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- payslips (holerite — lançamento manual)
-- -----------------------------------------------------------------------------
CREATE TABLE "payslips" (
  "id"               UUID            NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"        UUID            NOT NULL,
  "employee_id"      UUID            NOT NULL,
  "reference_month"  DATE            NOT NULL,
  "items"            JSONB           NOT NULL DEFAULT '[]',
  "gross_amount"     DECIMAL(12,2)   NOT NULL DEFAULT 0,
  "deductions_total" DECIMAL(12,2)   NOT NULL DEFAULT 0,
  "net_amount"       DECIMAL(12,2)   NOT NULL DEFAULT 0,
  "status"           "PayslipStatus" NOT NULL DEFAULT 'DRAFT',
  "notes"            VARCHAR(1000),
  "storage_key"      VARCHAR(500),
  "created_by_id"    UUID,
  "created_at"       TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)    NOT NULL,
  "deleted_at"       TIMESTAMP(3),
  CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- salary_payments (pagamento efetivo — integra no caixa, 1:1 com payslip)
-- -----------------------------------------------------------------------------
CREATE TABLE "salary_payments" (
  "id"                  UUID            NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"           UUID            NOT NULL,
  "payslip_id"          UUID            NOT NULL,
  "employee_id"         UUID            NOT NULL,
  "amount"              DECIMAL(12,2)   NOT NULL,
  "paid_at"             TIMESTAMP(3)    NOT NULL,
  "method"              "PaymentMethod" NOT NULL DEFAULT 'CASH',
  "cash_register_id"    UUID,
  "cash_movement_id"    UUID,
  "receipt_storage_key" VARCHAR(500),
  "notes"               VARCHAR(500),
  "created_by_id"       UUID,
  "created_at"          TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3)    NOT NULL,
  "deleted_at"          TIMESTAMP(3),
  CONSTRAINT "salary_payments_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- company_posts (blog / notícias do portal do colaborador)
-- -----------------------------------------------------------------------------
CREATE TABLE "company_posts" (
  "id"                UUID                NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"         UUID                NOT NULL,
  "title"             VARCHAR(250)        NOT NULL,
  "slug"              VARCHAR(280)        NOT NULL,
  "excerpt"           VARCHAR(500),
  "body"              TEXT                NOT NULL,
  "cover_storage_key" VARCHAR(500),
  "status"            "CompanyPostStatus" NOT NULL DEFAULT 'DRAFT',
  "pinned"            BOOLEAN             NOT NULL DEFAULT false,
  "published_at"      TIMESTAMP(3),
  "author_id"         UUID,
  "created_at"        TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3)        NOT NULL,
  "deleted_at"        TIMESTAMP(3),
  CONSTRAINT "company_posts_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "employees_user_id_key"        ON "employees"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "employees_tenant_reg_key"     ON "employees"("tenant_id", "registration");
CREATE INDEX IF NOT EXISTS "employees_tenant_status_idx"         ON "employees"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "employees_tenant_department_idx"     ON "employees"("tenant_id", "department");
CREATE INDEX IF NOT EXISTS "employees_tenant_manager_idx"        ON "employees"("tenant_id", "manager_id");

CREATE INDEX IF NOT EXISTS "employee_documents_tenant_employee_idx"   ON "employee_documents"("tenant_id", "employee_id");
CREATE INDEX IF NOT EXISTS "employee_documents_tenant_type_idx"       ON "employee_documents"("tenant_id", "type");
CREATE INDEX IF NOT EXISTS "employee_documents_tenant_requires_idx"   ON "employee_documents"("tenant_id", "requires_signature");
CREATE INDEX IF NOT EXISTS "employee_documents_tenant_expires_idx"    ON "employee_documents"("tenant_id", "expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "document_signatures_document_key" ON "document_signatures"("document_id");
CREATE INDEX IF NOT EXISTS "document_signatures_tenant_employee_idx" ON "document_signatures"("tenant_id", "employee_id");

CREATE INDEX IF NOT EXISTS "time_entries_tenant_employee_occurred_idx" ON "time_entries"("tenant_id", "employee_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "time_entries_tenant_occurred_idx"          ON "time_entries"("tenant_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "time_corrections_tenant_status_idx"   ON "time_correction_requests"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "time_corrections_tenant_employee_idx" ON "time_correction_requests"("tenant_id", "employee_id");

CREATE UNIQUE INDEX IF NOT EXISTS "payslips_tenant_employee_month_key" ON "payslips"("tenant_id", "employee_id", "reference_month");
CREATE INDEX IF NOT EXISTS "payslips_tenant_status_idx"    ON "payslips"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "payslips_tenant_reference_idx" ON "payslips"("tenant_id", "reference_month");

CREATE UNIQUE INDEX IF NOT EXISTS "salary_payments_payslip_key"     ON "salary_payments"("payslip_id");
CREATE INDEX IF NOT EXISTS "salary_payments_tenant_employee_idx"    ON "salary_payments"("tenant_id", "employee_id");
CREATE INDEX IF NOT EXISTS "salary_payments_tenant_paid_idx"        ON "salary_payments"("tenant_id", "paid_at");
CREATE INDEX IF NOT EXISTS "salary_payments_cash_movement_idx"      ON "salary_payments"("cash_movement_id");

CREATE UNIQUE INDEX IF NOT EXISTS "company_posts_tenant_slug_key" ON "company_posts"("tenant_id", "slug");
CREATE INDEX IF NOT EXISTS "company_posts_tenant_status_pub_idx"  ON "company_posts"("tenant_id", "status", "published_at");

-- -----------------------------------------------------------------------------
-- Foreign keys
-- -----------------------------------------------------------------------------
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_tenant_fk"     FOREIGN KEY ("tenant_id")     REFERENCES "tenants"("id")   ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "employees_user_fk"       FOREIGN KEY ("user_id")       REFERENCES "users"("id")     ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "employees_manager_fk"    FOREIGN KEY ("manager_id")    REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "employees_created_by_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id")     ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "employees_updated_by_fk" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")     ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_documents"
  ADD CONSTRAINT "employee_documents_tenant_fk"      FOREIGN KEY ("tenant_id")      REFERENCES "tenants"("id")   ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_documents_employee_fk"    FOREIGN KEY ("employee_id")    REFERENCES "employees"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_documents_uploaded_by_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id")     ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_signatures"
  ADD CONSTRAINT "document_signatures_tenant_fk"   FOREIGN KEY ("tenant_id")   REFERENCES "tenants"("id")             ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "document_signatures_document_fk" FOREIGN KEY ("document_id") REFERENCES "employee_documents"("id")  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "document_signatures_employee_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id")           ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_tenant_fk"     FOREIGN KEY ("tenant_id")     REFERENCES "tenants"("id")   ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "time_entries_employee_fk"   FOREIGN KEY ("employee_id")   REFERENCES "employees"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "time_entries_created_by_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id")     ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "time_correction_requests"
  ADD CONSTRAINT "time_corrections_tenant_fk"      FOREIGN KEY ("tenant_id")      REFERENCES "tenants"("id")   ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "time_corrections_employee_fk"    FOREIGN KEY ("employee_id")    REFERENCES "employees"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "time_corrections_reviewed_by_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")     ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payslips"
  ADD CONSTRAINT "payslips_tenant_fk"     FOREIGN KEY ("tenant_id")     REFERENCES "tenants"("id")   ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "payslips_employee_fk"   FOREIGN KEY ("employee_id")   REFERENCES "employees"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "payslips_created_by_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id")     ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "salary_payments"
  ADD CONSTRAINT "salary_payments_tenant_fk"     FOREIGN KEY ("tenant_id")        REFERENCES "tenants"("id")        ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "salary_payments_payslip_fk"    FOREIGN KEY ("payslip_id")       REFERENCES "payslips"("id")       ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "salary_payments_employee_fk"   FOREIGN KEY ("employee_id")      REFERENCES "employees"("id")      ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "salary_payments_register_fk"   FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "salary_payments_created_by_fk" FOREIGN KEY ("created_by_id")    REFERENCES "users"("id")          ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "company_posts"
  ADD CONSTRAINT "company_posts_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "company_posts_author_fk" FOREIGN KEY ("author_id") REFERENCES "users"("id")   ON DELETE SET NULL ON UPDATE CASCADE;
