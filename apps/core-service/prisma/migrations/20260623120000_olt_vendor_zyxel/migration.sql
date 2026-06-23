-- =============================================================================
-- OltVendor: adiciona ZYXEL (OLT2406 e família — ZyNOS SSH CLI, driver DIRECT).
--
-- ALTER TYPE ... ADD VALUE não pode ser usado na MESMA transação em que é
-- criado (restrição do Postgres). Como só adicionamos o valor aqui — sem
-- usá-lo nesta migration — roda numa migration própria sem problema.
-- Posicionado antes de UFINET pra espelhar a ordem do schema.prisma.
-- =============================================================================
ALTER TYPE "OltVendor" ADD VALUE IF NOT EXISTS 'ZYXEL' BEFORE 'UFINET';
