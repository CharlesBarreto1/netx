import { z } from 'zod';

export const LoginRequestSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  tenantSlug: z.string().min(1).max(63).optional(),
  mfaToken: z.string().length(6).regex(/^\d+$/).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number; // seconds
}

export interface LoginResponse extends AuthTokens {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
    permissions: string[];
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
    locale: string;
    timezone: string;
    currency: string;
  };
}

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(12).max(128),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
