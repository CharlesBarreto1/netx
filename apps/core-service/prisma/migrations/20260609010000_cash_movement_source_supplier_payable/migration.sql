-- Novo source de movimento de caixa: pagamento a fornecedor (contas a pagar).
-- ADD VALUE em migration própria (sem outras DDLs que usem o valor novo).

ALTER TYPE "CashMovementSource" ADD VALUE IF NOT EXISTS 'SUPPLIER_PAYABLE';
