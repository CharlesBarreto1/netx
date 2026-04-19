/**
 * Tenant context attached to every authenticated request. Resolved by
 * the TenantMiddleware (subdomain / header / JWT claim).
 */
export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  locale: string;
  timezone: string;
  currency: string;
}

/**
 * Authenticated principal carried in req.user after JWT verification.
 */
export interface AuthenticatedPrincipal {
  sub: string; // userId
  tenantId: string;
  email: string;
  roles: string[];
  permissions: string[];
  mfaAuthenticated: boolean;
  sessionId: string;
}
