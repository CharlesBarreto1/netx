import { ClsService } from 'nestjs-cls';

// nestjs-cls v4 exige que o store seja indexável por string | symbol
export interface TenantClsStore {
  [key: string]: unknown;
  [key: symbol]: unknown;
  tenantId?: string;
  tenantSlug?: string;
  userId?: string;
  correlationId?: string;
}

export function setTenantContext(
  cls: ClsService<TenantClsStore>,
  ctx: Partial<TenantClsStore>,
): void {
  Object.entries(ctx).forEach(([k, v]) => cls.set(k, v));
}

export function getTenantId(cls: ClsService<TenantClsStore>): string {
  const tid = cls.get('tenantId');
  if (!tid) throw new Error('tenantId not set in CLS store');
  return tid as string;
}
