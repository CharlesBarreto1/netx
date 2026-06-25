-- Adiciona o vendor `mikrotik` ao enum Vendor (NMS multi-vendor: Juniper + Mikrotik).
-- ADD VALUE é idempotente com IF NOT EXISTS; PG16 aceita dentro de transação
-- desde que o valor novo não seja usado na mesma transação (não é).
ALTER TYPE "Vendor" ADD VALUE IF NOT EXISTS 'mikrotik';
