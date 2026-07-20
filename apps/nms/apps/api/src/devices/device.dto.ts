import { z } from 'zod';

/**
 * DTOs de Device validados por Zod. NMS multi-vendor: `vendor` aceita `juniper`,
 * `mikrotik` ou `cisco_iosxe` (default juniper p/ compat). Credenciais NÃO entram
 * aqui — fluxo separado pelo cofre (ADR 0002).
 */
export const DeviceVendorSchema = z.enum(['juniper', 'mikrotik', 'cisco_iosxe']);
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

/**
 * Upsert vindo do NetX Core (Planta de rede → NMS). Idempotente por
 * `coreEquipmentId`: o Core pode reenviar quantas vezes quiser — em retry,
 * reconciliação ou edição do equipamento — sem criar device duplicado.
 *
 * Separado do CreateDeviceSchema de propósito: este é um contrato entre
 * serviços, não um formulário de operador.
 */
export const UpsertFromCoreSchema = CreateDeviceSchema.extend({
  coreEquipmentId: z.string().uuid(),
});
export type UpsertFromCoreDto = z.infer<typeof UpsertFromCoreSchema>;
