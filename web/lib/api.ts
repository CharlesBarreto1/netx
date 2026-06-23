'use client';

/**
 * Cliente HTTP do app web do Hub. Duas auths:
 *   - admin: Bearer JWT (login e-mail+senha da equipe NetX)
 *   - portal: Bearer JWT (guardado após /portal/login)
 * Base URL via NEXT_PUBLIC_HUB_API (default http://localhost:4000/v1).
 */
const BASE = (process.env.NEXT_PUBLIC_HUB_API ?? 'http://localhost:4000/v1').replace(/\/$/, '');

const ADMIN_TOKEN_KEY = 'netxhub.adminToken';
const PORTAL_TOKEN_KEY = 'netxhub.portalToken';

export const adminToken = {
  get: () => (typeof window === 'undefined' ? null : localStorage.getItem(ADMIN_TOKEN_KEY)),
  set: (t: string) => localStorage.setItem(ADMIN_TOKEN_KEY, t),
  clear: () => localStorage.removeItem(ADMIN_TOKEN_KEY),
};
export const portalToken = {
  get: () => (typeof window === 'undefined' ? null : localStorage.getItem(PORTAL_TOKEN_KEY)),
  set: (t: string) => localStorage.setItem(PORTAL_TOKEN_KEY, t),
  clear: () => localStorage.removeItem(PORTAL_TOKEN_KEY),
};

export class HubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.headers ?? {}),
    },
    body: opts.body == null ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : null) ?? `Erro ${res.status}`;
    throw new HubApiError(res.status, msg);
  }
  return (data ?? undefined) as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

// ── Admin ─────────────────────────────────────────────────────────────────────
// Login da equipe NetX → Bearer JWT (guardado em adminToken).
function adminHeaders(): Record<string, string> {
  const t = adminToken.get();
  return t ? { authorization: `Bearer ${t}` } : {};
}
export const adminApi = {
  login: (email: string, password: string) =>
    req<{ token: string; name: string | null }>('POST', '/admin/auth/login', {
      body: { email, password },
    }),
  me: () => req('GET', '/admin/auth/me', { headers: adminHeaders() }),
  ping: () => req('GET', '/admin/auth/me', { headers: adminHeaders() }),
  listLicensees: () => req<any[]>('GET', '/admin/licensees', { headers: adminHeaders() }),
  getLicensee: (id: string) => req<any>('GET', `/admin/licensees/${id}`, { headers: adminHeaders() }),
  createLicensee: (body: unknown) =>
    req<any>('POST', '/admin/licensees', { body, headers: adminHeaders() }),
  updateLicensee: (id: string, body: unknown) =>
    req<any>('POST', `/admin/licensees/${id}`, { body, headers: adminHeaders() }),
  createHubUser: (body: unknown) =>
    req<any>('POST', '/admin/hub-users', { body, headers: adminHeaders() }),
  createInstance: (body: unknown) =>
    req<any>('POST', '/admin/instances', { body, headers: adminHeaders() }),
  setInstanceStatus: (id: string, status: string) =>
    req<any>('POST', `/admin/instances/${id}/status`, { body: { status }, headers: adminHeaders() }),
  rotateKey: (id: string) =>
    req<any>('POST', `/admin/instances/${id}/rotate-key`, { headers: adminHeaders() }),
  listInvoices: (licenseeId?: string) =>
    req<any[]>('GET', `/admin/invoices${licenseeId ? `?licenseeId=${licenseeId}` : ''}`, {
      headers: adminHeaders(),
    }),
  generateInvoice: (licenseeId: string) =>
    req<any>('POST', `/admin/licensees/${licenseeId}/generate-invoice`, { headers: adminHeaders() }),
  markPaid: (invoiceId: string, body: unknown) =>
    req<any>('POST', `/admin/invoices/${invoiceId}/mark-paid`, { body, headers: adminHeaders() }),
  // Wiki
  wikiList: () => req<any[]>('GET', '/admin/wiki', { headers: adminHeaders() }),
  wikiGet: (slug: string) => req<any>('GET', `/admin/wiki/${slug}`, { headers: adminHeaders() }),
  wikiCreate: (body: unknown) => req<any>('POST', '/admin/wiki', { body, headers: adminHeaders() }),
  wikiUpdate: (id: string, body: unknown) =>
    req<any>('POST', `/admin/wiki/${id}`, { body, headers: adminHeaders() }),
  wikiRemove: (id: string) => req<void>('DELETE', `/admin/wiki/${id}`, { headers: adminHeaders() }),
};

// ── Portal ──────────────────────────────────────────────────────────────────
function portalHeaders(): Record<string, string> {
  const t = portalToken.get();
  return t ? { authorization: `Bearer ${t}` } : {};
}
export const portalApi = {
  login: (email: string, password: string) =>
    req<{ token: string }>('POST', '/portal/login', { body: { email, password } }),
  me: () => req<any>('GET', '/portal/me', { headers: portalHeaders() }),
  invoices: () => req<any[]>('GET', '/portal/invoices', { headers: portalHeaders() }),
  trustUnlock: () => req<any>('POST', '/portal/trust-unlock', { headers: portalHeaders() }),
  pay: (invoiceId: string, method: 'PIX' | 'CARD') =>
    req<any>('POST', '/portal/pay', { body: { invoiceId, method }, headers: portalHeaders() }),
  // Central de ajuda (somente leitura)
  wikiList: () => req<any[]>('GET', '/portal/wiki', { headers: portalHeaders() }),
  wikiGet: (slug: string) => req<any>('GET', `/portal/wiki/${slug}`, { headers: portalHeaders() }),
};

// ── Helpers de formatação ─────────────────────────────────────────────────────
export function money(cents: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format((cents ?? 0) / 100);
}
export function date(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}
