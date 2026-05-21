/**
 * DTOs pra CRUD de OLTs.
 *
 * Modela tanto OLTs diretas (Parks/Huawei SSH) quanto orquestradores
 * (Ufinet API). O discriminator é `providerMode`. O service valida que campos
 * SSH são preenchidos só pra DIRECT, e campos API só pra ORCHESTRATOR.
 *
 * Segurança:
 *   - `sshPassword` / `apiCredentials` em requests são plaintext (HTTPS only)
 *     e o service criptografa antes de salvar.
 *   - Nas responses NUNCA voltam — o front mostra "*** configurada" ou similar.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { z } from 'zod';
import {
  OltProviderModeSchema,
  OltStatusSchema,
  OltVendorSchema,
  type OltProviderMode,
  type OltStatus,
  type OltVendor,
} from './types';

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v ?? null));

export const CreateOltRequestSchema = z
  .object({
    name: z.string().min(1).max(128),
    vendor: OltVendorSchema,
    model: z.string().min(1).max(64),
    providerMode: OltProviderModeSchema.default('DIRECT'),

    // DIRECT
    managementIp: optionalString(45),
    sshPort: z.coerce.number().int().min(1).max(65535).default(22),
    sshUser: optionalString(64),
    sshPassword: optionalString(255),
    enableSecret: optionalString(255),

    // ORCHESTRATOR
    apiEndpoint: optionalString(255),
    apiAuthType: z.enum(['OAUTH2', 'API_KEY', 'MTLS']).nullish(),
    /** JSON serializável com credenciais (depende do authType). */
    apiCredentials: z.record(z.string(), z.unknown()).nullish(),
    apiWebhookSecret: optionalString(128),

    // Defaults
    serviceVlanId: z.coerce.number().int().min(1).max(4094).nullish(),
    defaultUpProfile: optionalString(64),
    defaultDownProfile: optionalString(64),
  })
  .superRefine((data, ctx) => {
    // Coerência de provider mode vs campos obrigatórios.
    if (data.providerMode === 'DIRECT') {
      if (!data.managementIp || !data.sshUser) {
        ctx.addIssue({
          code: 'custom',
          path: ['managementIp'],
          message: 'DIRECT mode exige managementIp e sshUser',
        });
      }
    } else if (data.providerMode === 'ORCHESTRATOR') {
      if (!data.apiEndpoint || !data.apiAuthType) {
        ctx.addIssue({
          code: 'custom',
          path: ['apiEndpoint'],
          message: 'ORCHESTRATOR mode exige apiEndpoint e apiAuthType',
        });
      }
    }
    // EXTERNAL: nenhum campo de conexão é obrigatório — a OLT é provisionada
    // por outro sistema. NetX só registra o nome/vendor pra inventário.
  });
export type CreateOltRequest = z.infer<typeof CreateOltRequestSchema>;

export const UpdateOltRequestSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    vendor: OltVendorSchema.optional(),
    model: z.string().min(1).max(64).optional(),
    providerMode: OltProviderModeSchema.optional(),
    managementIp: optionalString(45).optional(),
    sshPort: z.coerce.number().int().min(1).max(65535).optional(),
    sshUser: optionalString(64).optional(),
    /** Se enviado, substitui a senha; se ausente, mantém. */
    sshPassword: optionalString(255).optional(),
    enableSecret: optionalString(255).optional(),
    apiEndpoint: optionalString(255).optional(),
    apiAuthType: z.enum(['OAUTH2', 'API_KEY', 'MTLS']).nullish().optional(),
    apiCredentials: z.record(z.string(), z.unknown()).nullish().optional(),
    apiWebhookSecret: optionalString(128).optional(),
    serviceVlanId: z.coerce.number().int().min(1).max(4094).nullish().optional(),
    defaultUpProfile: optionalString(64).optional(),
    defaultDownProfile: optionalString(64).optional(),
  })
  .strict();
export type UpdateOltRequest = z.infer<typeof UpdateOltRequestSchema>;

export const ListOltsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  vendor: OltVendorSchema.optional(),
  status: OltStatusSchema.optional(),
  search: z.string().max(120).optional(),
});
export type ListOltsQuery = z.infer<typeof ListOltsQuerySchema>;

/**
 * Response — campos sensíveis NUNCA aqui. Em vez de senha, expõe boolean
 * `hasSshPassword` / `hasApiCredentials` pra UI mostrar "configurada / não
 * configurada".
 */
export interface OltResponse {
  id: string;
  tenantId: string;
  name: string;
  vendor: OltVendor;
  model: string;
  providerMode: OltProviderMode;
  managementIp: string | null;
  sshPort: number;
  sshUser: string | null;
  hasSshPassword: boolean;
  hasEnableSecret: boolean;
  apiEndpoint: string | null;
  apiAuthType: 'OAUTH2' | 'API_KEY' | 'MTLS' | null;
  hasApiCredentials: boolean;
  hasApiWebhookSecret: boolean;
  serviceVlanId: number | null;
  defaultUpProfile: string | null;
  defaultDownProfile: string | null;
  status: OltStatus;
  lastSeenAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
