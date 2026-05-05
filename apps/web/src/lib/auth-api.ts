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
