import type { Role } from '@prisma/client';

/** Identidade autenticada, derivada do JWT e anexada ao request. */
export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

/** Claims que assinamos no JWT (HS256). `sub` = id do usuário. */
export interface JwtClaims {
  sub: string;
  username: string;
  role: Role;
}
