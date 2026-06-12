/**
 * Cliente do estado de licença desta instalação (ver módulo licensing no core).
 * GET /v1/license/status é isento do LicenseGuard (@LicenseBypass) — logo
 * continua legível mesmo com a UI bloqueada por 402.
 */
import { api } from './api';
import type { LicenseStatusResponse } from '@netx/shared';

export type { LicenseStatusResponse } from '@netx/shared';

export const licenseApi = {
  statusPath: () => `/v1/license/status`,
  status: () => api.get<LicenseStatusResponse>('/v1/license/status'),
  /** Força um heartbeat agora (regularização). Admin only no backend. */
  refresh: () => api.post<LicenseStatusResponse>('/v1/license/heartbeat', {}),
};
