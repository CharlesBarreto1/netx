-- =============================================================================
-- Frota (Fleet) — veículos, motoristas, despesas, manutenções e posições GPS
-- =============================================================================
-- Extraído do antigo placeholder /mapping/vehicles. O "Ao vivo" consome
-- posições de um Traccar self-hosted: Vehicle.tracker_unique_id casa com o
-- device.uniqueId (IMEI) no Traccar; o NetX filtra por tenant_id.
--
-- Ordem: CREATE TYPE → CREATE TABLE → índices → FKs (no fim, evita ordenação).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE "VehicleType"      AS ENUM ('CAR', 'MOTORCYCLE', 'TRUCK', 'VAN', 'PICKUP', 'OTHER');
CREATE TYPE "VehicleStatus"    AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE');
CREATE TYPE "DriverStatus"     AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "FleetExpenseType" AS ENUM ('FUEL', 'TOLL', 'FINE', 'INSURANCE', 'REPAIR', 'TAX', 'OTHER');
CREATE TYPE "MaintenanceKind"  AS ENUM ('OIL_CHANGE', 'REVISION', 'TIRES', 'BRAKES', 'FILTERS', 'ALIGNMENT', 'OTHER');

-- -----------------------------------------------------------------------------
-- drivers
-- -----------------------------------------------------------------------------
CREATE TABLE "drivers" (
  "id"               UUID           NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"        UUID           NOT NULL,
  "name"             VARCHAR(160)   NOT NULL,
  "document"         VARCHAR(32),
  "license_number"   VARCHAR(32),
  "license_category" VARCHAR(8),
  "license_expiry"   DATE,
  "phone"            VARCHAR(32),
  "status"           "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
  "user_id"          UUID,
  "notes"            TEXT,
  "created_by_id"    UUID,
  "updated_by_id"    UUID,
  "created_at"       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)   NOT NULL,
  "deleted_at"       TIMESTAMP(3),
  CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- vehicles
-- -----------------------------------------------------------------------------
CREATE TABLE "vehicles" (
  "id"                 UUID            NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"          UUID            NOT NULL,
  "plate"              VARCHAR(16)     NOT NULL,
  "brand"              VARCHAR(80),
  "model"              VARCHAR(80),
  "year"               INTEGER,
  "type"               "VehicleType"   NOT NULL DEFAULT 'CAR',
  "color"              VARCHAR(40),
  "renavam"            VARCHAR(32),
  "chassis"            VARCHAR(40),
  "status"             "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
  "tracker_unique_id"  VARCHAR(64),
  "odometer"           INTEGER         NOT NULL DEFAULT 0,
  "notes"              TEXT,
  "current_driver_id"  UUID,
  "created_by_id"      UUID,
  "updated_by_id"      UUID,
  "created_at"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3)    NOT NULL,
  "deleted_at"         TIMESTAMP(3),
  CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- fleet_expenses
-- -----------------------------------------------------------------------------
CREATE TABLE "fleet_expenses" (
  "id"                UUID               NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"         UUID               NOT NULL,
  "vehicle_id"        UUID               NOT NULL,
  "driver_id"         UUID,
  "type"              "FleetExpenseType" NOT NULL DEFAULT 'FUEL',
  "amount"            DECIMAL(12,2)      NOT NULL,
  "occurred_at"       TIMESTAMP(3)       NOT NULL,
  "odometer"          INTEGER,
  "description"       VARCHAR(500),
  "cash_register_id"  UUID,
  "cash_movement_id"  UUID,
  "created_by_id"     UUID,
  "created_at"        TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3)       NOT NULL,
  "deleted_at"        TIMESTAMP(3),
  CONSTRAINT "fleet_expenses_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- maintenance_plans
-- -----------------------------------------------------------------------------
CREATE TABLE "maintenance_plans" (
  "id"                    UUID              NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"             UUID              NOT NULL,
  "vehicle_id"            UUID              NOT NULL,
  "kind"                  "MaintenanceKind" NOT NULL DEFAULT 'OIL_CHANGE',
  "description"           VARCHAR(255),
  "interval_km"           INTEGER,
  "interval_days"         INTEGER,
  "last_service_odometer" INTEGER,
  "last_service_date"     DATE,
  "next_due_odometer"     INTEGER,
  "next_due_date"         DATE,
  "active"                BOOLEAN           NOT NULL DEFAULT true,
  "created_by_id"         UUID,
  "created_at"            TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3)      NOT NULL,
  "deleted_at"            TIMESTAMP(3),
  CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- maintenance_records
-- -----------------------------------------------------------------------------
CREATE TABLE "maintenance_records" (
  "id"             UUID              NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"      UUID              NOT NULL,
  "vehicle_id"     UUID              NOT NULL,
  "plan_id"        UUID,
  "kind"           "MaintenanceKind" NOT NULL DEFAULT 'OIL_CHANGE',
  "performed_at"   DATE              NOT NULL,
  "odometer"       INTEGER,
  "cost"           DECIMAL(12,2),
  "workshop"       VARCHAR(160),
  "description"    VARCHAR(500),
  "created_by_id"  UUID,
  "created_at"     TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3)      NOT NULL,
  "deleted_at"     TIMESTAMP(3),
  CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- vehicle_positions (1:1 com vehicle — última posição conhecida)
-- -----------------------------------------------------------------------------
CREATE TABLE "vehicle_positions" (
  "vehicle_id"  UUID             NOT NULL,
  "tenant_id"   UUID             NOT NULL,
  "latitude"    DOUBLE PRECISION NOT NULL,
  "longitude"   DOUBLE PRECISION NOT NULL,
  "speed"       DOUBLE PRECISION,
  "course"      DOUBLE PRECISION,
  "altitude"    DOUBLE PRECISION,
  "address"     VARCHAR(500),
  "device_time" TIMESTAMP(3)     NOT NULL,
  "server_time" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attributes"  JSONB,
  CONSTRAINT "vehicle_positions_pkey" PRIMARY KEY ("vehicle_id")
);

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "drivers_tenant_status_idx" ON "drivers"("tenant_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_tenant_plate_key"   ON "vehicles"("tenant_id", "plate");
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_tenant_tracker_key" ON "vehicles"("tenant_id", "tracker_unique_id");
CREATE INDEX IF NOT EXISTS "vehicles_tenant_status_idx" ON "vehicles"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "vehicles_tenant_driver_idx" ON "vehicles"("tenant_id", "current_driver_id");

CREATE INDEX IF NOT EXISTS "fleet_expenses_tenant_vehicle_idx" ON "fleet_expenses"("tenant_id", "vehicle_id");
CREATE INDEX IF NOT EXISTS "fleet_expenses_tenant_occurred_idx" ON "fleet_expenses"("tenant_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "fleet_expenses_tenant_type_idx" ON "fleet_expenses"("tenant_id", "type");
CREATE INDEX IF NOT EXISTS "fleet_expenses_cash_movement_idx" ON "fleet_expenses"("cash_movement_id");

CREATE INDEX IF NOT EXISTS "maintenance_plans_tenant_vehicle_idx" ON "maintenance_plans"("tenant_id", "vehicle_id");
CREATE INDEX IF NOT EXISTS "maintenance_plans_tenant_active_due_idx" ON "maintenance_plans"("tenant_id", "active", "next_due_date");

CREATE INDEX IF NOT EXISTS "maintenance_records_tenant_vehicle_idx" ON "maintenance_records"("tenant_id", "vehicle_id");
CREATE INDEX IF NOT EXISTS "maintenance_records_tenant_performed_idx" ON "maintenance_records"("tenant_id", "performed_at");

CREATE INDEX IF NOT EXISTS "vehicle_positions_tenant_idx" ON "vehicle_positions"("tenant_id");
CREATE INDEX IF NOT EXISTS "vehicle_positions_tenant_device_idx" ON "vehicle_positions"("tenant_id", "device_time");

-- -----------------------------------------------------------------------------
-- Foreign keys
-- -----------------------------------------------------------------------------
ALTER TABLE "drivers"
  ADD CONSTRAINT "drivers_tenant_fk"     FOREIGN KEY ("tenant_id")     REFERENCES "tenants"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "drivers_user_fk"       FOREIGN KEY ("user_id")       REFERENCES "users"("id")   ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "drivers_created_by_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id")   ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "drivers_updated_by_fk" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")   ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_tenant_fk"     FOREIGN KEY ("tenant_id")         REFERENCES "tenants"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "vehicles_driver_fk"     FOREIGN KEY ("current_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "vehicles_created_by_fk" FOREIGN KEY ("created_by_id")     REFERENCES "users"("id")   ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "vehicles_updated_by_fk" FOREIGN KEY ("updated_by_id")     REFERENCES "users"("id")   ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fleet_expenses"
  ADD CONSTRAINT "fleet_expenses_tenant_fk"     FOREIGN KEY ("tenant_id")        REFERENCES "tenants"("id")        ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "fleet_expenses_vehicle_fk"    FOREIGN KEY ("vehicle_id")       REFERENCES "vehicles"("id")       ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "fleet_expenses_driver_fk"     FOREIGN KEY ("driver_id")        REFERENCES "drivers"("id")        ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "fleet_expenses_register_fk"   FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "fleet_expenses_created_by_fk" FOREIGN KEY ("created_by_id")    REFERENCES "users"("id")          ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "maintenance_plans"
  ADD CONSTRAINT "maintenance_plans_tenant_fk"     FOREIGN KEY ("tenant_id")     REFERENCES "tenants"("id")  ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "maintenance_plans_vehicle_fk"    FOREIGN KEY ("vehicle_id")    REFERENCES "vehicles"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "maintenance_plans_created_by_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id")    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "maintenance_records"
  ADD CONSTRAINT "maintenance_records_tenant_fk"     FOREIGN KEY ("tenant_id")     REFERENCES "tenants"("id")           ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "maintenance_records_vehicle_fk"    FOREIGN KEY ("vehicle_id")    REFERENCES "vehicles"("id")          ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "maintenance_records_plan_fk"       FOREIGN KEY ("plan_id")       REFERENCES "maintenance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "maintenance_records_created_by_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id")             ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vehicle_positions"
  ADD CONSTRAINT "vehicle_positions_tenant_fk"  FOREIGN KEY ("tenant_id")  REFERENCES "tenants"("id")  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "vehicle_positions_vehicle_fk" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
