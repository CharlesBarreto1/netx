import { z } from 'zod';

/**
 * DTOs de Device validados por Zod. NMS multi-vendor: `vendor` aceita `juniper`
 * ou `mikrotik` (default juniper p/ compat). Credenciais NÃO entram aqui —
 * fluxo separado pelo cofre (ADR 0002).
 */
export const DeviceVendorSchema = z.enum(['juniper', 'mikrotik']);
export type DeviceVendor = z.infer<typeof DeviceVendorSchema>;

export const CreateDeviceSchema = z.object({
  hostname: z.string().min(1).max(255),
  mgmtIp: z.string().ip({ message: 'mgmtIp deve ser um IP válido' }),
  vendor: DeviceVendorSchema.default('juniper'),
  model: z.string().max(120).optional(),
  osVersion: z.string().max(120).optional(),
  site: z.string().max(120).optional(),
});
export type CreateDeviceDto = z.infer<typeof CreateDeviceSchema>;

export const UpdateDeviceSchema = CreateDeviceSchema.partial();
export type UpdateDeviceDto = z.infer<typeof UpdateDeviceSchema>;
