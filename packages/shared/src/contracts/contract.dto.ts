import { z } from 'zod';

// -----------------------------------------------------------------------------
// Enums (espelho do schema.prisma)
// -----------------------------------------------------------------------------
export const ContractStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'CANCELLED']);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const ContractSuspendReasonSchema = z.enum([
  'MANUAL',
  'OVERDUE_PAYMENT',
  'OTHER',
]);
export type ContractSuspendReason = z.infer<typeof ContractSuspendReasonSchema>;

// -----------------------------------------------------------------------------
// Create / Update
// -----------------------------------------------------------------------------
const baseContractFields = {
  pppoeUsername: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/u, 'pppoeUsername deve conter apenas letras, números, "." "_" "-"'),
  pppoePassword: z.string().min(4).max(128),
  installationAddress: z.string().min(5).max(500),
  monthlyValue: z.coerce.number().positive().max(1_000_000),
  bandwidthMbps: z.coerce.number().int().min(1).max(100_000),
  dueDay: z.coerce.number().int().min(1).max(28),
  notes: z.string().max(10_000).nullish(),
};

export const CreateContractRequestSchema = z.object({
  customerId: z.string().uuid(),
  code: z.string().max(32).optional(),
  ...baseContractFields,
  // Data opcional para a primeira fatura (se não vier, gera automaticamente).
  firstDueDate: z.string().date().optional(),
});
export type CreateContractRequest = z.infer<typeof CreateContractRequestSchema>;

export const UpdateContractRequestSchema = z
  .object({
    ...baseContractFields,
  })
  .partial();
export type UpdateContractRequest = z.infer<typeof UpdateContractRequestSchema>;

// -----------------------------------------------------------------------------
// Transições de estado (acionadas pelo usuário)
// -----------------------------------------------------------------------------
export const SuspendContractRequestSchema = z.object({
  reason: ContractSuspendReasonSchema.default('MANUAL'),
  note: z.string().max(500).optional(),
});
export type SuspendContractRequest = z.infer<typeof SuspendContractRequestSchema>;

export const ReactivateContractRequestSchema = z.object({
  note: z.string().max(500).optional(),
});
export type ReactivateContractRequest = z.infer<typeof ReactivateContractRequestSchema>;

export const CancelContractRequestSchema = z.object({
  note: z.string().max(500).optional(),
});
export type CancelContractRequest = z.infer<typeof CancelContractRequestSchema>;

// -----------------------------------------------------------------------------
// Listagem / busca
// -----------------------------------------------------------------------------
export const ListContractsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  customerId: z.string().uuid().optional(),
  status: ContractStatusSchema.optional(),
  pppoeUsername: z.string().max(64).optional(),
  search: z.string().max(255).optional(), // código / endereço / pppoe

  sortBy: z.enum(['createdAt', 'updatedAt', 'dueDay', 'monthlyValue']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListContractsQuery = z.infer<typeof ListContractsQuerySchema>;

// -----------------------------------------------------------------------------
// Response
// -----------------------------------------------------------------------------
export interface ContractResponse {
  id: string;
  tenantId: string;
  customerId: string;
  code: string | null;

  pppoeUsername: string;
  // Senha NUNCA retorna em listagens; só aparece em GET /:id para usuários com permissão.
  pppoePassword?: string;

  installationAddress: string;
  monthlyValue: number;
  bandwidthMbps: number;
  dueDay: number;

  status: ContractStatus;
  suspendReason: ContractSuspendReason | null;

  activatedAt: string | null;
  suspendedAt: string | null;
  cancelledAt: string | null;

  notes: string | null;

  createdAt: string;
  updatedAt: string;

  customer?: {
    id: string;
    displayName: string;
    type: 'INDIVIDUAL' | 'COMPANY';
  } | null;
}
