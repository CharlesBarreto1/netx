import { z } from 'zod';

/**
 * Ações privilegiadas do NetX Field. Hoje: desbloqueio de cliente (reativa um
 * contrato suspenso). Exige permissão `field.unblock` + step-up (sessão elevada)
 * e é sempre auditado (quem/quando/de onde). Online-obrigatório — nunca offline.
 */
export const FieldUnblockRequestSchema = z.object({
  /** Motivo/observação do desbloqueio (vai pro audit e pra nota do contrato). */
  note: z.string().max(500).optional(),
});
export type FieldUnblockRequest = z.infer<typeof FieldUnblockRequestSchema>;
