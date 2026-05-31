import { z } from 'zod';

export const CashMovementTypeSchema = z.enum([
  'INCOME',
  'OUTCOME',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT',
]);
export type CashMovementType = z.infer<typeof CashMovementTypeSchema>;

export const CashMovementSourceSchema = z.enum([
  'INVOICE',
  'CHARGE',
  'TRANSFER',
  'MANUAL',
  'FLEET_EXPENSE',
  'PAYROLL',
]);
export type CashMovementSource = z.infer<typeof CashMovementSourceSchema>;

// Transferência entre 2 caixas. Cria 2 movements numa transação.
export const CreateTransferRequestSchema = z.object({
  toCashRegisterId: z.string().uuid(),
  amount: z.coerce.number().positive().max(10_000_000),
  description: z.string().max(500).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateTransferRequest = z.infer<typeof CreateTransferRequestSchema>;

// Ajuste manual de saldo / sangria. type=ADJUSTMENT (positivo) ou OUTCOME.
export const CreateMovementRequestSchema = z.object({
  type: z.enum(['INCOME', 'OUTCOME', 'ADJUSTMENT']),
  amount: z.coerce.number().positive().max(10_000_000),
  description: z.string().max(500).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateMovementRequest = z.infer<typeof CreateMovementRequestSchema>;

export const ListMovementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  type: CashMovementTypeSchema.optional(),
  source: CashMovementSourceSchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
export type ListMovementsQuery = z.infer<typeof ListMovementsQuerySchema>;

export interface CashMovementResponse {
  id: string;
  tenantId: string;
  cashRegisterId: string;
  type: CashMovementType;
  source: CashMovementSource;
  amount: number;
  description: string | null;
  occurredAt: string;
  sourceId: string | null;
  transferGroupId: string | null;
  createdById: string | null;
  createdAt: string;
  // Quando for TRANSFER, expomos o "outro lado" pra UI mostrar destino/origem.
  counterpart?: {
    cashRegisterId: string;
    cashRegisterName: string;
  } | null;
}

export interface CashRegisterBalanceResponse {
  cashRegisterId: string;
  openingBalance: number;
  // Soma assinada de todos os movements (INCOME/TRANSFER_IN/ADJUSTMENT > 0;
  // OUTCOME/TRANSFER_OUT < 0).
  movementsTotal: number;
  // openingBalance + movementsTotal.
  currentBalance: number;
  // Totais por tipo (sempre positivos).
  byType: {
    income: number;
    outcome: number;
    transferIn: number;
    transferOut: number;
    adjustment: number;
  };
}
