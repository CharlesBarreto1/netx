import { z } from 'zod';

import { strongPasswordSchema } from './auth/password';

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
    /** Override de visibilidade de menus. null = usa só permissões. */
    menuAccess: string[] | null;
    /**
     * Quando true, o frontend DEVE redirecionar pra /first-login antes de
     * mostrar qualquer tela protegida. Setado pelo backend quando o user
     * tem `users.must_change_password = true` (ex.: admin recém-seedado,
     * usuário cuja senha foi resetada por outro admin).
     */
    mustChangePassword: boolean;
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
  newPassword: strongPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

// =============================================================================
// MFA / 2FA (TOTP)
// =============================================================================
export const VerifyMfaRequestSchema = z.object({
  /** Código TOTP de 6 dígitos do app autenticador. */
  token: z.string().length(6).regex(/^\d+$/u),
});
export type VerifyMfaRequest = z.infer<typeof VerifyMfaRequestSchema>;

export const DisableMfaRequestSchema = z.object({
  /** Senha atual pra confirmar identidade ao desativar 2FA. */
  password: z.string().min(8).max(128),
});
export type DisableMfaRequest = z.infer<typeof DisableMfaRequestSchema>;

/** Resposta do setup — frontend desenha o QR e mostra o secret pra quem
 *  prefere digitar manualmente em apps tipo Authy/Google Authenticator. */
export interface SetupMfaResponse {
  secret: string;
  /** otpauth://totp/... URL — pode ser virada em QR no front. */
  otpauthUrl: string;
  /** Data URL do QR (PNG base64) gerado no backend pra UI fácil. */
  qrCodeDataUrl: string;
}

export interface MfaBackupCodesResponse {
  /** Códigos de uso único, plain. Mostrar UMA VEZ na UI. */
  codes: string[];
}
