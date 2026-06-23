import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * JWT HS256 mínimo (sem dependência externa) pra sessão da central do cliente.
 * Só o necessário: sign + verify com expiração. Segredo em HUB_PORTAL_JWT_SECRET.
 */

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function b64urlJson(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}
function fromB64url(s: string): Buffer {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4 === 0 ? '' : '='.repeat(4 - (b.length % 4));
  return Buffer.from(b + pad, 'base64');
}

export interface PortalJwtPayload {
  sub: string; // hubUserId
  lid: string; // licenseeId
  email: string;
  iat: number;
  exp: number;
}

export interface AdminJwtPayload {
  sub: string; // hubAdminId
  email: string;
  kind: 'admin';
  iat: number;
  exp: number;
}

function requireSecret(envName: string): string {
  const s = process.env[envName];
  if (!s || s.length < 16) {
    throw new Error(`${envName} ausente/curto (mín. 16 chars).`);
  }
  return s;
}

function sign<T extends Record<string, unknown>>(
  payload: T,
  envName: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + ttlSeconds };
  const head = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlJson(full);
  const sig = b64url(createHmac('sha256', requireSecret(envName)).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

function verify<T extends { exp?: number }>(token: string, envName: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = createHmac('sha256', requireSecret(envName)).update(`${head}.${body}`).digest();
  const got = fromB64url(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let payload: T;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

export function signPortalJwt(
  payload: Omit<PortalJwtPayload, 'iat' | 'exp'>,
  ttlSeconds = 12 * 3600,
): string {
  return sign(payload, 'HUB_PORTAL_JWT_SECRET', ttlSeconds);
}
export function verifyPortalJwt(token: string): PortalJwtPayload | null {
  return verify<PortalJwtPayload>(token, 'HUB_PORTAL_JWT_SECRET');
}

export function signAdminJwt(
  payload: Omit<AdminJwtPayload, 'iat' | 'exp'>,
  ttlSeconds = 12 * 3600,
): string {
  return sign(payload, 'HUB_ADMIN_JWT_SECRET', ttlSeconds);
}
export function verifyAdminJwt(token: string): AdminJwtPayload | null {
  return verify<AdminJwtPayload>(token, 'HUB_ADMIN_JWT_SECRET');
}
