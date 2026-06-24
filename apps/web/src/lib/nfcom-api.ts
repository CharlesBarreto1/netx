/**
 * Cliente tipado pro módulo NFCom (fatura de serviço de comunicação BR, mod 62).
 * Backend: apps/core-service/src/modules/nfcom/*.
 *
 * Tipos mantidos locais (não importa @netx/shared no web), espelhando o backend.
 */
import { api, apiUpload } from './api';
import type { Paginated } from './crm-types';

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------
export type NfcomDocumentType = 'NFCOM' | 'NFCOM_SUBSTITUICAO';

export type NfcomDocumentStatus =
  | 'DRAFT'
  | 'SIGNED'
  | 'SENT'
  | 'AUTHORIZED'
  | 'REJECTED'
  | 'DENIED'
  | 'CANCELLED';

export type NfcomEnvironment = 'HOMOLOGACAO' | 'PRODUCAO';
export type NfcomTransmitter = 'NUVEM_FISCAL' | 'FOCUS_NFE' | 'SVRS_DIRECT';

export interface NfcomDocument {
  id: string;
  tenantId: string;
  contractInvoiceId: string | null;
  oneTimeChargeId: string | null;
  type: NfcomDocumentType;
  status: NfcomDocumentStatus;
  serie: string;
  numero: number;
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

export interface NfcomEmitente {
  cnpj: string;
  inscricaoEstadual?: string;
  razaoSocial: string;
  nomeFantasia?: string;
  crt?: '1' | '2' | '3';
  uf: string;
  codMunicipio?: string;
  endLogradouro?: string;
  endNumero?: string;
  endComplemento?: string;
  endBairro?: string;
  endMunicipioNome?: string;
  endCep?: string;
  fone?: string;
  email?: string;
  serie: string;
}

export interface NfcomTaxDefaults {
  cstIcms?: string;
  aliquotaIcms?: number;
  cfop?: string;
  cClass?: string;
  tpServ?: string;
}

export interface NfcomCertificateInfo {
  exists: boolean;
  commonName: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint: string | null;
  daysUntilExpiry: number | null;
  hasPassword: boolean;
}

export interface NfcomConfigResponse {
  enabled: boolean;
  environment: NfcomEnvironment;
  transmitter: NfcomTransmitter;
  emitente: NfcomEmitente | null;
  taxDefaults: NfcomTaxDefaults;
  credentials: { hasValue: boolean };
  certificate: NfcomCertificateInfo | null;
  autoGenerate: boolean;
  nextNumero: number;
  updatedAt: string | null;
}

export interface NfcomDiagnoseResult {
  ok: boolean;
  environment: string;
  transmitter: string;
  hasCertificate: boolean;
  cStat?: string;
  motivo?: string;
  tMed?: string;
  error?: string;
}

/** Input do PUT /v1/nfcom/config — tudo opcional (PATCH semântico). */
export interface UpdateNfcomConfigInput {
  enabled?: boolean;
  environment?: NfcomEnvironment;
  transmitter?: NfcomTransmitter;
  emitente?: Partial<NfcomEmitente>;
  taxDefaults?: Partial<NfcomTaxDefaults>;
  credentials?: { apiKey?: string };
  autoGenerate?: boolean;
}

// -----------------------------------------------------------------------------
// Query helper
// -----------------------------------------------------------------------------
function qs<T extends object>(params: T | Record<string, never> = {}): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export interface ListNfcomParams {
  page?: number;
  pageSize?: number;
  type?: NfcomDocumentType;
  status?: NfcomDocumentStatus;
  contractInvoiceId?: string;
  oneTimeChargeId?: string;
  chaveAcesso?: string;
  serie?: string;
  issuedFrom?: string;
  issuedTo?: string;
  sortBy?: 'issuedAt' | 'createdAt' | 'numero';
  sortDir?: 'asc' | 'desc';
}

export interface EmitNfcomInput {
  type?: NfcomDocumentType;
  contractInvoiceId?: string;
  oneTimeChargeId?: string;
  note?: string;
}

export const nfcomApi = {
  // ---- Documentos ----
  listPath: (params: ListNfcomParams = {}) => `/v1/nfcom/documents${qs(params)}`,
  list(params: ListNfcomParams = {}) {
    return api.get<Paginated<NfcomDocument>>(this.listPath(params));
  },
  get(id: string) {
    return api.get<NfcomDocument>(`/v1/nfcom/documents/${id}`);
  },
  emit(input: EmitNfcomInput) {
    return api.post<NfcomDocument>('/v1/nfcom/documents', input);
  },
  cancel(id: string, reason: string) {
    return api.post<NfcomDocument>(`/v1/nfcom/documents/${id}/cancel`, { reason });
  },
  substitute(id: string, reason: string) {
    return api.post<NfcomDocument>(`/v1/nfcom/documents/${id}/substitute`, { reason });
  },

  // ---- Config ----
  getConfig() {
    return api.get<NfcomConfigResponse>('/v1/nfcom/config');
  },
  saveConfig(input: UpdateNfcomConfigInput) {
    return api.put<NfcomConfigResponse>('/v1/nfcom/config', input);
  },
  diagnose() {
    return api.post<NfcomDiagnoseResult>('/v1/nfcom/config/diagnose', {});
  },
  uploadCertificate(file: File, password: string) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('password', password);
    return apiUpload<NfcomCertificateInfo>('/v1/nfcom/config/certificate', fd);
  },
  deleteCertificate() {
    return api.delete<{ removed: boolean }>('/v1/nfcom/config/certificate');
  },
};
