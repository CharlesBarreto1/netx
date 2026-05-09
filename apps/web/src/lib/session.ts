/**
 * Helpers para ler/escrever a sessão do usuário no client.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 * @provenance MDg0NzI5Njg5MDE=
 *
 * Por que localStorage e não sessionStorage:
 *   sessionStorage é por-aba — uma aba nova aberta via target="_blank" ganha
 *   storage VAZIO e o ProtectedLayout joga o user pra /login. Inviabiliza
 *   abrir páginas de impressão (O.S, faturas) em nova aba. localStorage é
 *   compartilhado entre todas as abas do mesmo origin.
 *
 *   Trade-off: o token persiste até logout/expiração explícita em vez de
 *   limpar ao fechar a aba. Aceitável pra B2B SaaS — o backend valida o JWT
 *   em todo request e o ApiError 401 chama `clearSession() + redirect` no
 *   `handleUnauthorized`.
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
  /**
   * Se true, o ProtectedLayout redireciona pra /first-login. Setado pelo
   * backend quando admin seedou senha temporária ou resetou senha de outro
   * user. Limpado pelo POST /v1/auth/change-password ao final do flow.
   */
  mustChangePassword?: boolean;
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
  const accessToken = localStorage.getItem('netx.accessToken');
  const user = safeJson<SessionUser>(localStorage.getItem('netx.user'));
  const tenant = safeJson<SessionTenant>(localStorage.getItem('netx.tenant'));
  if (!accessToken || !user || !tenant) return null;
  return { accessToken, user, tenant };
}

/**
 * Limpa só as chaves do NetX em localStorage (não usa `.clear()` pra evitar
 * apagar coisas de outros apps/extensões eventuais no mesmo origin).
 */
export function clearSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('netx.accessToken');
  localStorage.removeItem('netx.refreshToken');
  localStorage.removeItem('netx.user');
  localStorage.removeItem('netx.tenant');
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
