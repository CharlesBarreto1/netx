import { api } from './api';

export interface SetupMfaResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export interface MfaBackupCodesResponse {
  codes: string[];
}

export const authApi = {
  /**
   * Invalida a session no backend (marca Session.revokedAt). Sem isso, o
   * refresh token continua válido até expirar (até 7 dias) mesmo após o user
   * apertar "Sair" — atacante de posse do refresh consegue manter sessão viva.
   *
   * Tolerante a falha: se o backend está fora ou o token já expirou, o frontend
   * ainda completa o fluxo de logout local (clearSession + redirect).
   */
  async logout(): Promise<void> {
    try {
      await api.post('/v1/auth/logout');
    } catch {
      // intencionalmente silencioso — logout local é mais importante que
      // confirmação do backend.
    }
  },
  changePassword(currentPassword: string, newPassword: string) {
    return api.post('/v1/auth/password', { currentPassword, newPassword });
  },
  // MFA
  setupMfa() {
    return api.post<SetupMfaResponse>('/v1/auth/mfa/setup');
  },
  verifyMfa(token: string) {
    return api.post<MfaBackupCodesResponse>('/v1/auth/mfa/verify', { token });
  },
  disableMfa(password: string) {
    return api.post('/v1/auth/mfa/disable', { password });
  },
  regenerateBackupCodes() {
    return api.post<MfaBackupCodesResponse>(
      '/v1/auth/mfa/regenerate-backup-codes',
    );
  },
};
