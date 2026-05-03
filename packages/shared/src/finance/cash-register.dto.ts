import { z } from 'zod';

/** Tipo de caixa — espelha o enum Prisma. */
export const CashRegisterTypeSchema = z.enum([
  'CASH',
  'BANK',
  'PIX',
  'CARD',
  'OTHER',
]);
export type CashRegisterType = z.infer<typeof CashRegisterTypeSchema>;

/** Nível de acesso do user no caixa. */
export const CashRegisterRoleSchema = z.enum(['OPERATOR', 'VIEWER']);
export type CashRegisterRole = z.infer<typeof CashRegisterRoleSchema>;

// =============================================================================
// CRUD
// =============================================================================
export const CreateCashRegisterRequestSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  type: CashRegisterTypeSchema.default('CASH'),
  /** Hex color (ex.: '#2563eb'). Opcional. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/u, 'Hex color (#rrggbb)')
    .nullish(),
  /** Se vazio, herda do tenant. */
  currency: z.string().length(3).toUpperCase().optional(),
  isActive: z.boolean().default(true),
  openingBalance: z.coerce.number().min(0).default(0),
  /**
   * IDs de usuários que devem entrar como OPERATOR no caixa já no create.
   * Conveniência — pode ser ajustado depois via /memberships.
   */
  operatorUserIds: z.array(z.string().uuid()).default([]),
});
export type CreateCashRegisterRequest = z.infer<
  typeof CreateCashRegisterRequestSchema
>;

export const UpdateCashRegisterRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).nullish(),
    type: CashRegisterTypeSchema.optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/u)
      .nullish(),
    currency: z.string().length(3).toUpperCase().optional(),
    isActive: z.boolean().optional(),
    openingBalance: z.coerce.number().min(0).optional(),
  })
  .strict();
export type UpdateCashRegisterRequest = z.infer<
  typeof UpdateCashRegisterRequestSchema
>;

export const ListCashRegistersQuerySchema = z.object({
  /** Quando true, ignora `isActive` e o membership do user (precisa de
   *  cash_registers.manage). Default: só ativos visíveis pelo user. */
  includeInactive: z.coerce.boolean().default(false),
});
export type ListCashRegistersQuery = z.infer<typeof ListCashRegistersQuerySchema>;

// =============================================================================
// MEMBERSHIPS (gerenciar acesso ao caixa)
// =============================================================================
export const AddCashRegisterMemberRequestSchema = z.object({
  userId: z.string().uuid(),
  role: CashRegisterRoleSchema.default('OPERATOR'),
});
export type AddCashRegisterMemberRequest = z.infer<
  typeof AddCashRegisterMemberRequestSchema
>;

// =============================================================================
// RESPONSE
// =============================================================================
export interface CashRegisterMemberResponse {
  userId: string;
  role: CashRegisterRole;
  user: { id: string; firstName: string; lastName: string; email: string };
  createdAt: string;
}

export interface CashRegisterResponse {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: CashRegisterType;
  color: string | null;
  currency: string;
  isActive: boolean;
  openingBalance: number;
  /** Saldo computado = openingBalance + somatório de pagamentos do caixa. */
  currentBalance?: number;
  /** Membros — só vem em GET /:id (lista detalhada). */
  members?: CashRegisterMemberResponse[];
  createdAt: string;
  updatedAt: string;
}
