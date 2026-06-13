-- Frota: ícone do veículo no mapa + base do status "parado há X min".
-- CREATE TYPE novo pode coabitar com ALTER TABLE que o usa (só ALTER TYPE
-- ADD VALUE exige migration separada).
CREATE TYPE "VehicleMapIcon" AS ENUM ('RED_CAR', 'LADDER_CAR', 'WHITE_VAN', 'TRUCK');

ALTER TABLE "vehicles"
  ADD COLUMN "map_icon" "VehicleMapIcon" NOT NULL DEFAULT 'RED_CAR';

-- Última vez que o veículo esteve em movimento (speed > limiar). Permite
-- distinguir "ligado andando" de "ligado parado há mais de N minutos".
ALTER TABLE "vehicle_positions"
  ADD COLUMN "last_moved_at" TIMESTAMP(3);
