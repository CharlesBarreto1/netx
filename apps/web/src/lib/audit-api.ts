/**
 * Cliente tipado pra GET /v1/audit/logs.
 */
import { api } from './api';

export type AuditLevel = 'INFO' | 'WARNING' | 'ERROR' | 'SECURITY';

export interface AuditLogEntry {
  id: string;
  tenantId: string | null;
  userId: string | null;
  actor: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  level: AuditLevel;
  ip: string | null;
  userAgent: string | null;
  beforeState: unknown;
  afterState: unknown;
  metadata: unknown;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
}

export interface AuditLogsResponse {
  data: AuditLogEntry[];
  total: number;
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  action?: string;
  userId?: string;
  resource?: string;
  resourceId?: string;
  level?: AuditLevel;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

function qs(p: AuditQuery): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const auditApi = {
  listPath: (query: AuditQuery = {}) => `/v1/audit/logs${qs(query)}`,
  list: (query: AuditQuery = {}) =>
    api.get<AuditLogsResponse>(`/v1/audit/logs${qs(query)}`),
};
