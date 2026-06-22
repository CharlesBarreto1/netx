-- AlterTable: contadores de bytes da WAN PPPoE (base do throughput)
ALTER TABLE "tr069_diagnostics" ADD COLUMN     "wan_rx_bytes" BIGINT,
ADD COLUMN     "wan_tx_bytes" BIGINT;
