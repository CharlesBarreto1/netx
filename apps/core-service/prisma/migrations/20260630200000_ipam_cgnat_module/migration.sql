-- =============================================================================
-- IPAM (documentação de IPs) + CGNAT determinístico
-- Adiciona 6 tabelas (ipam_*) e 6 enums. Nenhuma coluna nova em tabelas
-- existentes — as relações em Tenant/Customer/Contract/NetworkEquipment/
-- NetworkPop são back-relations (a FK vive no lado IPAM).
-- =============================================================================

-- CreateEnum
CREATE TYPE "IpVersion" AS ENUM ('V4', 'V6');

-- CreateEnum
CREATE TYPE "IpamPrefixRole" AS ENUM ('SUPERNET', 'CUSTOMER', 'CGNAT_POOL', 'PUBLIC_POOL', 'MANAGEMENT', 'LOOPBACK', 'P2P', 'DHCP', 'OTHER');

-- CreateEnum
CREATE TYPE "IpamPrefixStatus" AS ENUM ('ACTIVE', 'RESERVED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "IpamAddressStatus" AS ENUM ('FREE', 'USED', 'RESERVED', 'DHCP', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "IpamAddressKind" AS ENUM ('CONTRACT', 'EQUIPMENT', 'CUSTOMER', 'GATEWAY', 'OTHER');

-- CreateEnum
CREATE TYPE "IpamCgnatAlgo" AS ENUM ('LINEAR');

-- CreateTable
CREATE TABLE "ipam_vrfs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "rd" VARCHAR(32),
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipam_vrfs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipam_prefixes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vrf_id" UUID,
    "parent_id" UUID,
    "cidr" VARCHAR(49) NOT NULL,
    "version" "IpVersion" NOT NULL,
    "prefix_len" INTEGER NOT NULL,
    "first_addr" DECIMAL(40,0) NOT NULL,
    "last_addr" DECIMAL(40,0) NOT NULL,
    "role" "IpamPrefixRole" NOT NULL DEFAULT 'OTHER',
    "status" "IpamPrefixStatus" NOT NULL DEFAULT 'ACTIVE',
    "vlan_id" INTEGER,
    "gateway" VARCHAR(45),
    "description" VARCHAR(255),
    "pop_id" UUID,
    "equipment_id" UUID,
    "customer_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ipam_prefixes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipam_addresses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "prefix_id" UUID NOT NULL,
    "vrf_id" UUID,
    "address" VARCHAR(45) NOT NULL,
    "addr_num" DECIMAL(40,0) NOT NULL,
    "version" "IpVersion" NOT NULL,
    "status" "IpamAddressStatus" NOT NULL DEFAULT 'FREE',
    "kind" "IpamAddressKind",
    "customer_id" UUID,
    "contract_id" UUID,
    "equipment_id" UUID,
    "mac_address" VARCHAR(17),
    "hostname" VARCHAR(255),
    "description" VARCHAR(255),
    "is_gateway" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(16),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipam_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipam_pools" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "prefix_id" UUID NOT NULL,
    "vrf_id" UUID,
    "name" VARCHAR(64) NOT NULL,
    "version" "IpVersion" NOT NULL,
    "range_start" VARCHAR(45) NOT NULL,
    "range_end" VARCHAR(45) NOT NULL,
    "start_num" DECIMAL(40,0) NOT NULL,
    "end_num" DECIMAL(40,0) NOT NULL,
    "description" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipam_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipam_cgnat_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "public_prefix_id" UUID NOT NULL,
    "cgnat_prefix_id" UUID NOT NULL,
    "ports_per_client" INTEGER NOT NULL DEFAULT 1000,
    "port_base" INTEGER NOT NULL DEFAULT 1024,
    "max_port" INTEGER NOT NULL DEFAULT 65535,
    "algorithm" "IpamCgnatAlgo" NOT NULL DEFAULT 'LINEAR',
    "description" VARCHAR(255),
    "generated_at" TIMESTAMP(3),
    "entry_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ipam_cgnat_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipam_cgnat_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "private_ip" VARCHAR(45) NOT NULL,
    "private_num" DECIMAL(40,0) NOT NULL,
    "public_ip" VARCHAR(45) NOT NULL,
    "public_num" DECIMAL(40,0) NOT NULL,
    "port_start" INTEGER NOT NULL,
    "port_end" INTEGER NOT NULL,
    "contract_id" UUID,
    "customer_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ipam_cgnat_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ipam_vrfs_tenant_id_name_key" ON "ipam_vrfs"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "ipam_prefixes_tenant_id_first_addr_last_addr_idx" ON "ipam_prefixes"("tenant_id", "first_addr", "last_addr");

-- CreateIndex
CREATE INDEX "ipam_prefixes_tenant_id_role_idx" ON "ipam_prefixes"("tenant_id", "role");

-- CreateIndex
CREATE INDEX "ipam_prefixes_tenant_id_status_idx" ON "ipam_prefixes"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "ipam_prefixes_tenant_id_customer_id_idx" ON "ipam_prefixes"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "ipam_prefixes_equipment_id_idx" ON "ipam_prefixes"("equipment_id");

-- CreateIndex
CREATE INDEX "ipam_prefixes_parent_id_idx" ON "ipam_prefixes"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "ipam_prefixes_tenant_id_vrf_id_cidr_key" ON "ipam_prefixes"("tenant_id", "vrf_id", "cidr");

-- CreateIndex
CREATE INDEX "ipam_addresses_tenant_id_status_idx" ON "ipam_addresses"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "ipam_addresses_tenant_id_customer_id_idx" ON "ipam_addresses"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "ipam_addresses_tenant_id_prefix_id_idx" ON "ipam_addresses"("tenant_id", "prefix_id");

-- CreateIndex
CREATE INDEX "ipam_addresses_equipment_id_idx" ON "ipam_addresses"("equipment_id");

-- CreateIndex
CREATE INDEX "ipam_addresses_addr_num_idx" ON "ipam_addresses"("addr_num");

-- CreateIndex
CREATE UNIQUE INDEX "ipam_addresses_tenant_id_vrf_id_addr_num_key" ON "ipam_addresses"("tenant_id", "vrf_id", "addr_num");

-- CreateIndex
CREATE UNIQUE INDEX "ipam_addresses_contract_id_key" ON "ipam_addresses"("contract_id");

-- CreateIndex
CREATE INDEX "ipam_pools_tenant_id_prefix_id_idx" ON "ipam_pools"("tenant_id", "prefix_id");

-- CreateIndex
CREATE UNIQUE INDEX "ipam_pools_tenant_id_name_key" ON "ipam_pools"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ipam_cgnat_plans_tenant_id_name_key" ON "ipam_cgnat_plans"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "ipam_cgnat_entries_tenant_id_public_num_port_start_idx" ON "ipam_cgnat_entries"("tenant_id", "public_num", "port_start");

-- CreateIndex
CREATE INDEX "ipam_cgnat_entries_tenant_id_public_ip_idx" ON "ipam_cgnat_entries"("tenant_id", "public_ip");

-- CreateIndex
CREATE INDEX "ipam_cgnat_entries_tenant_id_private_ip_idx" ON "ipam_cgnat_entries"("tenant_id", "private_ip");

-- CreateIndex
CREATE INDEX "ipam_cgnat_entries_tenant_id_contract_id_idx" ON "ipam_cgnat_entries"("tenant_id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "ipam_cgnat_entries_plan_id_private_num_key" ON "ipam_cgnat_entries"("plan_id", "private_num");

-- AddForeignKey
ALTER TABLE "ipam_vrfs" ADD CONSTRAINT "ipam_vrfs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_prefixes" ADD CONSTRAINT "ipam_prefixes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_prefixes" ADD CONSTRAINT "ipam_prefixes_vrf_id_fkey" FOREIGN KEY ("vrf_id") REFERENCES "ipam_vrfs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_prefixes" ADD CONSTRAINT "ipam_prefixes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ipam_prefixes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_prefixes" ADD CONSTRAINT "ipam_prefixes_pop_id_fkey" FOREIGN KEY ("pop_id") REFERENCES "network_pops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_prefixes" ADD CONSTRAINT "ipam_prefixes_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "network_equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_prefixes" ADD CONSTRAINT "ipam_prefixes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_addresses" ADD CONSTRAINT "ipam_addresses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_addresses" ADD CONSTRAINT "ipam_addresses_prefix_id_fkey" FOREIGN KEY ("prefix_id") REFERENCES "ipam_prefixes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_addresses" ADD CONSTRAINT "ipam_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_addresses" ADD CONSTRAINT "ipam_addresses_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_addresses" ADD CONSTRAINT "ipam_addresses_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "network_equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_pools" ADD CONSTRAINT "ipam_pools_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_pools" ADD CONSTRAINT "ipam_pools_prefix_id_fkey" FOREIGN KEY ("prefix_id") REFERENCES "ipam_prefixes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_cgnat_plans" ADD CONSTRAINT "ipam_cgnat_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_cgnat_plans" ADD CONSTRAINT "ipam_cgnat_plans_public_prefix_id_fkey" FOREIGN KEY ("public_prefix_id") REFERENCES "ipam_prefixes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_cgnat_plans" ADD CONSTRAINT "ipam_cgnat_plans_cgnat_prefix_id_fkey" FOREIGN KEY ("cgnat_prefix_id") REFERENCES "ipam_prefixes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_cgnat_entries" ADD CONSTRAINT "ipam_cgnat_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_cgnat_entries" ADD CONSTRAINT "ipam_cgnat_entries_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ipam_cgnat_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_cgnat_entries" ADD CONSTRAINT "ipam_cgnat_entries_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipam_cgnat_entries" ADD CONSTRAINT "ipam_cgnat_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial UNIQUE indexes (vrf_id IS NULL) — o @@unique composto não barra
-- duplicatas quando vrf_id é NULL (Postgres trata NULLs como distintos). Estes
-- garantem "nunca 2 IPs/prefixos iguais no VRF default". Padrão de UNIQUE parcial
-- via raw SQL já usado no repo (ver Contract.pppoeUsername). Não representados no
-- schema.prisma (aparecem como drift benigno em diffs futuros — esperado).
CREATE UNIQUE INDEX "ipam_addresses_tenant_addr_novrf_key" ON "ipam_addresses"("tenant_id", "addr_num") WHERE "vrf_id" IS NULL;
CREATE UNIQUE INDEX "ipam_prefixes_tenant_cidr_novrf_key" ON "ipam_prefixes"("tenant_id", "cidr") WHERE "vrf_id" IS NULL;
