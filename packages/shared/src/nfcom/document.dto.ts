/**
 * @netx/shared/nfcom — DTOs do módulo NFCom (fatura de serviço de comunicação BR).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * NFCom = Nota Fiscal Fatura de Serviço de Comunicação Eletrônica (modelo 62),
 * autorizada pelo SVRS. Conforme MOC-NFCom / NT 2026.002 RTC.
 *
 * Esses DTOs são o contrato HTTP/API. O XML real é gerado/assinado/transmitido
 * no backend, atrás de uma porta plugável (1o transmissor = agregador REST) —
 * o frontend NUNCA monta XML.
 */
import { z } from 'zod';

// =============================================================================
// Enums (espelham Prisma)
// =============================================================================
export const NfcomDocumentTypeSchema = z.enum(['NFCOM', 'NFCOM_SUBSTITUICAO']);
export type NfcomDocumentType = z.infer<typeof NfcomDocumentTypeSchema>;

export const NfcomDocumentStatusSchema = z.enum([
  'DRAFT',
  'SIGNED',
  'SENT',
  'AUTHORIZED',
  'REJECTED',
  'DENIED',
  'CANCELLED',
]);
export type NfcomDocumentStatus = z.infer<typeof NfcomDocumentStatusSchema>;

export const NfcomEnvironmentSchema = z.enum(['HOMOLOGACAO', 'PRODUCAO']);
export type NfcomEnvironment = z.infer<typeof NfcomEnvironmentSchema>;

export const NfcomTransmitterSchema = z.enum([
  'NUVEM_FISCAL',
  'FOCUS_NFE',
  'SVRS_DIRECT',
]);
export type NfcomTransmitter = z.infer<typeof NfcomTransmitterSchema>;

// =============================================================================
// Emissão (POST /v1/nfcom/documents)
// =============================================================================
/**
 * Dispara emissão a partir de uma fatura mensal ou cobrança avulsa. Pelo menos
 * um dos vínculos é obrigatório. O fluxo automático (cron de autogen) chama o
 * mesmo service, então o payload aqui é o mesmo do emissor automático.
 */
export const EmitNfcomDocumentRequestSchema = z
  .object({
    type: NfcomDocumentTypeSchema.default('NFCOM'),
    contractInvoiceId: z.string().uuid().optional(),
    oneTimeChargeId: z.string().uuid().optional(),
    /** Observação opcional pra log; não vai no XML. */
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.contractInvoiceId || v.oneTimeChargeId, {
    message: 'Informe contractInvoiceId ou oneTimeChargeId',
  });
export type EmitNfcomDocumentRequest = z.infer<
  typeof EmitNfcomDocumentRequestSchema
>;

// =============================================================================
// Cancelamento (POST /v1/nfcom/documents/:id/cancel)
// =============================================================================
/**
 * Cancelamento via evento, dentro do prazo legal após a autorização. A
 * justificativa é obrigatória (mínimo 15 chars, exigência do leiaute) e vai pro
 * XML do evento.
 */
export const CancelNfcomDocumentRequestSchema = z.object({
  reason: z.string().min(15).max(255),
});
export type CancelNfcomDocumentRequest = z.infer<
  typeof CancelNfcomDocumentRequestSchema
>;

// =============================================================================
// Substituição (POST /v1/nfcom/documents/:id/substitute)
// =============================================================================
/**
 * Emite uma nova NFCom que SUBSTITUI a original (grupo gSub). A original é
 * referenciada pelo path param :id; o motivo é obrigatório.
 */
export const SubstituteNfcomDocumentRequestSchema = z.object({
  reason: z.string().min(15).max(255),
});
export type SubstituteNfcomDocumentRequest = z.infer<
  typeof SubstituteNfcomDocumentRequestSchema
>;

// =============================================================================
// Listagem (GET /v1/nfcom/documents)
// =============================================================================
export const ListNfcomDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  type: NfcomDocumentTypeSchema.optional(),
  status: NfcomDocumentStatusSchema.optional(),
  contractInvoiceId: z.string().uuid().optional(),
  oneTimeChargeId: z.string().uuid().optional(),

  /** Filtro por chave de acesso (exata, 44 dígitos). */
  chaveAcesso: z.string().length(44).optional(),
  serie: z.string().max(3).optional(),

  issuedFrom: z.string().date().optional(),
  issuedTo: z.string().date().optional(),

  sortBy: z.enum(['issuedAt', 'createdAt', 'numero']).default('issuedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListNfcomDocumentsQuery = z.infer<
  typeof ListNfcomDocumentsQuerySchema
>;

// =============================================================================
// Response
// =============================================================================
export interface NfcomDocumentResponse {
  id: string;
  tenantId: string;
  contractInvoiceId: string | null;
  oneTimeChargeId: string | null;

  type: NfcomDocumentType;
  status: NfcomDocumentStatus;

  serie: string;
  numero: number;
  /** Formatado pra exibição: "1-000000001". */
  numeroDocumento: string;

  chaveAcesso: string | null;
  protocolo: string | null;

  emitenteCnpj: string;
  receptorTaxId: string | null;
  receptorName: string | null;

  totalAmount: number;
  currency: string;

  cstIcms: string | null;
  aliquotaIcms: number | null;
  baseCalculoIcms: number | null;
  valorIcms: number | null;

  danfeUrl: string | null;
  qrCodeData: string | null;
  rejectionCode: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  substitutesId: string | null;

  issuedAt: string;
  signedAt: string | null;
  sentAt: string | null;
  authorizedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;

  retryCount: number;
  lastError: string | null;
  nextRetryAt: string | null;

  createdAt: string;
  updatedAt: string;
}

// Config do tenant em ./config.dto.ts.
