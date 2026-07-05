-- =============================================================================
-- FiberMap FM-0 — fundação (FIBERMAP-SPEC.md §3, §4, §13)
-- =============================================================================
-- Planta externa OSP v2: catálogo de produtos, pastas, elementos geográficos,
-- cabos → tubos → fibras, cortes, conexões (fusão/conector), portas de device,
-- OTDR e medições. PostGIS habilitado aqui; colunas `geom` são mantidas por
-- trigger (elementos: lat/lng → Point; segmentos: path GeoJSON → LineString +
-- comprimento geográfico via ST_Length::geography).
--
-- CHECKs e índices parciais ficam neste SQL (Prisma não os modela). Nomes de
-- índice/constraint seguem a convenção Prisma ({table}_{cols}_key/_idx) pra
-- manter o diff de drift quieto.

-- PostGIS (pacote postgresql-16-postgis-3 precisa estar instalado no host —
-- ver README do módulo / runbook de deploy).
CREATE EXTENSION IF NOT EXISTS postgis;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE "FibermapProductType" AS ENUM ('CABLE', 'SPLICE_CLOSURE', 'TERMINATION_BOX', 'DIO', 'CABINET', 'INDOOR_RACK', 'SPLITTER');
CREATE TYPE "FibermapColorStandard" AS ENUM ('ABNT', 'EIA598');
CREATE TYPE "FibermapTubeScheme" AS ENUM ('STANDARD_CYCLE', 'PILOT_DIRECTIONAL', 'CUSTOM');
CREATE TYPE "FibermapElementType" AS ENUM ('POP', 'CABINET', 'CEO', 'CTO', 'POLE', 'SLACK_COIL', 'CUSTOMER_PREMISE');
CREATE TYPE "FibermapFiberStatus" AS ENUM ('DARK', 'ACTIVE', 'RESERVED', 'BROKEN');
CREATE TYPE "FibermapDeviceType" AS ENUM ('SPLITTER', 'DIO', 'OLT', 'ONU_SHELF', 'RACK');
CREATE TYPE "FibermapPortRole" AS ENUM ('IN', 'OUT', 'BIDI');
CREATE TYPE "FibermapConnectionKind" AS ENUM ('FUSION', 'CONNECTOR', 'SPLITTER_PATH');
CREATE TYPE "FibermapEndpointType" AS ENUM ('FIBER_END', 'PORT');
CREATE TYPE "FibermapFiberSide" AS ENUM ('A', 'B', 'U', 'D');
CREATE TYPE "FibermapOtdrReferenceKind" AS ENUM ('ELEMENT', 'PORT');
CREATE TYPE "FibermapOtdrEventType" AS ENUM ('BREAK', 'HIGH_LOSS', 'REFLECTIVE', 'END');

-- -----------------------------------------------------------------------------
-- Pastas
-- -----------------------------------------------------------------------------
CREATE TABLE "fibermap_folders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fibermap_folders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fibermap_folders_tenant_id_parent_id_idx" ON "fibermap_folders"("tenant_id", "parent_id");

ALTER TABLE "fibermap_folders" ADD CONSTRAINT "fibermap_folders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_folders" ADD CONSTRAINT "fibermap_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "fibermap_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fibermap_folders" ADD CONSTRAINT "fibermap_folders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Catálogo de produtos
-- -----------------------------------------------------------------------------
CREATE TABLE "fibermap_products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "FibermapProductType" NOT NULL,
    "manufacturer" VARCHAR(120) NOT NULL DEFAULT 'Padrão',
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "specs" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fibermap_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fibermap_products_tenant_id_type_manufacturer_name_key" ON "fibermap_products"("tenant_id", "type", "manufacturer", "name");
CREATE INDEX "fibermap_products_tenant_id_type_is_active_idx" ON "fibermap_products"("tenant_id", "type", "is_active");

ALTER TABLE "fibermap_products" ADD CONSTRAINT "fibermap_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_products" ADD CONSTRAINT "fibermap_products_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fibermap_products" ADD CONSTRAINT "fibermap_products_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Extensão estruturada de cabos (invariante da estrutura no CHECK)
CREATE TABLE "fibermap_cable_models" (
    "product_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fiber_count" INTEGER NOT NULL,
    "tube_count" INTEGER NOT NULL,
    "fibers_per_tube" INTEGER NOT NULL,
    "color_standard" "FibermapColorStandard" NOT NULL DEFAULT 'ABNT',
    "tube_scheme" "FibermapTubeScheme" NOT NULL DEFAULT 'STANDARD_CYCLE',
    "excess_factor" DECIMAL(5,4) NOT NULL DEFAULT 1.0200,
    "cable_class" VARCHAR(40),

    CONSTRAINT "fibermap_cable_models_pkey" PRIMARY KEY ("product_id"),
    CONSTRAINT "fibermap_cable_models_structure_chk" CHECK ("fiber_count" = "tube_count" * "fibers_per_tube" AND "tube_count" >= 1 AND "fibers_per_tube" >= 1),
    CONSTRAINT "fibermap_cable_models_excess_chk" CHECK ("excess_factor" >= 1.0 AND "excess_factor" <= 1.5)
);

CREATE INDEX "fibermap_cable_models_tenant_id_idx" ON "fibermap_cable_models"("tenant_id");

ALTER TABLE "fibermap_cable_models" ADD CONSTRAINT "fibermap_cable_models_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_cable_models" ADD CONSTRAINT "fibermap_cable_models_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "fibermap_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fibermap_cable_model_tubes" (
    "cable_model_id" UUID NOT NULL,
    "tube_number" INTEGER NOT NULL,
    "color" VARCHAR(20) NOT NULL,

    CONSTRAINT "fibermap_cable_model_tubes_pkey" PRIMARY KEY ("cable_model_id", "tube_number"),
    CONSTRAINT "fibermap_cable_model_tubes_number_chk" CHECK ("tube_number" >= 1)
);

ALTER TABLE "fibermap_cable_model_tubes" ADD CONSTRAINT "fibermap_cable_model_tubes_cable_model_id_fkey" FOREIGN KEY ("cable_model_id") REFERENCES "fibermap_cable_models"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Elementos físicos (nós geográficos)
-- -----------------------------------------------------------------------------
CREATE TABLE "fibermap_elements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "folder_id" UUID NOT NULL,
    "type" "FibermapElementType" NOT NULL,
    "product_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "geom" geometry(Point, 4326),
    "address" VARCHAR(255),
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fibermap_elements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fibermap_elements_lat_chk" CHECK ("latitude" >= -90 AND "latitude" <= 90),
    CONSTRAINT "fibermap_elements_lng_chk" CHECK ("longitude" >= -180 AND "longitude" <= 180)
);

CREATE UNIQUE INDEX "fibermap_elements_folder_id_name_key" ON "fibermap_elements"("folder_id", "name");
CREATE INDEX "fibermap_elements_tenant_id_type_idx" ON "fibermap_elements"("tenant_id", "type");
CREATE INDEX "fibermap_elements_tenant_id_folder_id_idx" ON "fibermap_elements"("tenant_id", "folder_id");
CREATE INDEX "fibermap_elements_tenant_id_product_id_idx" ON "fibermap_elements"("tenant_id", "product_id");
-- bbox do viewport (spec §16: p95 < 200ms com 50k elementos)
CREATE INDEX "fibermap_elements_geom_gist" ON "fibermap_elements" USING GIST ("geom");

ALTER TABLE "fibermap_elements" ADD CONSTRAINT "fibermap_elements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_elements" ADD CONSTRAINT "fibermap_elements_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "fibermap_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_elements" ADD CONSTRAINT "fibermap_elements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "fibermap_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fibermap_elements" ADD CONSTRAINT "fibermap_elements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fibermap_elements" ADD CONSTRAINT "fibermap_elements_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Trigger: geom ← (longitude, latitude). BEFORE garante consistência atômica.
CREATE OR REPLACE FUNCTION fibermap_element_geom_sync() RETURNS trigger AS $$
BEGIN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude::float8, NEW.latitude::float8), 4326);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fibermap_elements_geom_sync
    BEFORE INSERT OR UPDATE ON "fibermap_elements"
    FOR EACH ROW EXECUTE FUNCTION fibermap_element_geom_sync();

CREATE TABLE "fibermap_element_photos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "file_name" VARCHAR(255),
    "caption" VARCHAR(255),
    "taken_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fibermap_element_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fibermap_element_photos_tenant_id_element_id_idx" ON "fibermap_element_photos"("tenant_id", "element_id");

ALTER TABLE "fibermap_element_photos" ADD CONSTRAINT "fibermap_element_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_element_photos" ADD CONSTRAINT "fibermap_element_photos_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "fibermap_elements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Cabos, tubos, fibras
-- -----------------------------------------------------------------------------
CREATE TABLE "fibermap_cables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "folder_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "product_id" UUID,
    "fiber_count" INTEGER NOT NULL,
    "tube_count" INTEGER NOT NULL,
    "fibers_per_tube" INTEGER NOT NULL,
    "color_standard" "FibermapColorStandard" NOT NULL,
    "excess_factor" DECIMAL(5,4) NOT NULL,
    "display_color" VARCHAR(7),
    "notes" TEXT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fibermap_cables_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fibermap_cables_structure_chk" CHECK ("fiber_count" = "tube_count" * "fibers_per_tube" AND "tube_count" >= 1 AND "fibers_per_tube" >= 1),
    CONSTRAINT "fibermap_cables_excess_chk" CHECK ("excess_factor" >= 1.0 AND "excess_factor" <= 1.5)
);

CREATE INDEX "fibermap_cables_tenant_id_folder_id_idx" ON "fibermap_cables"("tenant_id", "folder_id");
CREATE INDEX "fibermap_cables_tenant_id_product_id_idx" ON "fibermap_cables"("tenant_id", "product_id");

ALTER TABLE "fibermap_cables" ADD CONSTRAINT "fibermap_cables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_cables" ADD CONSTRAINT "fibermap_cables_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "fibermap_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_cables" ADD CONSTRAINT "fibermap_cables_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "fibermap_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fibermap_cables" ADD CONSTRAINT "fibermap_cables_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fibermap_cables" ADD CONSTRAINT "fibermap_cables_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "fibermap_cable_tubes" (
    "cable_id" UUID NOT NULL,
    "tube_number" INTEGER NOT NULL,
    "color" VARCHAR(20) NOT NULL,

    CONSTRAINT "fibermap_cable_tubes_pkey" PRIMARY KEY ("cable_id", "tube_number"),
    CONSTRAINT "fibermap_cable_tubes_number_chk" CHECK ("tube_number" >= 1)
);

ALTER TABLE "fibermap_cable_tubes" ADD CONSTRAINT "fibermap_cable_tubes_cable_id_fkey" FOREIGN KEY ("cable_id") REFERENCES "fibermap_cables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fibermap_cable_segments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cable_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "from_element_id" UUID NOT NULL,
    "to_element_id" UUID NOT NULL,
    "path" JSONB NOT NULL,
    "geom" geometry(LineString, 4326),
    "geometric_length_m" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "measured_length_m" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fibermap_cable_segments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fibermap_cable_segments_seq_chk" CHECK ("seq" >= 1),
    CONSTRAINT "fibermap_cable_segments_measured_chk" CHECK ("measured_length_m" IS NULL OR "measured_length_m" > 0)
);

CREATE UNIQUE INDEX "fibermap_cable_segments_cable_id_seq_key" ON "fibermap_cable_segments"("cable_id", "seq");
CREATE INDEX "fibermap_cable_segments_tenant_id_cable_id_idx" ON "fibermap_cable_segments"("tenant_id", "cable_id");
CREATE INDEX "fibermap_cable_segments_from_element_id_idx" ON "fibermap_cable_segments"("from_element_id");
CREATE INDEX "fibermap_cable_segments_to_element_id_idx" ON "fibermap_cable_segments"("to_element_id");
CREATE INDEX "fibermap_cable_segments_geom_gist" ON "fibermap_cable_segments" USING GIST ("geom");

ALTER TABLE "fibermap_cable_segments" ADD CONSTRAINT "fibermap_cable_segments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_cable_segments" ADD CONSTRAINT "fibermap_cable_segments_cable_id_fkey" FOREIGN KEY ("cable_id") REFERENCES "fibermap_cables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_cable_segments" ADD CONSTRAINT "fibermap_cable_segments_from_element_id_fkey" FOREIGN KEY ("from_element_id") REFERENCES "fibermap_elements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_cable_segments" ADD CONSTRAINT "fibermap_cable_segments_to_element_id_fkey" FOREIGN KEY ("to_element_id") REFERENCES "fibermap_elements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trigger: geom ← path (GeoJSON [[lng,lat],…]) e comprimento geográfico em
-- metros ← ST_Length(geom::geography). Falha alto se o path for inválido —
-- o DTO valida ≥ 2 pontos antes de chegar aqui.
CREATE OR REPLACE FUNCTION fibermap_segment_geom_sync() RETURNS trigger AS $$
BEGIN
    NEW.geom := ST_SetSRID(
        ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', NEW.path)::text),
        4326
    );
    NEW.geometric_length_m := ROUND(ST_Length(NEW.geom::geography)::numeric, 2);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fibermap_cable_segments_geom_sync
    BEFORE INSERT OR UPDATE ON "fibermap_cable_segments"
    FOR EACH ROW EXECUTE FUNCTION fibermap_segment_geom_sync();

CREATE TABLE "fibermap_fibers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cable_id" UUID NOT NULL,
    "tube_number" INTEGER NOT NULL,
    "fiber_number" INTEGER NOT NULL,
    "color" VARCHAR(20) NOT NULL,
    "status" "FibermapFiberStatus" NOT NULL DEFAULT 'DARK',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fibermap_fibers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fibermap_fibers_numbers_chk" CHECK ("tube_number" >= 1 AND "fiber_number" >= 1)
);

CREATE UNIQUE INDEX "fibermap_fibers_cable_id_fiber_number_key" ON "fibermap_fibers"("cable_id", "fiber_number");
CREATE INDEX "fibermap_fibers_cable_id_tube_number_idx" ON "fibermap_fibers"("cable_id", "tube_number");
CREATE INDEX "fibermap_fibers_tenant_id_idx" ON "fibermap_fibers"("tenant_id");

ALTER TABLE "fibermap_fibers" ADD CONSTRAINT "fibermap_fibers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_fibers" ADD CONSTRAINT "fibermap_fibers_cable_id_fkey" FOREIGN KEY ("cable_id") REFERENCES "fibermap_cables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fibermap_cable_slacks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cable_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "position" VARCHAR(20) NOT NULL DEFAULT 'AT_ELEMENT',
    "length_m" DECIMAL(10,2) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fibermap_cable_slacks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fibermap_cable_slacks_length_chk" CHECK ("length_m" > 0)
);

CREATE INDEX "fibermap_cable_slacks_tenant_id_cable_id_idx" ON "fibermap_cable_slacks"("tenant_id", "cable_id");
CREATE INDEX "fibermap_cable_slacks_element_id_idx" ON "fibermap_cable_slacks"("element_id");

ALTER TABLE "fibermap_cable_slacks" ADD CONSTRAINT "fibermap_cable_slacks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_cable_slacks" ADD CONSTRAINT "fibermap_cable_slacks_cable_id_fkey" FOREIGN KEY ("cable_id") REFERENCES "fibermap_cables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_cable_slacks" ADD CONSTRAINT "fibermap_cable_slacks_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "fibermap_elements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_cable_slacks" ADD CONSTRAINT "fibermap_cable_slacks_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "fibermap_cable_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Grafo lógico: devices, portas, cortes, conexões
-- -----------------------------------------------------------------------------
CREATE TABLE "fibermap_devices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "parent_device_id" UUID,
    "product_id" UUID,
    "type" "FibermapDeviceType" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fibermap_devices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fibermap_devices_tenant_id_element_id_idx" ON "fibermap_devices"("tenant_id", "element_id");
CREATE INDEX "fibermap_devices_element_id_type_idx" ON "fibermap_devices"("element_id", "type");

ALTER TABLE "fibermap_devices" ADD CONSTRAINT "fibermap_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_devices" ADD CONSTRAINT "fibermap_devices_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "fibermap_elements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_devices" ADD CONSTRAINT "fibermap_devices_parent_device_id_fkey" FOREIGN KEY ("parent_device_id") REFERENCES "fibermap_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fibermap_devices" ADD CONSTRAINT "fibermap_devices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "fibermap_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fibermap_devices" ADD CONSTRAINT "fibermap_devices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fibermap_devices" ADD CONSTRAINT "fibermap_devices_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "fibermap_optical_ports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "role" "FibermapPortRole" NOT NULL,
    "port_number" INTEGER NOT NULL,
    "label" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fibermap_optical_ports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fibermap_optical_ports_number_chk" CHECK ("port_number" >= 1)
);

CREATE UNIQUE INDEX "fibermap_optical_ports_device_id_role_port_number_key" ON "fibermap_optical_ports"("device_id", "role", "port_number");
CREATE INDEX "fibermap_optical_ports_tenant_id_idx" ON "fibermap_optical_ports"("tenant_id");

ALTER TABLE "fibermap_optical_ports" ADD CONSTRAINT "fibermap_optical_ports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_optical_ports" ADD CONSTRAINT "fibermap_optical_ports_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "fibermap_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fibermap_fiber_cuts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fiber_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fibermap_fiber_cuts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fibermap_fiber_cuts_fiber_id_element_id_key" ON "fibermap_fiber_cuts"("fiber_id", "element_id");
CREATE INDEX "fibermap_fiber_cuts_tenant_id_element_id_idx" ON "fibermap_fiber_cuts"("tenant_id", "element_id");

ALTER TABLE "fibermap_fiber_cuts" ADD CONSTRAINT "fibermap_fiber_cuts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_fiber_cuts" ADD CONSTRAINT "fibermap_fiber_cuts_fiber_id_fkey" FOREIGN KEY ("fiber_id") REFERENCES "fibermap_fibers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_fiber_cuts" ADD CONSTRAINT "fibermap_fiber_cuts_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "fibermap_elements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Conexões: endpoints polimórficos com CHECKs de coerência (spec §3.5/§4).
CREATE TABLE "fibermap_optical_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "kind" "FibermapConnectionKind" NOT NULL,
    "a_type" "FibermapEndpointType" NOT NULL,
    "a_fiber_id" UUID,
    "a_fiber_side" "FibermapFiberSide",
    "a_cut_id" UUID,
    "a_port_id" UUID,
    "b_type" "FibermapEndpointType" NOT NULL,
    "b_fiber_id" UUID,
    "b_fiber_side" "FibermapFiberSide",
    "b_cut_id" UUID,
    "b_port_id" UUID,
    "loss_db" DECIMAL(5,2),
    "notes" TEXT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fibermap_optical_connections_pkey" PRIMARY KEY ("id"),
    -- FIBER_END ⇔ fiber_id preenchido; PORT ⇔ port_id preenchido
    CONSTRAINT "fibermap_conn_a_fiber_chk" CHECK (("a_type" = 'FIBER_END') = ("a_fiber_id" IS NOT NULL)),
    CONSTRAINT "fibermap_conn_b_fiber_chk" CHECK (("b_type" = 'FIBER_END') = ("b_fiber_id" IS NOT NULL)),
    CONSTRAINT "fibermap_conn_a_port_chk" CHECK (("a_type" = 'PORT') = ("a_port_id" IS NOT NULL)),
    CONSTRAINT "fibermap_conn_b_port_chk" CHECK (("b_type" = 'PORT') = ("b_port_id" IS NOT NULL)),
    -- lado: obrigatório em FIBER_END, proibido em PORT
    CONSTRAINT "fibermap_conn_a_side_chk" CHECK (("a_type" = 'FIBER_END') = ("a_fiber_side" IS NOT NULL)),
    CONSTRAINT "fibermap_conn_b_side_chk" CHECK (("b_type" = 'FIBER_END') = ("b_fiber_side" IS NOT NULL)),
    -- ponta de corte usa lados U/D; ponta de extremidade usa A/B
    CONSTRAINT "fibermap_conn_a_cut_chk" CHECK ("a_cut_id" IS NULL OR ("a_type" = 'FIBER_END' AND "a_fiber_side" IN ('U', 'D'))),
    CONSTRAINT "fibermap_conn_b_cut_chk" CHECK ("b_cut_id" IS NULL OR ("b_type" = 'FIBER_END' AND "b_fiber_side" IN ('U', 'D'))),
    CONSTRAINT "fibermap_conn_a_end_chk" CHECK ("a_type" <> 'FIBER_END' OR "a_cut_id" IS NOT NULL OR "a_fiber_side" IN ('A', 'B')),
    CONSTRAINT "fibermap_conn_b_end_chk" CHECK ("b_type" <> 'FIBER_END' OR "b_cut_id" IS NOT NULL OR "b_fiber_side" IN ('A', 'B')),
    CONSTRAINT "fibermap_conn_loss_chk" CHECK ("loss_db" IS NULL OR ("loss_db" >= 0 AND "loss_db" <= 60))
);

CREATE INDEX "fibermap_optical_connections_tenant_id_element_id_idx" ON "fibermap_optical_connections"("tenant_id", "element_id");
CREATE INDEX "fibermap_optical_connections_a_fiber_id_idx" ON "fibermap_optical_connections"("a_fiber_id");
CREATE INDEX "fibermap_optical_connections_b_fiber_id_idx" ON "fibermap_optical_connections"("b_fiber_id");
CREATE INDEX "fibermap_optical_connections_a_port_id_idx" ON "fibermap_optical_connections"("a_port_id");
CREATE INDEX "fibermap_optical_connections_b_port_id_idx" ON "fibermap_optical_connections"("b_port_id");

ALTER TABLE "fibermap_optical_connections" ADD CONSTRAINT "fibermap_optical_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_optical_connections" ADD CONSTRAINT "fibermap_optical_connections_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "fibermap_elements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_optical_connections" ADD CONSTRAINT "fibermap_optical_connections_a_fiber_id_fkey" FOREIGN KEY ("a_fiber_id") REFERENCES "fibermap_fibers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_optical_connections" ADD CONSTRAINT "fibermap_optical_connections_b_fiber_id_fkey" FOREIGN KEY ("b_fiber_id") REFERENCES "fibermap_fibers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_optical_connections" ADD CONSTRAINT "fibermap_optical_connections_a_cut_id_fkey" FOREIGN KEY ("a_cut_id") REFERENCES "fibermap_fiber_cuts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_optical_connections" ADD CONSTRAINT "fibermap_optical_connections_b_cut_id_fkey" FOREIGN KEY ("b_cut_id") REFERENCES "fibermap_fiber_cuts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_optical_connections" ADD CONSTRAINT "fibermap_optical_connections_a_port_id_fkey" FOREIGN KEY ("a_port_id") REFERENCES "fibermap_optical_ports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_optical_connections" ADD CONSTRAINT "fibermap_optical_connections_b_port_id_fkey" FOREIGN KEY ("b_port_id") REFERENCES "fibermap_optical_ports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fibermap_optical_connections" ADD CONSTRAINT "fibermap_optical_connections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fibermap_optical_connections" ADD CONSTRAINT "fibermap_optical_connections_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ocupação de endpoint — o cadeado anti-fusão-duplicada (aceite FM-0):
-- 'FIBER:{fiberId}:{A|B}' · 'CUT:{cutId}:{U|D}' · 'PORT:{portId}:{C|F}'
-- (porta tem 2 faces: C=adaptador frontal/conector, F=pigtail traseiro/fusão).
-- UNIQUE global (chaves embutem UUID ⇒ sem colisão entre tenants). Linhas são
-- hard-deletadas ao desfazer a conexão (a conexão em si fica soft-deletada).
CREATE TABLE "fibermap_connection_endpoints" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "endpoint_key" VARCHAR(120) NOT NULL,

    CONSTRAINT "fibermap_connection_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fibermap_connection_endpoints_endpoint_key_key" ON "fibermap_connection_endpoints"("endpoint_key");
CREATE INDEX "fibermap_connection_endpoints_connection_id_idx" ON "fibermap_connection_endpoints"("connection_id");

ALTER TABLE "fibermap_connection_endpoints" ADD CONSTRAINT "fibermap_connection_endpoints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fibermap_connection_endpoints" ADD CONSTRAINT "fibermap_connection_endpoints_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "fibermap_optical_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Medições
-- -----------------------------------------------------------------------------
CREATE TABLE "fibermap_otdr_readings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reference_kind" "FibermapOtdrReferenceKind" NOT NULL,
    "reference_element_id" UUID,
    "reference_port_id" UUID,
    "cable_id" UUID NOT NULL,
    "fiber_number" INTEGER NOT NULL,
    "direction_element_id" UUID NOT NULL,
    "distance_m" DECIMAL(10,2) NOT NULL,
    "wavelength_nm" INTEGER NOT NULL DEFAULT 1550,
    "event_type" "FibermapOtdrEventType" NOT NULL DEFAULT 'BREAK',
    "result" JSONB,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fibermap_otdr_readings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fibermap_otdr_readings_distance_chk" CHECK ("distance_m" >= 0),
    CONSTRAINT "fibermap_otdr_readings_ref_chk" CHECK (
        ("reference_kind" = 'ELEMENT' AND "reference_element_id" IS NOT NULL)
        OR ("reference_kind" = 'PORT' AND "reference_port_id" IS NOT NULL)
    )
);

CREATE INDEX "fibermap_otdr_readings_tenant_id_cable_id_idx" ON "fibermap_otdr_readings"("tenant_id", "cable_id");
CREATE INDEX "fibermap_otdr_readings_tenant_id_created_at_idx" ON "fibermap_otdr_readings"("tenant_id", "created_at");

ALTER TABLE "fibermap_otdr_readings" ADD CONSTRAINT "fibermap_otdr_readings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fibermap_power_measurements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "port_id" UUID,
    "fiber_id" UUID,
    "element_id" UUID,
    "wavelength_nm" INTEGER NOT NULL DEFAULT 1490,
    "dbm" DECIMAL(6,2) NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fibermap_power_measurements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fibermap_power_measurements_tenant_id_port_id_idx" ON "fibermap_power_measurements"("tenant_id", "port_id");
CREATE INDEX "fibermap_power_measurements_tenant_id_element_id_idx" ON "fibermap_power_measurements"("tenant_id", "element_id");

ALTER TABLE "fibermap_power_measurements" ADD CONSTRAINT "fibermap_power_measurements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fibermap_attenuation_defaults" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_key" VARCHAR(40) NOT NULL,
    "value_db" DECIMAL(6,3) NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fibermap_attenuation_defaults_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fibermap_attenuation_defaults_value_chk" CHECK ("value_db" >= 0 AND "value_db" <= 60)
);

CREATE UNIQUE INDEX "fibermap_attenuation_defaults_tenant_id_item_key_key" ON "fibermap_attenuation_defaults"("tenant_id", "item_key");

ALTER TABLE "fibermap_attenuation_defaults" ADD CONSTRAINT "fibermap_attenuation_defaults_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
