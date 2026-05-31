-- Adiciona BOLETO ao enum PaymentMethod (baixa de fatura paga via boleto/Bolix do EFI).
-- ADD VALUE roda fora de transação no Prisma; não pode ser usado no mesmo
-- migration que o referencia — por isso fica isolado (mesmo padrão das migrations
-- de CashMovementSource).
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'BOLETO';
