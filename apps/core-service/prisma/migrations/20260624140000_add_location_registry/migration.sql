-- AlterTable
ALTER TABLE "customer_addresses" ADD COLUMN     "ibge_code" CHAR(7);

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "address_complement" VARCHAR(120),
ADD COLUMN     "address_number" VARCHAR(32),
ADD COLUMN     "street_id" UUID;

-- CreateTable
CREATE TABLE "ibge_municipalities" (
    "codigo" CHAR(7) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "uf" CHAR(2) NOT NULL,

    CONSTRAINT "ibge_municipalities_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ibge_code" CHAR(7) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "uf" CHAR(2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neighborhoods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "neighborhoods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "neighborhood_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "postal_code" VARCHAR(8),
    "kind" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "streets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ibge_municipalities_uf_idx" ON "ibge_municipalities"("uf");

-- CreateIndex
CREATE INDEX "ibge_municipalities_nome_idx" ON "ibge_municipalities"("nome");

-- CreateIndex
CREATE INDEX "cities_tenant_id_name_idx" ON "cities"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cities_tenant_id_ibge_code_key" ON "cities"("tenant_id", "ibge_code");

-- CreateIndex
CREATE INDEX "neighborhoods_tenant_id_city_id_idx" ON "neighborhoods"("tenant_id", "city_id");

-- CreateIndex
CREATE UNIQUE INDEX "neighborhoods_tenant_id_city_id_name_key" ON "neighborhoods"("tenant_id", "city_id", "name");

-- CreateIndex
CREATE INDEX "streets_tenant_id_postal_code_idx" ON "streets"("tenant_id", "postal_code");

-- CreateIndex
CREATE INDEX "streets_tenant_id_city_id_idx" ON "streets"("tenant_id", "city_id");

-- CreateIndex
CREATE UNIQUE INDEX "streets_tenant_id_city_id_name_postal_code_key" ON "streets"("tenant_id", "city_id", "name", "postal_code");

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_ibge_code_fkey" FOREIGN KEY ("ibge_code") REFERENCES "ibge_municipalities"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streets" ADD CONSTRAINT "streets_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streets" ADD CONSTRAINT "streets_neighborhood_id_fkey" FOREIGN KEY ("neighborhood_id") REFERENCES "neighborhoods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_street_id_fkey" FOREIGN KEY ("street_id") REFERENCES "streets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

