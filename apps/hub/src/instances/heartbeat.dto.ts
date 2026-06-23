import { z } from 'zod';

/** Espelho de LicenseHeartbeatRequestSchema do NetX (@netx/shared). */
export const HeartbeatRequestSchema = z.object({
  instanceId: z.string().uuid(),
  version: z.string().max(40),
  activeContracts: z.number().int().min(0),
  nonce: z.string().min(8).max(64),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;
