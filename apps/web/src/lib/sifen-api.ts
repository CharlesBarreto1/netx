/**
 * Cliente tipado pro módulo SIFEN (fatura eletrônica PY).
 * Backend: apps/core-service/src/modules/sifen/*.
 */
import { api, apiUpload } from './api';
import type { Paginated } from './crm-types';

// -----------------------------------------------------------------------------
// Tipos (espelho do backend; mantidos aqui pra não importar @netx/shared no web)
// -----------------------------------------------------------------------------
export type SifenDocumentType =
  | 'FACTURA'
  | 'NOTA_CREDITO'
  | 'NOTA_DEBITO'
  | 'AUTOFACTURA'
  | 'NOTA_REMISION';

export type SifenDocumentStatus =
  | 'DRAFT'
  | 'SIGNED'
  | 'SENT'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type SifenEnvironment = 'test' | 'prod';

export interface SifenDocument {
  id: string;
  tenantId: string;
  contractInvoiceId: string | null;
  oneTimeChargeId: string | null;
  type: SifenDocumentType;
  status: SifenDocumentStatus;
  establecimiento: string;
  puntoExpedicion: string;
  numero: number;
  numeroDocumento: string;     // "001-001-0000001"
  cdc: string;                 // 44 chars
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

export interface SifenEmisor {
  ruc: string;
  timbrado: string;
  timbradoFecha: string;       // YYYY-MM-DD
  razonSocial: string;
  nombreFantasia?: string;
  tipoContribuyente: 1 | 2;
  tipoRegimen: number;
  actividadCodigo: string;
  actividadDescripcion: string;
  establecimiento: string;     // "001"
  puntoExpedicion: string;     // "001"
  direccion: string;
  departamento: number;
  departamentoDesc: string;
  distrito: number;
  distritoDesc: string;
  ciudad: number;
  ciudadDesc: string;
  telefono?: string;
  email?: string;
}

export interface SifenCertificateInfo {
  exists: boolean;
  commonName: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint: string | null;
  daysUntilExpiry: number | null;
  hasPassword: boolean;
}

export interface SifenConfigResponse {
  enabled: boolean;
  environment: SifenEnvironment;
  emisor: SifenEmisor | null;
  csc: { id: string | null; hasValue: boolean };
  certificate: SifenCertificateInfo | null;
  source: 'tenantSetting' | 'env' | 'mixed' | 'unconfigured';
  updatedAt: string | null;
}

/** Input do PUT /v1/sifen/config — tudo opcional (PATCH semântico). */
export interface UpdateSifenConfigInput {
  enabled?: boolean;
  environment?: SifenEnvironment;
  emisor?: Partial<SifenEmisor>;
  csc?: { id?: string; value?: string };
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

// -----------------------------------------------------------------------------
// DOCUMENTS
// -----------------------------------------------------------------------------
export interface ListSifenParams {
  page?: number;
  pageSize?: number;
  type?: SifenDocumentType;
  status?: SifenDocumentStatus;
  contractInvoiceId?: string;
  oneTimeChargeId?: string;
  cdc?: string;
  numero?: number;
  issuedFrom?: string;
  issuedTo?: string;
  sortBy?: 'issuedAt' | 'numero' | 'totalAmount';
  sortDir?: 'asc' | 'desc';
}

export interface EmitSifenInput {
  type: SifenDocumentType;
  contractInvoiceId?: string;
  oneTimeChargeId?: string;
  note?: string;
}

export const sifenApi = {
  // ---- Documentos ----
  listPath: (params: ListSifenParams = {}) => `/v1/sifen/documents${qs(params)}`,
  list(params: ListSifenParams = {}) {
    return api.get<Paginated<SifenDocument>>(this.listPath(params));
  },
  get(id: string) {
    return api.get<SifenDocument>(`/v1/sifen/documents/${id}`);
  },
  emit(input: EmitSifenInput) {
    return api.post<SifenDocument>('/v1/sifen/documents', input);
  },
  cancel(id: string, reason: string) {
    return api.post<SifenDocument>(`/v1/sifen/documents/${id}/cancel`, { reason });
  },
  /** Retorna o XML assinado como string (Content-Type: application/xml). */
  async getXml(id: string): Promise<string> {
    // O backend devolve text/xml direto. Fetch manual pra preservar string.
    const res = await fetch(
      `${(process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '')}/v1/sifen/documents/${id}/xml`,
      {
        headers: typeof window !== 'undefined' && localStorage.getItem('netx.accessToken')
          ? { authorization: `Bearer ${localStorage.getItem('netx.accessToken')}` }
          : {},
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },

  // ---- Config ----
  configPath: () => '/v1/sifen/config',
  getConfig() {
    return api.get<SifenConfigResponse>('/v1/sifen/config');
  },
  saveConfig(input: UpdateSifenConfigInput) {
    return api.put<SifenConfigResponse>('/v1/sifen/config', input);
  },
  certificatePath: () => '/v1/sifen/config/certificate',
  getCertificate() {
    return api.get<SifenCertificateInfo>('/v1/sifen/config/certificate');
  },
  uploadCertificate(file: File, password: string) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('password', password);
    return apiUpload<SifenCertificateInfo>('/v1/sifen/config/certificate', fd);
  },
  deleteCertificate() {
    return api.delete<{ removed: boolean }>('/v1/sifen/config/certificate');
  },
};
