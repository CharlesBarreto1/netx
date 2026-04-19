import { ClsService } from 'nestjs-cls';

export interface TenantClsStore extends Record<string, unknown> {
  tenantId?: string;
  tenantSlug?: string;
  userId?: string;
  correlationId?: string;
}

export function setTenantContext(cls: ClsService<TenantClsStore>, ctx: Partial<TenantClsStore>): void {
  Object.entries(ctx).forEach(([k, v]) => cls.set(k as keyof TenantClsStore, v));
}

export function getTenantId(cls: ClsService<TenantClsStore>): string {
  const tid = cls.get('tenantId');
  if (!tid) throw new Error('tenantId not set in CLS store');
  return tid;
}
