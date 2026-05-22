-- =============================================================================
-- Ont.wifiBandMode — comportamento de Wi-Fi por modelo de ONT
-- =============================================================================
-- Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
--
-- BAND_STEERING — SSID único nas 2 bandas (EG8145X6, EG8145-X10).
-- DUAL_BAND     — SSIDs separados (EG8145V5): 2.4G nome normal, 5G "5G-"+nome.
--
-- CREATE TYPE (enum novo) pode rodar na mesma transação que o ALTER TABLE —
-- diferente de ALTER TYPE ... ADD VALUE. Sem migration separada.
-- =============================================================================
CREATE TYPE "WifiBandMode" AS ENUM ('BAND_STEERING', 'DUAL_BAND');

ALTER TABLE "onts"
  ADD COLUMN "wifi_band_mode" "WifiBandMode" NOT NULL DEFAULT 'BAND_STEERING';
