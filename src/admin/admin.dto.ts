import { z } from 'zod';

export const LicenseeDataSchema = z.object({
  name: z.string().min(1).max(200),
  taxId: z.string().max(40).optional(),
  taxIdType: z.string().max(16).optional(),
  contactEmail: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  addressLine: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  country: z.string().length(2).default('BR'),
  currency: z.string().length(3).default('BRL'),
  plan: z.string().max(40).default('per-contract'),
  maxContracts: z.number().int().min(0).default(0),
  /** Códigos de módulo habilitados (vazio = todos). Catálogo do ecossistema. */
  modules: z.array(z.string().max(40)).max(32).default([]),
  pricePerContractCents: z.number().int().min(0).default(0),
  billingDay: z.number().int().min(1).max(28).default(10),
  billingActive: z.boolean().default(true),
  notes: z.string().max(2000).optional(),
});
export type LicenseeData = z.infer<typeof LicenseeDataSchema>;
/** Update parcial — todos os campos opcionais. */
export const UpdateLicenseeSchema = LicenseeDataSchema.partial();
export type UpdateLicensee = z.infer<typeof UpdateLicenseeSchema>;

export const CreateHubUserSchema = z.object({
  licenseeId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().max(120).optional(),
});
export type CreateHubUser = z.infer<typeof CreateHubUserSchema>;

export const MarkPaidSchema = z.object({
  method: z.enum(['PIX', 'CARD', 'MANUAL']).default('MANUAL'),
  ref: z.string().max(200).optional(),
  amountCents: z.number().int().min(0).optional(),
});
export type MarkPaid = z.infer<typeof MarkPaidSchema>;

export const CreateInstanceSchema = z.object({
  licenseeId: z.string().uuid(),
  /** instanceId gerado no enrollment do installer (NETX_INSTANCE_ID). */
  instanceId: z.string().uuid(),
  label: z.string().max(120).optional(),
  blockMode: z.enum(['UI_ONLY', 'UI_AND_PROVISIONING']).default('UI_ONLY'),
});
export type CreateInstance = z.infer<typeof CreateInstanceSchema>;

export const SetStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'BLOCKED', 'SUSPENDED']),
});
export type SetStatus = z.infer<typeof SetStatusSchema>;
