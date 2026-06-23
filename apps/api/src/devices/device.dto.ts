import { z } from 'zod';

/**
 * DTOs de Device validados por Zod. `vendor` é fixo em `juniper` no MVP (não entra no
 * payload). Credenciais NÃO entram aqui — fluxo separado pelo cofre (ADR 0002).
 */
export const CreateDeviceSchema = z.object({
  hostname: z.string().min(1).max(255),
  mgmtIp: z.string().ip({ message: 'mgmtIp deve ser um IP válido' }),
  model: z.string().max(120).optional(),
  osVersion: z.string().max(120).optional(),
  site: z.string().max(120).optional(),
});
export type CreateDeviceDto = z.infer<typeof CreateDeviceSchema>;

export const UpdateDeviceSchema = CreateDeviceSchema.partial();
export type UpdateDeviceDto = z.infer<typeof UpdateDeviceSchema>;
