/**
 * Cliente HTTP do Portal do Cliente.
 *
 * Sessão isolada da operação:
 *   - localStorage key `netx.portalToken` (não `netx.accessToken`).
 *   - Em 401 redireciona pra /portal/login (não /login).
 *
 * Importante: nunca importar `lib/api.ts` aqui — aquele cliente intercepta
 * 401 redirecionando pra /login, o que estraga o fluxo do portal.
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');

const TOKEN_KEY = 'netx.portalToken';
const SESSION_KEY = 'netx.portalSession';

export interface PortalSession {
  token: string;
  expiresIn: number;
  customer: {
    id: string;
    displayName: string;
    primaryEmail: string | null;
    locale: string | null;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
    locale: string;
    currency: string;
  };
}

export interface PortalMe {
  id: string;
  code: string | null;
  type: 'INDIVIDUAL' | 'COMPANY';
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  tradeName: string | null;
  taxId: string | null;
  taxIdType: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  preferredLanguage: string | null;
  timezone: string | null;
  portalLastLoginAt: string | null;
  addresses: Array<{
    id: string;
    type: string;
    country: string;
    state: string | null;
    city: string;
    district: string | null;
    street: string;
    number: string | null;
    complement: string | null;
    isPrimary: boolean;
  }>;
}

export interface PortalContract {
  id: string;
  code: string | null;
  authMethod: 'PPPOE' | 'IPOE';
  pppoeUsername: string | null;
  bandwidthMbps: number;
  monthlyValue: number;
  dueDay: number;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  installationAddress: string;
  activatedAt: string | null;
  suspendedAt: string | null;
}

export interface PortalBillingItem {
  kind: 'INVOICE' | 'CHARGE';
  id: string;
  code: string | null;
  description: string;
  amount: number;
  paidAmount: number | null;
  dueDate: string;
  status: 'OPEN' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  paidAt: string | null;
}

export interface PortalBilling {
  invoices: PortalBillingItem[];
  charges: PortalBillingItem[];
}

export class PortalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = 'PortalApiError';
  }
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getPortalSession(): PortalSession | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearPortalSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}

function persistSession(s: PortalSession): void {
  localStorage.setItem(TOKEN_KEY, s.token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? safeParse(text) : null;

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      clearPortalSession();
      if (!window.location.pathname.startsWith('/portal/login')) {
        window.location.href = '/portal/login';
      }
    }
    const detail =
      (parsed as { detail?: string; message?: string } | null)?.detail ??
      (parsed as { message?: string } | null)?.message ??
      `HTTP ${res.status}`;
    throw new PortalApiError(res.status, detail);
  }
  return (parsed ?? undefined) as T;
}

function safeParse(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export const portalApi = {
  async login(input: { tenantSlug?: string; taxId: string; code: string }) {
    // Omite tenantSlug quando vazio pra que o backend use o
    // DEFAULT_TENANT_SLUG da instância (uma URL = uma operação).
    const body: Record<string, string> = {
      taxId: input.taxId,
      code: input.code,
    };
    if (input.tenantSlug && input.tenantSlug.trim()) {
      body.tenantSlug = input.tenantSlug.trim();
    }
    const session = await request<PortalSession>('POST', '/v1/portal/login', body);
    persistSession(session);
    return session;
  },
  logout() {
    clearPortalSession();
  },
  me: () => request<PortalMe>('GET', '/v1/portal/me'),
  contracts: () => request<PortalContract[]>('GET', '/v1/portal/contracts'),
  invoices: () => request<PortalBilling>('GET', '/v1/portal/invoices'),
};
