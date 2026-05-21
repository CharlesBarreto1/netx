/**
 * DTOs pra ONT (consulta + manipulação manual). O fluxo principal de criar
 * uma ONT é via `installCustomer` no provisioning, não CRUD direto.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { z } from 'zod';
import { MacAddressSchema, OntStatusSchema, SnGponSchema, type OntStatus } from './types';

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v ?? null));

export const ListOntsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: OntStatusSchema.optional(),
  oltId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  search: z.string().max(120).optional(),
});
export type ListOntsQuery = z.infer<typeof ListOntsQuerySchema>;

export const UpdateOntRequestSchema = z
  .object({
    snGpon: SnGponSchema.optional(),
    macAddress: MacAddressSchema.nullish(),
    serialPhysical: optionalString(64),
    ponFrame: z.coerce.number().int().min(0).nullish(),
    ponSlot: z.coerce.number().int().min(0).nullish(),
    ponOnuIndex: z.coerce.number().int().min(0).nullish(),
    notes: optionalString(2000),
  })
  .strict();
export type UpdateOntRequest = z.infer<typeof UpdateOntRequestSchema>;

export interface OntResponse {
  id: string;
  tenantId: string;
  contractId: string;
  oltId: string;
  oltName?: string;
  snGpon: string;
  macAddress: string | null;
  serialPhysical: string | null;
  ponFrame: number | null;
  ponSlot: number | null;
  ponOnuIndex: number | null;
  status: OntStatus;
  lastRxPower: string | null;
  lastTxPower: string | null;
  authorizedAt: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
