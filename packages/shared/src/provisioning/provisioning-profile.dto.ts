/**
 * DTOs pra CRUD de templates de provisionamento de OLT (Fase 2 — Zyxel ZyNOS).
 *
 * O template é estruturado: perfis de banda por NOME (que já existem na OLT) +
 * lista de VLANs com papel (dados/gerência) + protocolo. O driver renderiza o
 * bloco CLI a partir disso. Resolução na hora de autorizar:
 *   Plan.provisioningProfile ?? Olt.defaultProvisioningProfile.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { z } from 'zod';
import {
  OltVendorSchema,
  ProfileVlanRoleSchema,
  ServiceProtocolSchema,
  type OltVendor,
  type ProfileVlanRole,
  type ServiceProtocol,
} from './types';

const profileName = /^[A-Za-z0-9_.-]{1,64}$/;
const bwName = z
  .string()
  .min(1)
  .max(64)
  .regex(profileName, 'Nome de perfil de banda inválido (use letras, dígitos, _ . -)');

export const ProfileVlanInputSchema = z.object({
  vid: z.coerce.number().int().min(1).max(4094),
  role: ProfileVlanRoleSchema.default('DATA'),
  /** txtag tag (true) | untag (false). */
  tagged: z.boolean().default(true),
  /** pvid do uniport aponta pra esta VLAN (no máximo uma). */
  isPvid: z.boolean().default(false),
  /** gera `protocol-based <proto> vlan <vid>` (no máximo uma). */
  isProtocolBased: z.boolean().default(false),
  order: z.coerce.number().int().min(0).default(0),
});
export type ProfileVlanInput = z.infer<typeof ProfileVlanInputSchema>;

const baseProfileShape = {
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish().transform((v) => (v === '' ? null : v ?? null)),
  vendor: OltVendorSchema.default('ZYXEL'),
  ontPassword: z.string().min(1).max(64).default('DEFAULT'),
  fullBridge: z.boolean().default(false),
  bwUpProfileName: bwName,
  bwDownProfileName: bwName,
  bwGroupId: z.coerce.number().int().min(1).max(64).default(1),
  uniPort: z
    .string()
    .regex(/^[0-9]+-[0-9]+$/, 'uniPort deve ser "porta-serviço", ex "2-1"')
    .default('2-1'),
  serviceProtocol: ServiceProtocolSchema.default('PPPOE'),
  queueTc: z.coerce.number().int().min(0).max(7).default(1),
  queuePriority: z.coerce.number().int().min(0).max(7).default(0),
  queueWeight: z.coerce.number().int().min(0).max(127).default(0),
  ingressProfile: z.string().min(1).max(64).default('DEFVAL'),
  vlans: z.array(ProfileVlanInputSchema).min(1, 'Adicione ao menos 1 VLAN'),
};

/** Regras de coerência das VLANs reutilizadas em create/update. */
function refineVlans(
  vlans: ProfileVlanInput[] | undefined,
  ctx: z.RefinementCtx,
): void {
  if (!vlans) return;
  if (vlans.filter((v) => v.isPvid).length > 1) {
    ctx.addIssue({ code: 'custom', path: ['vlans'], message: 'No máximo 1 VLAN pode ser PVID' });
  }
  if (vlans.filter((v) => v.isProtocolBased).length > 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['vlans'],
      message: 'No máximo 1 VLAN pode ser protocol-based',
    });
  }
  const vids = vlans.map((v) => v.vid);
  if (new Set(vids).size !== vids.length) {
    ctx.addIssue({ code: 'custom', path: ['vlans'], message: 'VLANs (vid) duplicadas' });
  }
}

export const CreateProvisioningProfileRequestSchema = z
  .object(baseProfileShape)
  .superRefine((data, ctx) => refineVlans(data.vlans, ctx));
export type CreateProvisioningProfileRequest = z.infer<
  typeof CreateProvisioningProfileRequestSchema
>;

export const UpdateProvisioningProfileRequestSchema = z
  .object({
    name: baseProfileShape.name.optional(),
    description: baseProfileShape.description.optional(),
    vendor: OltVendorSchema.optional(),
    ontPassword: z.string().min(1).max(64).optional(),
    fullBridge: z.boolean().optional(),
    bwUpProfileName: bwName.optional(),
    bwDownProfileName: bwName.optional(),
    bwGroupId: z.coerce.number().int().min(1).max(64).optional(),
    uniPort: baseProfileShape.uniPort.optional(),
    serviceProtocol: ServiceProtocolSchema.optional(),
    queueTc: z.coerce.number().int().min(0).max(7).optional(),
    queuePriority: z.coerce.number().int().min(0).max(7).optional(),
    queueWeight: z.coerce.number().int().min(0).max(127).optional(),
    ingressProfile: z.string().min(1).max(64).optional(),
    /** Se enviado, SUBSTITUI a lista inteira de VLANs (replace total). */
    vlans: z.array(ProfileVlanInputSchema).min(1).optional(),
  })
  .strict()
  .superRefine((data, ctx) => refineVlans(data.vlans, ctx));
export type UpdateProvisioningProfileRequest = z.infer<
  typeof UpdateProvisioningProfileRequestSchema
>;

export const ListProvisioningProfilesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  vendor: OltVendorSchema.optional(),
  search: z.string().max(120).optional(),
});
export type ListProvisioningProfilesQuery = z.infer<
  typeof ListProvisioningProfilesQuerySchema
>;

export interface ProfileVlanResponse {
  id: string;
  vid: number;
  role: ProfileVlanRole;
  tagged: boolean;
  isPvid: boolean;
  isProtocolBased: boolean;
  order: number;
}

export interface ProvisioningProfileResponse {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  vendor: OltVendor;
  ontPassword: string;
  fullBridge: boolean;
  bwUpProfileName: string;
  bwDownProfileName: string;
  bwGroupId: number;
  uniPort: string;
  serviceProtocol: ServiceProtocol;
  queueTc: number;
  queuePriority: number;
  queueWeight: number;
  ingressProfile: string;
  vlans: ProfileVlanResponse[];
  /** Quantas OLTs usam este template como default. */
  defaultForOltsCount?: number;
  /** Quantos planos apontam pra este template. */
  plansCount?: number;
  createdAt: string;
  updatedAt: string;
}
