import { z } from 'zod';

/**
 * Contrato do heartbeat entre o NetX (cliente) e o Hub (netx-hub).
 * Compartilhado pra os dois lados validarem o mesmo shape.
 */

export const LicenseHeartbeatRequestSchema = z.object({
  /** uuid da instalação (NETX_INSTANCE_ID). */
  instanceId: z.string().uuid(),
  /** Versão do NetX rodando (ex.: "0.1.0"). */
  version: z.string().max(40),
  /** Telemetria de cobrança: contratos ativos no momento. */
  activeContracts: z.number().int().min(0),
  /** Nonce anti-replay (o Hub pode exigir unicidade por janela). */
  nonce: z.string().min(8).max(64),
});
export type LicenseHeartbeatRequest = z.infer<typeof LicenseHeartbeatRequestSchema>;

export interface LicenseHeartbeatResponse {
  /** Token JWS Ed25519 renovado (válido por LICENSE_TOKEN_TTL_DAYS). */
  token: string;
}

/** Status local da licença, exposto pelo NetX em GET /v1/license/status. */
export interface LicenseStatusResponse {
  /** Licenciamento ligado nesta instalação? (hubUrl + key presentes) */
  enabled: boolean;
  effect: 'ALLOW' | 'GRACE' | 'BLOCK_UI' | 'BLOCK_UI_PROVISIONING' | 'DISABLED';
  status: 'ACTIVE' | 'BLOCKED' | 'SUSPENDED' | 'NONE';
  expiresAt: string | null; // ISO
  lastHeartbeatAt: string | null; // ISO
  lastError: string | null;
}
