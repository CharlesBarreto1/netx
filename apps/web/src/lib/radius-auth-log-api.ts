import { api } from './api';

export interface AuthLogEntry {
  id: number;
  username: string;
  reply: string;
  accepted: boolean;
  authdate: string;
  calledStationId: string | null;
  callingStationId: string | null;
  reason: string | null;
  contract: { id: string; code: string | null } | null;
  customer: { id: string; displayName: string } | null;
}

export interface AuthLogResponse {
  data: AuthLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuthLogQuery {
  page?: number;
  pageSize?: number;
  username?: string;
  status?: 'accepted' | 'rejected';
  dateFrom?: string;
  dateTo?: string;
}

function qs(p: AuthLogQuery): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const radiusAuthLogApi = {
  listPath: (q: AuthLogQuery = {}) => `/v1/radius/auth-log${qs(q)}`,
  list(q: AuthLogQuery = {}) {
    return api.get<AuthLogResponse>(this.listPath(q));
  },
};
