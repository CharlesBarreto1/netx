import { z } from 'zod';

// =============================================================================
// EFI / EfiPay — pagamentos BR (Pix imediato + boleto híbrido com Pix "Bolix").
// Integração SOMENTE BR. Credenciais por tenant (cifradas no backend).
// =============================================================================

export const EfiEnvironmentSchema = z.enum(['PRODUCTION', 'SANDBOX']);
export type EfiEnvironment = z.infer<typeof EfiEnvironmentSchema>;

export const EfiChargeKindSchema = z.enum(['PIX', 'BOLIX']);
export type EfiChargeKind = z.infer<typeof EfiChargeKindSchema>;

export const EfiChargeStatusSchema = z.enum([
  'PENDING',
  'ACTIVE',
  'PAID',
  'CANCELED',
  'ERROR',
]);
export type EfiChargeStatus = z.infer<typeof EfiChargeStatusSchema>;

// -----------------------------------------------------------------------------
// CONFIG (por tenant) — escrita
// -----------------------------------------------------------------------------
// Segredos (clientId/clientSecret/certificate) são WRITE-ONLY: enviados aqui,
// nunca retornados. Campos de segredo ausentes/'' = mantém o valor atual.
export const UpsertEfiConfigRequestSchema = z
  .object({
    environment: EfiEnvironmentSchema.optional(),
    enabled: z.boolean().optional(),

    // Credenciais EFI (API → "Criar aplicação"). Mesmas p/ Pix e Cobranças.
    clientId: z.string().min(1).max(255).optional(),
    clientSecret: z.string().min(1).max(255).optional(),

    // Certificado .p12 em base64 (exigido pela API Pix / mTLS).
    certificateBase64: z.string().min(1).optional(),
    // Senha do .p12 (geralmente vazia no EFI).
    certificatePassword: z.string().max(255).optional(),

    // Config não-secreta
    pixKey: z.string().max(140).nullish(),
    defaultChargeKind: EfiChargeKindSchema.optional(),
    expirationDays: z.coerce.number().int().min(1).max(60).optional(),
    autoGenerate: z.boolean().optional(),
    finePercent: z.coerce.number().min(0).max(100).nullish(),
    interestPercent: z.coerce.number().min(0).max(100).nullish(),
  })
  .strict();
export type UpsertEfiConfigRequest = z.infer<typeof UpsertEfiConfigRequestSchema>;

// -----------------------------------------------------------------------------
// CONFIG — resposta (sem segredos)
// -----------------------------------------------------------------------------
export interface EfiConfigResponse {
  tenantId: string;
  environment: EfiEnvironment;
  enabled: boolean;

  // Presença dos segredos (nunca o valor em si).
  hasCredentials: boolean;
  hasCertificate: boolean;

  pixKey: string | null;
  defaultChargeKind: EfiChargeKind;
  expirationDays: number;
  autoGenerate: boolean;
  finePercent: number | null;
  interestPercent: number | null;
  pixWebhookRegistered: boolean;

  // URLs públicas que o tenant cadastra no painel EFI (já com o token embutido).
  pixWebhookUrl: string | null;
  boletoNotificationUrl: string | null;

  createdAt: string | null;
  updatedAt: string | null;
}

// -----------------------------------------------------------------------------
// CHARGE — gerar cobrança para uma fatura
// -----------------------------------------------------------------------------
export const GenerateEfiChargeRequestSchema = z
  .object({
    // Default = EfiConfig.defaultChargeKind.
    kind: EfiChargeKindSchema.optional(),
    // Reemitir mesmo que já exista cobrança ACTIVE (cancela a anterior).
    force: z.boolean().optional(),
  })
  .strict();
export type GenerateEfiChargeRequest = z.infer<
  typeof GenerateEfiChargeRequestSchema
>;

export const ListEfiChargesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  invoiceId: z.string().uuid().optional(),
  status: EfiChargeStatusSchema.optional(),
  kind: EfiChargeKindSchema.optional(),
  sortBy: z.enum(['createdAt', 'expiresAt', 'amount']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListEfiChargesQuery = z.infer<typeof ListEfiChargesQuerySchema>;

// -----------------------------------------------------------------------------
// CHARGE — resposta
// -----------------------------------------------------------------------------
export interface EfiChargeResponse {
  id: string;
  tenantId: string;
  invoiceId: string;

  kind: EfiChargeKind;
  status: EfiChargeStatus;
  amount: number;

  txid: string | null;
  efiChargeId: string | null;

  // Artefatos entregáveis ao cliente
  pixCopiaECola: string | null; // BR Code (copia-e-cola)
  pixQrImage: string | null; // dataURL (image/png base64)
  barcode: string | null; // linha digitável do boleto
  pdfUrl: string | null;
  paymentLink: string | null;

  expiresAt: string | null;
  paidAt: string | null;
  paidAmount: number | null;
  lastError: string | null;

  createdAt: string;
  updatedAt: string;
}
