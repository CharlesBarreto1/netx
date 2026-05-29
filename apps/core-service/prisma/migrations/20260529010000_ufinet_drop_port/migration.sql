-- Porta do drop (1..16) informada pelo técnico — controle interno do NetX.
-- A Ufinet controla só a CAIXA (CTO), enviada em cto_port; a porta NÃO vai pra
-- eles, fica só pra nossa documentação.
ALTER TABLE "ufinet_services" ADD COLUMN "drop_port" VARCHAR(16);
