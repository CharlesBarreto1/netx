import { z } from 'zod';

/**
 * Schemas Zod do módulo IPAM (documentação de IPs) + CGNAT determinístico.
 * Validados via `@ZodBody(...)` no IpamController antes de chegar no service.
 *
 * IPv4 E IPv6 são aceitos em toda parte que recebe CIDR/IP — a validação fina
 * (formato do endereço, containment) roda no service via ip.util.ts, aqui só
 * garantimos o formato geral e limites de tamanho.
 */

const optionalNullableString = (max = 255) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v));

// Aceita "10.0.0.0/24" ou "2001:db8::/32" — checagem semântica no service.
const cidrString = z
  .string()
  .min(3)
  .max(49)
  .regex(/^[0-9a-fA-F:.]+\/\d{1,3}$/, 'CIDR inválido (esperado ip/prefixo)');

const ipString = z
  .string()
  .min(2)
  .max(45)
  .regex(/^[0-9a-fA-F:.]+$/, 'endereço IP inválido');

export const IpamPrefixRoleEnum = z.enum([
  'SUPERNET',
  'CUSTOMER',
  'CGNAT_POOL',
  'PUBLIC_POOL',
  'MANAGEMENT',
  'LOOPBACK',
  'P2P',
  'DHCP',
  'OTHER',
]);
export const IpamPrefixStatusEnum = z.enum(['ACTIVE', 'RESERVED', 'DEPRECATED']);
export const IpamAddressStatusEnum = z.enum(['FREE', 'USED', 'RESERVED', 'DHCP', 'DEPRECATED']);
export const IpamAddressKindEnum = z.enum(['CONTRACT', 'EQUIPMENT', 'CUSTOMER', 'GATEWAY', 'OTHER']);

// -----------------------------------------------------------------------------
// VRF
// -----------------------------------------------------------------------------
export const CreateIpamVrfRequestSchema = z.object({
  name: z.string().min(1).max(64),
  rd: optionalNullableString(32),
  description: optionalNullableString(2000),
  isDefault: z.coerce.boolean().default(false),
});
export type CreateIpamVrfRequest = z.infer<typeof CreateIpamVrfRequestSchema>;

export const UpdateIpamVrfRequestSchema = CreateIpamVrfRequestSchema.partial().extend({
  isDefault: CreateIpamVrfRequestSchema.shape.isDefault.removeDefault().optional(),
});
export type UpdateIpamVrfRequest = z.infer<typeof UpdateIpamVrfRequestSchema>;

// -----------------------------------------------------------------------------
// PREFIX
// -----------------------------------------------------------------------------
export const CreateIpamPrefixRequestSchema = z.object({
  cidr: cidrString,
  vrfId: z.string().uuid().nullish(),
  role: IpamPrefixRoleEnum.default('OTHER'),
  status: IpamPrefixStatusEnum.default('ACTIVE'),
  vlanId: z.coerce.number().int().min(1).max(4094).nullish(),
  gateway: ipString.nullish(),
  description: optionalNullableString(255),
  popId: z.string().uuid().nullish(),
  equipmentId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
});
export type CreateIpamPrefixRequest = z.infer<typeof CreateIpamPrefixRequestSchema>;

export const UpdateIpamPrefixRequestSchema = CreateIpamPrefixRequestSchema.partial().extend({
  role: IpamPrefixRoleEnum.optional(),
  status: IpamPrefixStatusEnum.optional(),
});
export type UpdateIpamPrefixRequest = z.infer<typeof UpdateIpamPrefixRequestSchema>;

/**
 * Divide um prefixo em subredes de tamanho fixo (ex.: um /22 em quatro /24).
 * O `maxCount` é uma trava: dividir um /8 em /30 daria 4 milhões de linhas.
 */
export const SplitIpamPrefixRequestSchema = z.object({
  prefixLen: z.coerce.number().int().min(0).max(128),
  role: IpamPrefixRoleEnum.default('OTHER'),
  status: IpamPrefixStatusEnum.default('ACTIVE'),
  description: optionalNullableString(255),
  maxCount: z.coerce.number().int().min(1).max(1024).default(256),
});
export type SplitIpamPrefixRequest = z.infer<typeof SplitIpamPrefixRequestSchema>;

// -----------------------------------------------------------------------------
// ADDRESS
// -----------------------------------------------------------------------------
export const CreateIpamAddressRequestSchema = z.object({
  address: ipString,
  // prefixId opcional — se ausente, o service acha o prefixo que contém o IP.
  prefixId: z.string().uuid().nullish(),
  status: IpamAddressStatusEnum.default('USED'),
  kind: IpamAddressKindEnum.nullish(),
  customerId: z.string().uuid().nullish(),
  contractId: z.string().uuid().nullish(),
  equipmentId: z.string().uuid().nullish(),
  macAddress: optionalNullableString(17),
  hostname: optionalNullableString(255),
  description: optionalNullableString(255),
  isGateway: z.coerce.boolean().default(false),
});
export type CreateIpamAddressRequest = z.infer<typeof CreateIpamAddressRequestSchema>;

export const UpdateIpamAddressRequestSchema = CreateIpamAddressRequestSchema.partial().extend({
  status: IpamAddressStatusEnum.optional(),
  isGateway: CreateIpamAddressRequestSchema.shape.isGateway.removeDefault().optional(),
});
export type UpdateIpamAddressRequest = z.infer<typeof UpdateIpamAddressRequestSchema>;

/** Reserva/atribui o próximo IP livre de um prefixo ou pool. */
export const AllocateNextRequestSchema = z
  .object({
    prefixId: z.string().uuid().nullish(),
    poolId: z.string().uuid().nullish(),
    contractId: z.string().uuid().nullish(),
    customerId: z.string().uuid().nullish(),
    equipmentId: z.string().uuid().nullish(),
    description: optionalNullableString(255),
  })
  .refine((v) => !!v.prefixId || !!v.poolId, {
    message: 'informe prefixId ou poolId',
  });
export type AllocateNextRequest = z.infer<typeof AllocateNextRequestSchema>;

// -----------------------------------------------------------------------------
// POOL
// -----------------------------------------------------------------------------
export const CreateIpamPoolRequestSchema = z.object({
  name: z.string().min(1).max(64),
  prefixId: z.string().uuid(),
  rangeStart: ipString,
  rangeEnd: ipString,
  description: optionalNullableString(255),
  isActive: z.coerce.boolean().default(true),
});
export type CreateIpamPoolRequest = z.infer<typeof CreateIpamPoolRequestSchema>;

export const UpdateIpamPoolRequestSchema = CreateIpamPoolRequestSchema.partial().extend({
  isActive: CreateIpamPoolRequestSchema.shape.isActive.removeDefault().optional(),
});
export type UpdateIpamPoolRequest = z.infer<typeof UpdateIpamPoolRequestSchema>;

// -----------------------------------------------------------------------------
// CGNAT PLAN
// -----------------------------------------------------------------------------
export const CreateIpamCgnatPlanRequestSchema = z.object({
  name: z.string().min(1).max(64),
  publicPrefixId: z.string().uuid(),
  cgnatPrefixId: z.string().uuid(),
  portsPerClient: z.coerce.number().int().min(1).max(65535).default(1000),
  portBase: z.coerce.number().int().min(0).max(65535).default(1024),
  maxPort: z.coerce.number().int().min(1).max(65535).default(65535),
  description: optionalNullableString(255),
});
export type CreateIpamCgnatPlanRequest = z.infer<typeof CreateIpamCgnatPlanRequestSchema>;

export const UpdateIpamCgnatPlanRequestSchema = CreateIpamCgnatPlanRequestSchema.partial();
export type UpdateIpamCgnatPlanRequest = z.infer<typeof UpdateIpamCgnatPlanRequestSchema>;

// -----------------------------------------------------------------------------
// BUSCA REVERSA (Marco Civil): IP público + porta (+ horário) → cliente
// -----------------------------------------------------------------------------
export const IpamLookupRequestSchema = z.object({
  ip: ipString,
  port: z.coerce.number().int().min(0).max(65535).nullish(),
  /** ISO datetime — cruza com sessão RADIUS ativa naquele instante. */
  at: z.string().datetime().nullish(),
});
export type IpamLookupRequest = z.infer<typeof IpamLookupRequestSchema>;

export const CgnatExportFormatEnum = z.enum(['csv', 'mikrotik']);
export type CgnatExportFormat = z.infer<typeof CgnatExportFormatEnum>;

// -----------------------------------------------------------------------------
// RECONCILIAÇÃO IPAM ↔ REDE REAL
// -----------------------------------------------------------------------------
/**
 * Varredura. As fontes locais (RADIUS/contrato/equipamento) rodam sempre — saem
 * do banco. `equipmentIds` é opt-in: só aí o servidor alcança o RouterOS pra ler
 * ARP e leases, então nada de rede acontece sem o operador pedir.
 */
export const ReconcileScanRequestSchema = z.object({
  equipmentIds: z.array(z.string().uuid()).max(50).optional(),
});
export type ReconcileScanRequest = z.infer<typeof ReconcileScanRequestSchema>;

/** Importa achados UNDOCUMENTED escolhidos, um a um. */
export const ImportIpamFindingsRequestSchema = z.object({
  items: z
    .array(
      z.object({
        ip: ipString,
        prefixId: z.string().uuid().nullish(),
        contractId: z.string().uuid().nullish(),
        customerId: z.string().uuid().nullish(),
        equipmentId: z.string().uuid().nullish(),
        macAddress: optionalNullableString(17),
        hostname: optionalNullableString(255),
        description: optionalNullableString(255),
      }),
    )
    .min(1)
    .max(500),
});
export type ImportIpamFindingsRequest = z.infer<typeof ImportIpamFindingsRequestSchema>;
