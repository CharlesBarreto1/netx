import type { Role } from '@prisma/client';

/** Identidade autenticada, derivada do JWT e anexada ao request. */
export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  /**
   * true quando a identidade veio do SSO do Core (NetX), não de um usuário
   * nativo do NMS. Não há linha em `app_user` pra ela; o `username` é
   * `core:<userId>` e serve de actor na auditoria (AGENTS.md §5).
   */
  external?: boolean;
}

/** Claims que assinamos no JWT (HS256). `sub` = id do usuário. */
export interface JwtClaims {
  sub: string;
  username: string;
  role: Role;
}

/**
 * Claims do JWT de operador emitido pelo Core do NetX (SSO, canal 1). Espelha
 * `AccessTokenPayload` de `@netx/auth` — só os campos que o NMS consome. Não
 * importamos o tipo do Core pra manter o NMS desacoplado do workspace npm.
 */
export interface CoreJwtClaims {
  sub: string; // userId no Core
  tid?: string; // tenantId
  tsl?: string; // tenantSlug
  roles?: string[];
  perms?: string[];
}
