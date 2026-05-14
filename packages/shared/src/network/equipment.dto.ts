/**
 * @netx/shared/network — DTOs de NetworkEquipment (multi-vendor disconnect).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Cobertura: cadastro de NAS/BNG/OLT, credenciais multi-vendor (CoA via
 * RADIUS, RouterOS API, SSH genérico), e response do botão "Testar conexão".
 *
 * IMPORTANTE: passwords (`apiPassword`, `sshPassword`) trafegam em plaintext
 * no input; o backend cifra com AES-256-GCM antes de persistir. Nunca são
 * retornados em GET — em vez disso o response tem `hasApiPassword` /
 * `hasSshPassword` booleans pra UI mostrar "•••• preenchido".
 */
import { z } from 'zod';

// =============================================================================
// Enums (espelham Prisma)
// =============================================================================
export const NetworkEquipmentTypeSchema = z.enum([
  'BNG',
  'OLT',
  'ROUTER',
  'SWITCH',
  'OTHER',
]);
export type NetworkEquipmentType = z.infer<typeof NetworkEquipmentTypeSchema>;

export const NetworkEquipmentVendorSchema = z.enum([
  'MIKROTIK',
  'HUAWEI',
  'ZTE',
  'FIBERHOME',
  'CISCO',
  'JUNIPER',
  'OTHER',
]);
export type NetworkEquipmentVendor = z.infer<
  typeof NetworkEquipmentVendorSchema
>;

/**
 * Estratégia de disconnect:
 *   - AUTO: backend escolhe baseado em vendor+authType do contrato
 *   - COA: força RADIUS Disconnect (3799)
 *   - MIKROTIK_API: força RouterOS API (8728/8729)
 *   - SSH: força execução de sshDisconnectCmd
 */
export const DisconnectStrategySchema = z.enum([
  'AUTO',
  'COA',
  'MIKROTIK_API',
  'SSH',
]);
export type DisconnectStrategy = z.infer<typeof DisconnectStrategySchema>;

// =============================================================================
// Validators auxiliares
// =============================================================================
const ipOrHostnameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[a-zA-Z0-9.\-_]+$/,
    'IP ou hostname válido (sem espaços ou caracteres especiais)',
  );

const portSchema = z.coerce.number().int().min(1).max(65535);

const optionalNullableString = (max = 255) =>
  z.string().max(max).nullish().transform((v) => (v === '' ? null : v));

// =============================================================================
// Create (POST /v1/network/equipment)
// =============================================================================
export const CreateNetworkEquipmentRequestSchema = z.object({
  popId: z.string().uuid().nullish(),
  type: NetworkEquipmentTypeSchema,
  vendor: NetworkEquipmentVendorSchema.default('OTHER'),
  name: z.string().min(1).max(120),
  hostname: optionalNullableString(255),
  ipAddress: ipOrHostnameSchema,

  // RADIUS — obrigatório se type=BNG (validado no backend)
  radiusSecret: z.string().min(4).max(64).nullish(),
  radiusNasType: z.string().max(30).nullish(),

  // SNMP
  snmpCommunity: optionalNullableString(64),
  snmpVersion: optionalNullableString(10),

  // Disconnect multi-vendor
  disconnectStrategy: DisconnectStrategySchema.default('AUTO'),
  coaPort: portSchema.nullish(),

  // RouterOS API
  apiHost: optionalNullableString(255),
  apiPort: portSchema.nullish(),
  apiUser: optionalNullableString(64),
  apiPassword: optionalNullableString(255), // plaintext — backend cifra
  apiTlsEnabled: z.coerce.boolean().default(false),

  // SSH (fallback ou override)
  sshHost: optionalNullableString(255),
  sshPort: portSchema.nullish(),
  sshUser: optionalNullableString(64),
  sshPassword: optionalNullableString(255),
  sshKeyName: optionalNullableString(128),
  sshDisconnectCmd: optionalNullableString(2000),

  notes: optionalNullableString(2000),
  isActive: z.coerce.boolean().default(true),
});
export type CreateNetworkEquipmentRequest = z.infer<
  typeof CreateNetworkEquipmentRequestSchema
>;

// =============================================================================
// Update (PATCH /v1/network/equipment/:id)
// =============================================================================
/** Todos os campos opcionais — só atualiza o que vier. */
export const UpdateNetworkEquipmentRequestSchema =
  CreateNetworkEquipmentRequestSchema.partial();
export type UpdateNetworkEquipmentRequest = z.infer<
  typeof UpdateNetworkEquipmentRequestSchema
>;

// =============================================================================
// Response (GET /v1/network/equipment, GET /:id)
// =============================================================================
/**
 * Response sanitizado: passwords cifrados NUNCA voltam.
 * UI usa `hasApiPassword` / `hasSshPassword` pra exibir "•••• preenchido".
 */
export const NetworkEquipmentResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  popId: z.string().uuid().nullable(),
  type: NetworkEquipmentTypeSchema,
  vendor: NetworkEquipmentVendorSchema,
  name: z.string(),
  hostname: z.string().nullable(),
  ipAddress: z.string(),

  radiusSecret: z.string().nullable(),
  radiusNasType: z.string().nullable(),

  snmpCommunity: z.string().nullable(),
  snmpVersion: z.string().nullable(),

  disconnectStrategy: DisconnectStrategySchema,
  coaPort: z.number().int().nullable(),

  apiHost: z.string().nullable(),
  apiPort: z.number().int().nullable(),
  apiUser: z.string().nullable(),
  apiTlsEnabled: z.boolean(),
  hasApiPassword: z.boolean(),

  sshHost: z.string().nullable(),
  sshPort: z.number().int().nullable(),
  sshUser: z.string().nullable(),
  sshKeyName: z.string().nullable(),
  sshDisconnectCmd: z.string().nullable(),
  hasSshPassword: z.boolean(),

  lastReachableAt: z.string().datetime().nullable(),
  lastReachError: z.string().nullable(),

  notes: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type NetworkEquipmentResponse = z.infer<
  typeof NetworkEquipmentResponseSchema
>;

// =============================================================================
// Test Connection (POST /v1/network/equipment/:id/test-connection)
// =============================================================================
/** Resultado por strategy testada. */
export const TestConnectionStrategyResultSchema = z.object({
  strategy: z.enum(['COA', 'MIKROTIK_API', 'SSH']),
  ok: z.boolean(),
  message: z.string().optional(),
});
export type TestConnectionStrategyResult = z.infer<
  typeof TestConnectionStrategyResultSchema
>;

export const TestConnectionResponseSchema = z.object({
  equipmentId: z.string().uuid(),
  name: z.string(),
  results: z.array(TestConnectionStrategyResultSchema),
});
export type TestConnectionResponse = z.infer<
  typeof TestConnectionResponseSchema
>;
