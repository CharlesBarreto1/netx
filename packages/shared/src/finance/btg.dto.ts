import { z } from 'zod';

// =============================================================================
// BTG Pactual — pagamentos BR (boleto + Pix cobrança + Pix Automático).
// Integração SOMENTE BR. Credenciais por tenant (cifradas no backend).
//
// Diferença vs EFI: auth é OAuth2 via BTG Id e o fluxo Authorization Code é
// OBRIGATÓRIO p/ operar a conta PJ (emitir boleto/pix). Por isso há um passo
// de CONSENTIMENTO (redirect → callback) cujo refresh_token guardamos cifrado.
// =============================================================================

export const BtgEnvironmentSchema = z.enum(['PRODUCTION', 'SANDBOX']);
export type BtgEnvironment = z.infer<typeof BtgEnvironmentSchema>;

// Gateway de cobrança BR. Escolhido POR CONTRATO (trava em 1) e também usado
// como padrão pré-preenchido do tenant. MANUAL = sem gateway (carnê/baixa
// manual); EFI/BTG fazem a fatura nascer no gateway. Extensível.
export const BrPaymentGatewaySchema = z.enum(['MANUAL', 'EFI', 'BTG']);
export type BrPaymentGateway = z.infer<typeof BrPaymentGatewaySchema>;

export const SetBrGatewayRequestSchema = z
  .object({ gateway: BrPaymentGatewaySchema })
  .strict();
export type SetBrGatewayRequest = z.infer<typeof SetBrGatewayRequestSchema>;

export interface BrGatewayResponse {
  gateway: BrPaymentGateway;
}

export const BtgChargeKindSchema = z.enum(['BOLETO', 'PIX']);
export type BtgChargeKind = z.infer<typeof BtgChargeKindSchema>;

export const BtgChargeStatusSchema = z.enum([
  'PENDING',
  'ACTIVE',
  'PAID',
  'CANCELED',
  'ERROR',
]);
export type BtgChargeStatus = z.infer<typeof BtgChargeStatusSchema>;

// -----------------------------------------------------------------------------
// CONFIG (por tenant) — escrita
// -----------------------------------------------------------------------------
// Segredos (clientId/clientSecret) são WRITE-ONLY: enviados aqui, nunca
// retornados. Campos de segredo ausentes/'' = mantém o valor atual.
export const UpsertBtgConfigRequestSchema = z
  .object({
    environment: BtgEnvironmentSchema.optional(),
    enabled: z.boolean().optional(),

    // Credenciais do app registrado no Developer Console do BTG.
    clientId: z.string().min(1).max(255).optional(),
    clientSecret: z.string().min(1).max(255).optional(),

    // Callback registrado no console BTG (precisa bater com o /authorize).
    redirectUri: z.string().url().max(500).nullish(),
    // Escopos OAuth solicitados (space-separated). Default no backend.
    scopes: z.string().max(500).nullish(),

    // Conta PJ no BTG: companyId (CNPJ) compõe o path das APIs; número+agência
    // da conta recebedora vão no corpo das cobranças.
    companyId: z.string().max(20).nullish(),
    accountNumber: z.string().max(20).nullish(),
    accountBranch: z.string().max(10).nullish(),

    // Config de cobrança (não-secreta)
    pixKey: z.string().max(140).nullish(),
    defaultChargeKind: BtgChargeKindSchema.optional(),
    expirationDays: z.coerce.number().int().min(1).max(60).optional(),
    autoGenerate: z.boolean().optional(),
    finePercent: z.coerce.number().min(0).max(100).nullish(),
    interestPercent: z.coerce.number().min(0).max(100).nullish(),
  })
  .strict();
export type UpsertBtgConfigRequest = z.infer<typeof UpsertBtgConfigRequestSchema>;

// -----------------------------------------------------------------------------
// CONFIG — resposta (sem segredos)
// -----------------------------------------------------------------------------
export interface BtgConfigResponse {
  tenantId: string;
  environment: BtgEnvironment;
  enabled: boolean;

  // Presença dos segredos (nunca o valor em si).
  hasCredentials: boolean;
  // Consentimento concedido (temos refresh_token p/ operar a conta PJ).
  authorized: boolean;
  authorizedAt: string | null;

  redirectUri: string | null;
  scopes: string | null;
  companyId: string | null;
  accountNumber: string | null;
  accountBranch: string | null;

  pixKey: string | null;
  defaultChargeKind: BtgChargeKind;
  expirationDays: number;
  autoGenerate: boolean;
  finePercent: number | null;
  interestPercent: number | null;

  // URL pública do webhook (com token embutido) que o tenant cadastra no BTG.
  webhookUrl: string | null;
  // Webhook já registrado no BTG (temos webhookId + secret).
  webhookRegistered: boolean;

  createdAt: string | null;
  updatedAt: string | null;
}

// -----------------------------------------------------------------------------
// OAuth — início do consentimento (Authorization Code)
// -----------------------------------------------------------------------------
export interface BtgAuthorizeUrlResponse {
  /** URL do BTG Id p/ onde o admin é redirecionado p/ consentir. */
  authorizeUrl: string;
}

// -----------------------------------------------------------------------------
// CHARGE — gerar cobrança para uma fatura
// -----------------------------------------------------------------------------
export const GenerateBtgChargeRequestSchema = z
  .object({
    // Default = BtgConfig.defaultChargeKind.
    kind: BtgChargeKindSchema.optional(),
    // Reemitir mesmo que já exista cobrança ACTIVE (cancela a anterior).
    force: z.boolean().optional(),
  })
  .strict();
export type GenerateBtgChargeRequest = z.infer<
  typeof GenerateBtgChargeRequestSchema
>;

export const ListBtgChargesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  invoiceId: z.string().uuid().optional(),
  status: BtgChargeStatusSchema.optional(),
  kind: BtgChargeKindSchema.optional(),
  sortBy: z.enum(['createdAt', 'expiresAt', 'amount']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListBtgChargesQuery = z.infer<typeof ListBtgChargesQuerySchema>;

// -----------------------------------------------------------------------------
// CHARGE — resposta
// -----------------------------------------------------------------------------
export interface BtgChargeResponse {
  id: string;
  tenantId: string;
  invoiceId: string;

  kind: BtgChargeKind;
  status: BtgChargeStatus;
  amount: number;

  txid: string | null;
  btgChargeId: string | null;

  // Artefatos entregáveis ao cliente
  pixEmv: string | null; // BR Code (copia-e-cola)
  pixQrImage: string | null; // dataURL (image/png base64)
  barcode: string | null; // código de barras
  digitableLine: string | null; // linha digitável do boleto
  pdfUrl: string | null;
  paymentLink: string | null;

  expiresAt: string | null;
  paidAt: string | null;
  paidAmount: number | null;
  lastError: string | null;

  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// PIX AUTOMÁTICO — recorrência (assinatura/mensalidade)
// =============================================================================
export const BtgRecurrencePeriodSchema = z.enum([
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUALLY',
]);
export type BtgRecurrencePeriod = z.infer<typeof BtgRecurrencePeriodSchema>;

export const BtgRecurrenceStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'CREATED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELED',
  'FINISHED',
  'ERROR',
]);
export type BtgRecurrenceStatus = z.infer<typeof BtgRecurrenceStatusSchema>;

// Cria (ou reaproveita) a autorização de recorrência de um contrato.
export const CreateBtgRecurrenceRequestSchema = z
  .object({
    period: BtgRecurrencePeriodSchema.optional(), // default MONTHLY
    // Valor fixo da recorrência. Omitido = valor variável (usa o da fatura).
    amount: z.coerce.number().positive().nullish(),
    minimumAmount: z.coerce.number().positive().nullish(),
    // Primeira cobrança (>= hoje+3 dias). Default = backend calcula.
    initialDate: z.string().date().optional(),
    finalDate: z.string().date().nullish(),
    installments: z.coerce.number().int().positive().nullish(),
    // Reemitir mesmo que já exista recorrência viva.
    force: z.boolean().optional(),
  })
  .strict();
export type CreateBtgRecurrenceRequest = z.infer<typeof CreateBtgRecurrenceRequestSchema>;

export const ListBtgRecurrencesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  contractId: z.string().uuid().optional(),
  status: BtgRecurrenceStatusSchema.optional(),
  sortBy: z.enum(['createdAt', 'initialDate']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListBtgRecurrencesQuery = z.infer<typeof ListBtgRecurrencesQuerySchema>;

export interface BtgRecurrenceResponse {
  id: string;
  tenantId: string;
  contractId: string;
  status: BtgRecurrenceStatus;
  contractRef: string;
  authorizationId: string | null;
  period: BtgRecurrencePeriod;
  retryPolicy: string;
  amount: number | null;
  minimumAmount: number | null;
  initialDate: string;
  finalDate: string | null;
  installments: number | null;
  // Artefato p/ o pagador aprovar a recorrência.
  emv: string | null;
  qrImage: string | null;
  approvedAt: string | null;
  canceledAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
