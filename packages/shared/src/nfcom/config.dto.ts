/**
 * DTOs de configuração NFCom por tenant.
 *
 * Persistido na tabela NfcomConfig. Secrets (credenciais do agregador e senha
 * do certificado .pfx) ficam cifrados com CryptoService — o Response NUNCA
 * expõe valor cru, só `hasValue` / `hasPassword`.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 */
import { z } from 'zod';

import {
  NfcomEnvironmentSchema,
  NfcomTransmitterSchema,
} from './document.dto';

// -----------------------------------------------------------------------------
// Sub-schemas: emitente + defaults tributários + credenciais
// -----------------------------------------------------------------------------
export const NfcomEmitenteSchema = z.object({
  /** CNPJ do emitente, só dígitos (14). */
  cnpj: z.string().regex(/^\d{14}$/u, 'CNPJ deve ter 14 dígitos'),
  /** Inscrição Estadual (obrigatória pro ICMS; varia por UF). */
  inscricaoEstadual: z.string().max(20).optional(),
  razaoSocial: z.string().min(1).max(255),
  nomeFantasia: z.string().max(255).optional(),
  /** Código de Regime Tributário: 1=Simples, 2=Simples excesso, 3=Normal. */
  crt: z.enum(['1', '2', '3']).optional(),
  /** UF do emitente (sigla de 2 letras). */
  uf: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/u, 'UF deve ser a sigla de 2 letras (ex: SP)'),
  /** Código IBGE do município (7 dígitos) — cMun do enderEmit. */
  codMunicipio: z.string().regex(/^\d{7}$/u).optional(),
  // Endereço do emitente (enderEmit do XSD).
  endLogradouro: z.string().max(60).optional(),
  endNumero: z.string().max(60).optional(),
  endComplemento: z.string().max(60).optional(),
  endBairro: z.string().max(60).optional(),
  endMunicipioNome: z.string().max(60).optional(),
  endCep: z.string().regex(/^\d{8}$/u).optional(),
  fone: z.string().regex(/^\d{7,12}$/u).optional(),
  email: z.string().email().max(255).optional(),
  /** Série da NFCom (1..3 dígitos). */
  serie: z.string().regex(/^\d{1,3}$/u).default('1'),
});
export type NfcomEmitente = z.infer<typeof NfcomEmitenteSchema>;

export const NfcomTaxDefaultsSchema = z.object({
  /** CST do ICMS (ex: "00", "90"). */
  cstIcms: z.string().max(3).optional(),
  /** Alíquota ICMS em % (ex: 25.00). */
  aliquotaIcms: z.coerce.number().min(0).max(100).optional(),
  /** CFOP padrão (4 dígitos). */
  cfop: z.string().regex(/^\d{4}$/u).optional(),
  /** Código de classificação do item (cClass — tabela MOC). */
  cClass: z.string().max(7).optional(),
  /** Tipo de serviço (tpServ — tabela MOC). */
  tpServ: z.string().max(2).optional(),
});
export type NfcomTaxDefaults = z.infer<typeof NfcomTaxDefaultsSchema>;

export const NfcomCredentialsInputSchema = z.object({
  /**
   * Chave/token de API do agregador escolhido. Só presente em PUT/POST; o
   * response NUNCA retorna o valor — só `hasValue: boolean`.
   */
  apiKey: z.string().min(8).max(512).optional(),
});
export type NfcomCredentialsInput = z.infer<typeof NfcomCredentialsInputSchema>;

// -----------------------------------------------------------------------------
// Config (input do PUT /v1/nfcom/config) — saves parciais permitidos
// -----------------------------------------------------------------------------
export const NfcomConfigSchema = z.object({
  enabled: z.coerce.boolean().default(false),
  environment: NfcomEnvironmentSchema.default('HOMOLOGACAO'),
  transmitter: NfcomTransmitterSchema.default('NUVEM_FISCAL'),
  emitente: NfcomEmitenteSchema,
  taxDefaults: NfcomTaxDefaultsSchema,
  credentials: NfcomCredentialsInputSchema,
  /** Emitir NFCom automaticamente a partir da fatura (cron de autogen). */
  autoGenerate: z.coerce.boolean().default(false),
});
export type NfcomConfig = z.infer<typeof NfcomConfigSchema>;

export const UpdateNfcomConfigRequestSchema = z
  .object({
    enabled: z.coerce.boolean(),
    environment: NfcomEnvironmentSchema,
    transmitter: NfcomTransmitterSchema,
    emitente: NfcomEmitenteSchema.partial(),
    taxDefaults: NfcomTaxDefaultsSchema.partial(),
    credentials: NfcomCredentialsInputSchema.partial(),
    autoGenerate: z.coerce.boolean(),
  })
  .partial();
export type UpdateNfcomConfigRequest = z.infer<
  typeof UpdateNfcomConfigRequestSchema
>;

// -----------------------------------------------------------------------------
// Certificate info (response GET /v1/nfcom/config)
// -----------------------------------------------------------------------------
export const NfcomCertificateInfoResponseSchema = z.object({
  exists: z.boolean(),
  /** Common Name do certificado (ex: "EMPRESA LTDA:12345678000190"). */
  commonName: z.string().nullable(),
  validFrom: z.string().datetime().nullable(),
  validTo: z.string().datetime().nullable(),
  /** SHA-256 fingerprint (hex). Útil pra debug. */
  fingerprint: z.string().nullable(),
  /** Dias até expirar. Negativo = expirado. null se exists=false. */
  daysUntilExpiry: z.number().int().nullable(),
  /** Indica se a senha do .pfx está salva (cifrada). */
  hasPassword: z.boolean(),
});
export type NfcomCertificateInfoResponse = z.infer<
  typeof NfcomCertificateInfoResponseSchema
>;

// -----------------------------------------------------------------------------
// Upload certificate (multipart body field)
// -----------------------------------------------------------------------------
export const UploadNfcomCertificateRequestSchema = z.object({
  /** Senha do .pfx — cifrada com CryptoService antes de persistir. */
  password: z.string().min(1).max(128),
});
export type UploadNfcomCertificateRequest = z.infer<
  typeof UploadNfcomCertificateRequestSchema
>;

// -----------------------------------------------------------------------------
// Response (GET /v1/nfcom/config) — sem secrets crus
// -----------------------------------------------------------------------------
export interface NfcomConfigResponse {
  enabled: boolean;
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
  transmitter: 'NUVEM_FISCAL' | 'FOCUS_NFE' | 'SVRS_DIRECT';
  emitente: NfcomEmitente | null;
  taxDefaults: NfcomTaxDefaults;
  credentials: {
    hasValue: boolean;
  };
  certificate: NfcomCertificateInfoResponse | null;
  autoGenerate: boolean;
  /** Próximo número sequencial que será usado na emissão. */
  nextNumero: number;
  updatedAt: string | null;
}
