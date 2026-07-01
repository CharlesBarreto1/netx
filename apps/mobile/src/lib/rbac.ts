/**
 * RBAC do NetX Field — espelha apps/web/src/lib/session.ts. As capacidades são
 * reveladas por PERMISSÃO + entitlement; o "papel" é só um atalho de navegação.
 * Fonte: user.roles / user.permissions (já vêm no snapshot da sessão).
 */
import type { SessionUser } from './auth-storage';

export type FieldRole = 'admin' | 'tecnico' | 'atendente';

export function hasRole(user: SessionUser | null, role: string): boolean {
  return !!user?.roles?.includes(role);
}

export function hasPermission(user: SessionUser | null, perm: string): boolean {
  return !!user?.permissions?.includes(perm);
}

export function hasAnyPermission(user: SessionUser | null, perms: string[]): boolean {
  return perms.some((p) => hasPermission(user, p));
}

/**
 * Papel primário no Field, derivado de roles do ERP (com fallback por permissão
 * pra tenants que usam roles custom). Admin vence; senão técnico (executa O.S/
 * provisiona); senão atendente (chat/360). null = sem papel de campo.
 */
export function fieldRole(user: SessionUser | null): FieldRole | null {
  if (!user) return null;
  if (hasRole(user, 'admin') || hasRole(user, 'superadmin')) return 'admin';
  if (hasRole(user, 'tecnico') || hasPermission(user, 'provisioning.write')) return 'tecnico';
  if (hasRole(user, 'atendente') || hasPermission(user, 'chat.read')) return 'atendente';
  // Operador genérico com O.S mas sem papel específico → trata como técnico.
  if (hasPermission(user, 'service_orders.write')) return 'tecnico';
  if (hasPermission(user, 'field.subscriber360.read')) return 'atendente';
  return null;
}
