import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';

export interface AccessTokenPayload extends JwtPayload {
  sub: string;        // userId
  tid: string;        // tenantId
  tsl: string;        // tenantSlug
  roles: string[];
  perms: string[];
  sid: string;        // sessionId
  mfa: boolean;
}

export interface RefreshTokenPayload extends JwtPayload {
  sub: string;
  tid: string;
  sid: string;
  jti: string;        // token id (uuid) — allows revocation
}

export interface JwtSigner {
  signAccess(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): string;
  signRefresh(payload: Omit<RefreshTokenPayload, 'iat' | 'exp'>): string;
  verifyAccess(token: string): AccessTokenPayload;
  verifyRefresh(token: string): RefreshTokenPayload;
}

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  accessExpiresIn: string;
  refreshExpiresIn: string;
  issuer?: string;
  audience?: string;
}

export function createJwtSigner(config: JwtConfig): JwtSigner {
  const issuer: string = config.issuer ?? 'netx';
  const audience: string = config.audience ?? 'netx-api';

  return {
    signAccess(payload) {
      return jwt.sign(payload, config.accessSecret, {
        issuer,
        audience,
        expiresIn: config.accessExpiresIn as SignOptions['expiresIn'],
        algorithm: 'HS256',
      });
    },
    signRefresh(payload) {
      return jwt.sign(payload, config.refreshSecret, {
        issuer,
        audience,
        expiresIn: config.refreshExpiresIn as SignOptions['expiresIn'],
        algorithm: 'HS256',
      });
    },
    verifyAccess(token) {
      return jwt.verify(token, config.accessSecret, {
        issuer,
        audience,
        algorithms: ['HS256'],
      }) as unknown as AccessTokenPayload;
    },
    verifyRefresh(token) {
      return jwt.verify(token, config.refreshSecret, {
        issuer,
        audience,
        algorithms: ['HS256'],
      }) as unknown as RefreshTokenPayload;
    },
  };
}
