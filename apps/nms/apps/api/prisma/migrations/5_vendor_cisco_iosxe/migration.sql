-- Adiciona o vendor `cisco_iosxe` ao enum Vendor (Cisco ASR 920/903/1000 e demais IOS-XE).
-- Só IOS-XE: o IOS-XR (ASR 9000) tem outro modelo de commit e entraria como vendor próprio.
-- ADD VALUE é idempotente com IF NOT EXISTS; PG16 aceita dentro de transação
-- desde que o valor novo não seja usado na mesma transação (não é).
ALTER TYPE "Vendor" ADD VALUE IF NOT EXISTS 'cisco_iosxe';
