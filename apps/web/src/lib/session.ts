/**
 * Helpers para ler/escrever a sessão do usuário no client.
 * Tudo mora em sessionStorage (limpo ao fechar a aba) — sem persistência cruzada.
 */

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  /** Override de visibilidade de menus. null/undefined = sem restrição extra. */
  menuAccess?: string[] | null;
}

export interface SessionTenant {
  id: string;
  slug: string;
  name: string;
  locale: string;
  timezone: string;
  currency: string;
}

export interface Session {
  user: SessionUser;
  tenant: SessionTenant;
  accessToken: string;
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const accessToken = sessionStorage.getItem('netx.accessToken');
  const user = safeJson<SessionUser>(sessionStorage.getItem('netx.user'));
  const tenant = safeJson<SessionTenant>(sessionStorage.getItem('netx.tenant'));
  if (!accessToken || !user || !tenant) return null;
  return { accessToken, user, tenant };
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.clear();
}

export function hasPermission(perm: string): boolean {
  const s = getSession();
  return !!s?.user.permissions.includes(perm);
}

export function hasAnyPermission(perms: string[]): boolean {
  const s = getSession();
  if (!s) return false;
  return perms.some((p) => s.user.permissions.includes(p));
}

export function displayName(u: Pick<SessionUser, 'firstName' | 'lastName'>): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
}
