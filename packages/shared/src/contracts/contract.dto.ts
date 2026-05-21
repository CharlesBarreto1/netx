import { z } from 'zod';

// -----------------------------------------------------------------------------
// Enums (espelho do schema.prisma)
// -----------------------------------------------------------------------------
export const ContractStatusSchema = z.enum([
  // Fase 1 ZTP: contrato criado pelo comercial mas ainda não foi
  // instalado/provisionado (técnico precisa visitar). Não aplica em RADIUS.
  'PENDING_INSTALL',
  'ACTIVE',
  'SUSPENDED',
  'CANCELLED',
]);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const ContractSuspendReasonSchema = z.enum([
  'MANUAL',
  'OVERDUE_PAYMENT',
  'OTHER',
]);
export type ContractSuspendReason = z.infer<typeof ContractSuspendReasonSchema>;

export const ContractAuthMethodSchema = z.enum(['PPPOE', 'IPOE']);
export type ContractAuthMethod = z.infer<typeof ContractAuthMethodSchema>;

// -----------------------------------------------------------------------------
// Validators de campo
// -----------------------------------------------------------------------------
// MAC address — aceita formato AA:BB:CC:DD:EE:FF, AA-BB-..., aabbccddeeff,
// e normaliza pra UPPER + ":". O service consome o resultado deste schema
// (z.preprocess) — quem chama recebe a forma canônica.
const macAddressSchema = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    const cleaned = v.replace(/[^0-9A-Fa-f]/gu, '').toUpperCase();
    if (cleaned.length !== 12) return v;
    return cleaned.match(/.{2}/gu)!.join(':');
  },
  z
    .string()
    .regex(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/u, 'MAC inválido (esperado AA:BB:CC:DD:EE:FF)'),
);

// IP framed — aceita IPv4 e IPv6 textual. Validação leve.
const framedIpSchema = z.string().max(45).refine(
  (v) =>
    /^(\d{1,3}\.){3}\d{1,3}$/u.test(v) /* v4 */ ||
    /^[0-9a-fA-F:]+$/u.test(v) /* v6 simplificado */,
  'IP inválido',
);

// -----------------------------------------------------------------------------
// Create / Update
// -----------------------------------------------------------------------------
// Campos comuns (não dependem de PPPoE/IPoE).
const commonContractFields = {
  installationAddress: z.string().min(5).max(500),
  // Link de localização (Google Maps / OSM / Apple Maps). Validação leve:
  // só exige URL válida; aceitar qualquer host pra não amarrar a um provedor.
  installationMapsUrl: z.string().url().max(500).nullish(),
  monthlyValue: z.coerce.number().positive().max(1_000_000),
  bandwidthMbps: z.coerce.number().int().min(1).max(100_000),
  dueDay: z.coerce.number().int().min(1).max(28),
  notes: z.string().max(10_000).nullish(),
};

// Bloco PPPoE — usuário/senha obrigatórios.
const pppoeFields = {
  authMethod: z.literal('PPPOE'),
  pppoeUsername: z
    .string()
    .min(3)
    .max(64)
    .regex(
      /^[A-Za-z0-9._-]+$/u,
      'pppoeUsername deve conter apenas letras, números, "." "_" "-"',
    ),
  // min(8): senha PPPoE viaja como CHAP-Password OU PAP em RADIUS — CHAP
  // já é fraco (MD5 + challenge), PAP é literalmente plaintext sobre o RADIUS.
  // Mínimo de 8 chars com a regex acima (alfanumérico) impede dicionário.
  pppoePassword: z.string().min(8).max(128),
};

// Bloco IPoE — pelo menos circuitId OU macAddress quando ACTIVE. Refinado
// abaixo. Quando `initialStatus === 'PENDING_INSTALL'` a regra é relaxada
// (técnico em campo vai preencher SN/MAC via /provisioning/install).
const ipoeFields = {
  authMethod: z.literal('IPOE'),
  circuitId: z.string().min(1).max(128).nullish(),
  remoteId: z.string().max(128).nullish(),
  macAddress: macAddressSchema.nullish(),
  framedIpAddress: framedIpSchema.nullish(),
  vlanId: z.coerce.number().int().min(1).max(4094).nullish(),
};

// initialStatus: comercial escolhe se o contrato já entra ACTIVE (caso clássico:
// instalação já feita) ou PENDING_INSTALL (caso ZTP: técnico vai instalar em
// campo via /provisioning/install). PPPoE só permite ACTIVE — em PPPoE não há
// fluxo de instalação separado, user/senha já é tudo que precisa.
const initialStatusField = {
  initialStatus: z.enum(['ACTIVE', 'PENDING_INSTALL']).default('ACTIVE'),
};

// CreateContract: discriminated union pra que o backend não precise validar
// à mão a coerência entre authMethod e os campos de cada bloco.
//
// IMPORTANTE: cada branch tem que ser um `ZodObject` puro — `discriminatedUnion`
// do Zod v3 não aceita `ZodEffects` (o que `superRefine` produz). Por isso a
// regra "IPoE exige circuit OU mac" mora num `.superRefine` aplicado no
// resultado da union, não dentro de uma branch.
export const CreateContractRequestSchema = z
  .discriminatedUnion('authMethod', [
    z.object({
      customerId: z.string().uuid(),
      code: z.string().max(32).optional(),
      firstDueDate: z.string().date().optional(),
      ...commonContractFields,
      ...pppoeFields,
      ...initialStatusField,
    }),
    z.object({
      customerId: z.string().uuid(),
      code: z.string().max(32).optional(),
      firstDueDate: z.string().date().optional(),
      ...commonContractFields,
      ...ipoeFields,
      ...initialStatusField,
    }),
  ])
  .superRefine((data, ctx) => {
    // IPoE precisa de identificador (circuit/MAC) só quando vai entrar ACTIVE
    // direto. Em PENDING_INSTALL o técnico ainda vai vincular a ONT em campo.
    if (
      data.authMethod === 'IPOE' &&
      data.initialStatus === 'ACTIVE' &&
      !data.circuitId &&
      !data.macAddress
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Em IPoE ativo, informe pelo menos circuitId ou macAddress. ' +
          'Pra cadastrar sem identificador, use status "PENDING_INSTALL" e ' +
          'vincule depois via /provisioning/install.',
        path: ['circuitId'],
      });
    }
  });
export type CreateContractRequest = z.infer<typeof CreateContractRequestSchema>;

// Update: tudo opcional. Não usa discriminated union porque PATCH parcial
// pode não ter authMethod. O service valida coerência se authMethod vier.
export const UpdateContractRequestSchema = z
  .object({
    authMethod: ContractAuthMethodSchema.optional(),
    pppoeUsername: pppoeFields.pppoeUsername.optional(),
    pppoePassword: pppoeFields.pppoePassword.optional(),
    circuitId: ipoeFields.circuitId,
    remoteId: ipoeFields.remoteId,
    macAddress: ipoeFields.macAddress,
    framedIpAddress: ipoeFields.framedIpAddress,
    vlanId: ipoeFields.vlanId,
    ...commonContractFields,
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

  authMethod: ContractAuthMethod;

  // PPPoE — preenchidos só quando authMethod === 'PPPOE'.
  pppoeUsername: string | null;
  // Senha NUNCA retorna em listagens; só aparece em GET /:id para usuários com permissão.
  pppoePassword?: string | null;

  // IPoE — preenchidos só quando authMethod === 'IPOE'.
  circuitId: string | null;
  remoteId: string | null;
  macAddress: string | null;
  framedIpAddress: string | null;
  vlanId: number | null;

  installationAddress: string;
  installationMapsUrl: string | null;
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
