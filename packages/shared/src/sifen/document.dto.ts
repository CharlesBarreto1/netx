/**
 * @netx/shared/sifen — DTOs do módulo SIFEN (fatura eletrônica Paraguay).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Conforme Manual Técnico SIFEN v150 da DNIT:
 * https://www.dnit.gov.py/documents/20123/420592/Manual+Técnico+Versión+150.pdf
 *
 * Esses DTOs são o contrato HTTP/API. O XML real é gerado no backend via
 * libs TIPS-SA (facturacionelectronicapy-xmlgen/xmlsign/qrgen/setapi) —
 * o frontend NUNCA monta XML.
 */
import { z } from 'zod';

// =============================================================================
// Enums (espelham Prisma)
// =============================================================================
export const SifenDocumentTypeSchema = z.enum([
  'FACTURA',
  'NOTA_CREDITO',
  'NOTA_DEBITO',
  'AUTOFACTURA',
  'NOTA_REMISION',
]);
export type SifenDocumentType = z.infer<typeof SifenDocumentTypeSchema>;

export const SifenDocumentStatusSchema = z.enum([
  'DRAFT',
  'SIGNED',
  'SENT',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);
export type SifenDocumentStatus = z.infer<typeof SifenDocumentStatusSchema>;

export const SifenEnvironmentSchema = z.enum(['test', 'prod']);
export type SifenEnvironment = z.infer<typeof SifenEnvironmentSchema>;

// =============================================================================
// Emissão manual (POST /v1/sifen/documents)
// =============================================================================
/**
 * Disparar emissão manual a partir de uma fatura mensal ou cobrança avulsa.
 * Pelo menos um dos vínculos é obrigatório.
 *
 * O fluxo automático (hook em ContractInvoicesService.create) chama esse
 * mesmo service, então o payload aqui é o mesmo do emissor automático.
 */
export const EmitSifenDocumentRequestSchema = z
  .object({
    type: SifenDocumentTypeSchema.default('FACTURA'),
    contractInvoiceId: z.string().uuid().optional(),
    oneTimeChargeId: z.string().uuid().optional(),
    /** Observação opcional pra log; não vai no XML. */
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.contractInvoiceId || v.oneTimeChargeId, {
    message: 'Informe contractInvoiceId ou oneTimeChargeId',
  });
export type EmitSifenDocumentRequest = z.infer<typeof EmitSifenDocumentRequestSchema>;

// =============================================================================
// Cancelamento (POST /v1/sifen/documents/:id/cancel)
// =============================================================================
/**
 * Cancelación de DTE via evento. Janela: até 48h após approvedAt. Após isso,
 * só Nota de Crédito resolve. O motivo é obrigatório e vai pro XML do evento.
 */
export const CancelSifenDocumentRequestSchema = z.object({
  reason: z.string().min(10).max(500),
});
export type CancelSifenDocumentRequest = z.infer<typeof CancelSifenDocumentRequestSchema>;

// =============================================================================
// Listagem (GET /v1/sifen/documents)
// =============================================================================
export const ListSifenDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  type: SifenDocumentTypeSchema.optional(),
  status: SifenDocumentStatusSchema.optional(),
  contractInvoiceId: z.string().uuid().optional(),
  oneTimeChargeId: z.string().uuid().optional(),

  /** Filtro por CDC (busca exata, 44 chars). */
  cdc: z.string().length(44).optional(),
  /** Filtro por número fiscal ex: "001-001-0000001". */
  numero: z.string().optional(),

  issuedFrom: z.string().date().optional(),
  issuedTo: z.string().date().optional(),

  sortBy: z.enum(['issuedAt', 'createdAt', 'numero']).default('issuedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListSifenDocumentsQuery = z.infer<typeof ListSifenDocumentsQuerySchema>;

// =============================================================================
// Response
// =============================================================================
export interface SifenDocumentResponse {
  id: string;
  tenantId: string;
  contractInvoiceId: string | null;
  oneTimeChargeId: string | null;

  type: SifenDocumentType;
  status: SifenDocumentStatus;

  establecimiento: string;
  puntoExpedicion: string;
  numero: number;
  /** Formatado pra exibição: "001-001-0000001". */
  numeroDocumento: string;

  cdc: string;

  emisorRuc: string;
  emisorTimbrado: string;
  receptorTaxId: string | null;
  receptorName: string | null;

  totalAmount: number;
  currency: string;

  qrUrl: string | null;
  rejectionCode: string | null;
  rejectionReason: string | null;

  issuedAt: string;
  signedAt: string | null;
  sentAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;

  retryCount: number;
  lastError: string | null;
  nextRetryAt: string | null;

  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Config do tenant — endpoint de leitura/escrita pelo admin
// (POST /v1/sifen/config)
// =============================================================================
/**
 * Config armazenada em TenantSetting (chave "sifen.config"). Não inclui o
 * arquivo .p12 nem a senha — esses ficam em /etc/netx/.secrets via env vars
 * SIFEN_CERT_PATH / SIFEN_CERT_PASSWORD. Aqui só o que o admin vê na UI.
 */
export const SifenConfigSchema = z.object({
  enabled: z.boolean().default(false),
  environment: SifenEnvironmentSchema.default('test'),
  emisorRuc: z.string().min(5).max(20),
  emisorTimbrado: z.string().length(8),
  establecimiento: z.string().length(3).default('001'),
  puntoExpedicion: z.string().length(3).default('001'),
  /** Razão social do emisor — pode diferir do tenant.legalName. */
  emisorRazonSocial: z.string().min(1).max(255),
  /** Email pro envelope SOAP (notificação SIFEN, opcional). */
  emisorEmail: z.string().email().optional(),
  /** Atividade econômica principal (código SET, ex: '6202'). */
  actividadEconomica: z.string().max(20).optional(),
});
export type SifenConfig = z.infer<typeof SifenConfigSchema>;
