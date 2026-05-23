/**
 * DTOs de configuração SIFEN por tenant.
 *
 * Persistido em TenantSetting (key='sifen.config'). Secrets sensíveis
 * (senha do .p12 e valor do CSC) ficam cifrados com CryptoService — o
 * Response NUNCA expõe valor cru, só `hasPassword: true/false` etc.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 */
import { z } from 'zod';

import { SifenEnvironmentSchema } from './document.dto';

// -----------------------------------------------------------------------------
// Sub-schemas: emisor + csc
// -----------------------------------------------------------------------------
export const SifenEmisorSchema = z.object({
  /** RUC do emisor sem DV (ex: "80012345"). DV é calculado em runtime. */
  ruc: z.string().min(3).max(20),
  /** Número do timbrado da SET (8 dígitos). */
  timbrado: z.string().regex(/^\d{8}$/u, 'Timbrado deve ter 8 dígitos'),
  /** Data de início do timbrado (YYYY-MM-DD). */
  timbradoFecha: z.string().date(),
  razonSocial: z.string().min(1).max(255),
  nombreFantasia: z.string().max(255).optional(),
  /** 1 = persona física, 2 = persona jurídica. */
  tipoContribuyente: z.union([z.literal(1), z.literal(2)]),
  /** Régime tributário SET (8=Pequeño, 4=IRACIS, etc). */
  tipoRegimen: z.coerce.number().int().min(1).max(8),
  actividadCodigo: z.string().min(1).max(10),
  actividadDescripcion: z.string().min(1).max(300),

  // Establecimiento + ponto
  establecimiento: z.string().regex(/^\d{3}$/u),
  puntoExpedicion: z.string().regex(/^\d{3}$/u),
  direccion: z.string().min(1).max(255),
  /** Códigos numéricos SET (Anexo C/D/E Manual v150). Default Asunción. */
  departamento: z.coerce.number().int().min(1).max(99),
  departamentoDesc: z.string().min(1).max(60),
  distrito: z.coerce.number().int().min(1).max(999),
  distritoDesc: z.string().min(1).max(60),
  ciudad: z.coerce.number().int().min(1).max(99999),
  ciudadDesc: z.string().min(1).max(60),
  telefono: z.string().max(30).optional(),
  email: z.string().email().max(255).optional(),
});
export type SifenEmisor = z.infer<typeof SifenEmisorSchema>;

export const SifenCscInputSchema = z.object({
  /** Identificador do CSC (1..9). String pra evitar leading-zero issues. */
  id: z.string().regex(/^\d{1,2}$/u),
  /**
   * Valor cru do CSC (32+ hex chars). Só presente em PUT/POST. O response
   * NUNCA retorna esse valor — só `hasValue: boolean`.
   */
  value: z.string().min(8).max(128).optional(),
});
export type SifenCscInput = z.infer<typeof SifenCscInputSchema>;

// -----------------------------------------------------------------------------
// Config (input do PUT /v1/sifen/config)
// -----------------------------------------------------------------------------
export const SifenConfigSchema = z.object({
  enabled: z.coerce.boolean().default(false),
  environment: SifenEnvironmentSchema.default('test'),
  emisor: SifenEmisorSchema,
  csc: SifenCscInputSchema,
});
export type SifenConfig = z.infer<typeof SifenConfigSchema>;

// PUT aceita TUDO opcional pra permitir saves parciais (preenche por seções).
export const UpdateSifenConfigRequestSchema = z
  .object({
    enabled: z.coerce.boolean(),
    environment: SifenEnvironmentSchema,
    emisor: SifenEmisorSchema.partial(),
    csc: SifenCscInputSchema.partial(),
  })
  .partial();
export type UpdateSifenConfigRequest = z.infer<typeof UpdateSifenConfigRequestSchema>;

// -----------------------------------------------------------------------------
// Certificate info (response GET /v1/sifen/config/certificate)
// -----------------------------------------------------------------------------
export const SifenCertificateInfoResponseSchema = z.object({
  exists: z.boolean(),
  /** Common Name extraído do cert (ex: "EMPRESA SA"). */
  commonName: z.string().nullable(),
  validFrom: z.string().datetime().nullable(),
  validTo: z.string().datetime().nullable(),
  /** SHA-256 fingerprint do cert (hex, 64 chars). Útil pra debug. */
  fingerprint: z.string().nullable(),
  /** Dias até expirar. Negativo = expirado. null se exists=false. */
  daysUntilExpiry: z.number().int().nullable(),
  /** Indica se senha do .p12 está salva no TenantSetting (cifrada). */
  hasPassword: z.boolean(),
});
export type SifenCertificateInfoResponse = z.infer<
  typeof SifenCertificateInfoResponseSchema
>;

// -----------------------------------------------------------------------------
// Upload certificate (multipart body field)
// -----------------------------------------------------------------------------
export const UploadCertificateRequestSchema = z.object({
  /** Senha do .p12 — cifrada com CryptoService antes de persistir. */
  password: z.string().min(1).max(128),
});
export type UploadCertificateRequest = z.infer<
  typeof UploadCertificateRequestSchema
>;

// -----------------------------------------------------------------------------
// Response (GET /v1/sifen/config) — sem secrets crus
// -----------------------------------------------------------------------------
export interface SifenConfigResponse {
  enabled: boolean;
  environment: 'test' | 'prod';
  emisor: SifenEmisor | null;
  csc: {
    id: string | null;
    hasValue: boolean;
  };
  certificate: SifenCertificateInfoResponse | null;
  /** Origem efetiva da config: 'tenantSetting' = lê do DB, 'env' = fallback env. */
  source: 'tenantSetting' | 'env' | 'mixed' | 'unconfigured';
  updatedAt: string | null;
}
