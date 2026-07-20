-- Adiciona o vendor `parks` ao enum Vendor (switches Parks PK900, Parks OS).
-- ADD VALUE é idempotente com IF NOT EXISTS; PG16 aceita dentro de transação
-- desde que o valor novo não seja usado na mesma transação (não é).
ALTER TYPE "Vendor" ADD VALUE IF NOT EXISTS 'parks';
