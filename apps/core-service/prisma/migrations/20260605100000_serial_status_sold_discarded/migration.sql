-- Novos status de saída do patrimônio: vendido e inutilizado/sucateado.
-- ADD VALUE em migration própria (sem outras DDLs que usem o valor novo).

ALTER TYPE "SerialStatus" ADD VALUE IF NOT EXISTS 'SOLD';
ALTER TYPE "SerialStatus" ADD VALUE IF NOT EXISTS 'DISCARDED';
