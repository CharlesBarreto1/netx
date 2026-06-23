import { z } from 'zod';

import { InstallCustomerRequestSchema } from '../provisioning/install.dto';
import { type ServiceOrderReasonKind } from './service-order-reason.dto';

/**
 * Status persistido no DB. `OVERDUE` NÃO é persistido — é um status derivado
 * computado no momento do read quando `scheduledAt < now AND status ∈
 * {OPEN, SCHEDULED}`. Por isso o enum aqui só tem 5 valores; `displayStatus`
 * na resposta pode adicionar OVERDUE.
 */
export const ServiceOrderStatusSchema = z.enum([
  'OPEN',
  'SCHEDULED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);
export type ServiceOrderStatus = z.infer<typeof ServiceOrderStatusSchema>;

/** Status visual exposto pro frontend (inclui OVERDUE derivado). */
export const ServiceOrderDisplayStatusSchema = z.enum([
  'OPEN',
  'SCHEDULED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'OVERDUE',
  'COMPLETED',
  'CANCELLED',
]);
export type ServiceOrderDisplayStatus = z.infer<
  typeof ServiceOrderDisplayStatusSchema
>;

// =============================================================================
// CREATE
// =============================================================================
export const CreateServiceOrderRequestSchema = z.object({
  contractId: z.string().uuid(),
  reasonId: z.string().uuid(),
  /** Código humano opcional. Se vazio, gerado pelo service (OS-000123). */
  code: z.string().max(32).optional(),
  /** ISO 8601. Se vazio, OS nasce sem agendamento (status OPEN). */
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
  openDescription: z.string().min(1).max(10_000),
  /** Cidade/estado denormalizados — se vazios, o backend tenta puxar do
   *  endereço primário do customer do contrato. */
  city: z.string().max(120).nullish(),
  state: z.string().max(120).nullish(),
  /** UUID do user atribuído (técnico). Opcional. */
  assignedToId: z.string().uuid().nullish(),
});
export type CreateServiceOrderRequest = z.infer<
  typeof CreateServiceOrderRequestSchema
>;

// =============================================================================
// UPDATE (campos editáveis a qualquer momento; transições de status têm rotas
// próprias /start /complete /cancel)
// =============================================================================
export const UpdateServiceOrderRequestSchema = z.object({
  reasonId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
  openDescription: z.string().min(1).max(10_000).optional(),
  closeDescription: z.string().max(10_000).nullish(),
  city: z.string().max(120).nullish(),
  state: z.string().max(120).nullish(),
  assignedToId: z.string().uuid().nullish(),
});
export type UpdateServiceOrderRequest = z.infer<
  typeof UpdateServiceOrderRequestSchema
>;

// =============================================================================
// TRANSIÇÕES DE STATUS
// =============================================================================
/** Marca como IN_PROGRESS. Setamos startedAt. */
export const StartServiceOrderRequestSchema = z.object({
  startedAt: z.string().datetime({ offset: true }).optional(),
});
export type StartServiceOrderRequest = z.infer<
  typeof StartServiceOrderRequestSchema
>;

/**
 * Marca como COMPLETED. closeDescription obrigatória — é o que vai pro
 * histórico do cliente.
 */
export const CompleteServiceOrderRequestSchema = z.object({
  closeDescription: z.string().min(1).max(10_000),
  completedAt: z.string().datetime({ offset: true }).optional(),
});
export type CompleteServiceOrderRequest = z.infer<
  typeof CompleteServiceOrderRequestSchema
>;

export const CancelServiceOrderRequestSchema = z.object({
  /** Motivo do cancelamento (opcional, vai pra audit log). */
  reason: z.string().max(500).optional(),
});
export type CancelServiceOrderRequest = z.infer<
  typeof CancelServiceOrderRequestSchema
>;

/**
 * Volta a O.S pra fila — aborta o deslocamento (EN_ROUTE) ou a execução
 * (IN_PROGRESS) SEM cancelar/fechar a O.S. Status volta pra SCHEDULED (se tinha
 * agendamento) ou OPEN. Motivo é obrigatório e fica no histórico (thread).
 */
export const ReturnToQueueRequestSchema = z.object({
  reason: z.string().min(1).max(1000),
});
export type ReturnToQueueRequest = z.infer<typeof ReturnToQueueRequestSchema>;

/** Técnico inicia deslocamento → status EN_ROUTE (a caminho). */
export const EnRouteServiceOrderRequestSchema = z.object({
  enRouteAt: z.string().datetime({ offset: true }).optional(),
});
export type EnRouteServiceOrderRequest = z.infer<
  typeof EnRouteServiceOrderRequestSchema
>;

/** Check-in ao chegar → status IN_PROGRESS (seta checkinAt + startedAt). */
export const CheckinServiceOrderRequestSchema = z.object({
  checkinAt: z.string().datetime({ offset: true }).optional(),
});
export type CheckinServiceOrderRequest = z.infer<
  typeof CheckinServiceOrderRequestSchema
>;

// =============================================================================
// FOTOS DE CAMPO (comprovação) — upload via MinIO presigned
// =============================================================================
/** Pede uma URL assinada de upload pro MinIO (técnico sobe direto). */
export const ServiceOrderPhotoPresignRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().max(120).optional(),
});
export type ServiceOrderPhotoPresignRequest = z.infer<
  typeof ServiceOrderPhotoPresignRequestSchema
>;

export interface ServiceOrderPhotoPresignResponse {
  uploadUrl: string;
  /** Key a devolver no confirm/complete pra persistir a referência. */
  storageKey: string;
  expiresIn: number;
}

/** Metadado de uma foto já enviada (key existente no bucket). */
export const ServiceOrderPhotoInputSchema = z.object({
  storageKey: z.string().min(1).max(512),
  contentType: z.string().max(120).nullish(),
  sizeBytes: z.coerce.number().int().nonnegative().nullish(),
  caption: z.string().max(255).nullish(),
});
export type ServiceOrderPhotoInput = z.infer<
  typeof ServiceOrderPhotoInputSchema
>;

export interface ServiceOrderPhotoResponse {
  id: string;
  storageKey: string;
  contentType: string | null;
  caption: string | null;
  createdAt: string;
  /** URL assinada de download (preenchida on-demand pelo backend). */
  url?: string;
}

// =============================================================================
// MENSAGENS — thread atendente ↔ técnico (histórico da O.S)
// =============================================================================
export const CreateServiceOrderMessageRequestSchema = z.object({
  body: z.string().min(1).max(5000),
});
export type CreateServiceOrderMessageRequest = z.infer<
  typeof CreateServiceOrderMessageRequestSchema
>;

export interface ServiceOrderMessageResponse {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string } | null;
}

// =============================================================================
// ANEXOS — arquivos avulsos (a qualquer momento), distintos das fotos de campo
// =============================================================================
/** Pede URL assinada de upload pro MinIO. */
export const ServiceOrderAttachmentPresignRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().max(120).optional(),
});
export type ServiceOrderAttachmentPresignRequest = z.infer<
  typeof ServiceOrderAttachmentPresignRequestSchema
>;

export interface ServiceOrderAttachmentPresignResponse {
  uploadUrl: string;
  storageKey: string;
  expiresIn: number;
}

/** Registra o anexo já enviado ao bucket (key + metadados). */
export const RegisterServiceOrderAttachmentRequestSchema = z.object({
  storageKey: z.string().min(1).max(512),
  fileName: z.string().min(1).max(255),
  contentType: z.string().max(120).nullish(),
  sizeBytes: z.coerce.number().int().nonnegative().nullish(),
});
export type RegisterServiceOrderAttachmentRequest = z.infer<
  typeof RegisterServiceOrderAttachmentRequestSchema
>;

export interface ServiceOrderAttachmentResponse {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  /** URL assinada de download (preenchida on-demand pelo backend). */
  url?: string;
}

// =============================================================================
// ONE-TOUCH — finalizar instalação em campo numa tacada só
// =============================================================================
/** Material consumível usado na instalação (vai pro estoque via OS_CONSUMPTION). */
export const FieldMaterialSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  notes: z.string().max(255).nullish(),
});
export type FieldMaterial = z.infer<typeof FieldMaterialSchema>;

/**
 * Payload da finalização em campo (tela /os). O backend "splita" cada parte:
 *   1. Provisiona + ativa contrato + RADIUS + TR-069 (via ProvisioningService)
 *   2. Movimenta estoque: ONT em comodato (no install) + materiais consumidos
 *   3. Vincula caixa/porta (Ufinet CTO/porta OU CTO óptica cadastrada)
 *   4. Anexa fotos + closeDescription e fecha a O.S
 *
 * `install` reusa o mesmo contrato do /provisioning/install. `enclosureId`/
 * `enclosurePort` são pro caso de OLT própria (CTO cadastrada); pra Ufinet, o
 * caixa/porta vão dentro de `install.ufinetCto`/`install.ufinetPort`.
 */
export const CompleteInstallationRequestSchema = z.object({
  /** Dados de provisionamento (mesmo shape do /provisioning/install). */
  install: InstallCustomerRequestSchema,
  /** CTO óptica cadastrada (OLT própria) — opcional. */
  enclosureId: z.string().uuid().nullish(),
  enclosurePort: z.string().max(32).nullish(),
  /** Materiais consumíveis usados (cabo, conector, fusão…). */
  materials: z.array(FieldMaterialSchema).max(100).default([]),
  /** Fotos já enviadas ao MinIO (keys). */
  photos: z.array(ServiceOrderPhotoInputSchema).max(30).default([]),
  /** Relato de fechamento da O.S (obrigatório). */
  closeDescription: z.string().min(1).max(10_000),
  completedAt: z.string().datetime({ offset: true }).optional(),
});
export type CompleteInstallationRequest = z.infer<
  typeof CompleteInstallationRequestSchema
>;

// =============================================================================
// FINALIZAÇÃO DE CAMPO ramificada por tipo de O.S (instalação / suporte /
// retirada) — a tela /os monta `mode` a partir de reason.kind + "trocou ONT?".
// =============================================================================
const fieldCommon = {
  photos: z.array(ServiceOrderPhotoInputSchema).max(30).default([]),
  closeDescription: z.string().min(1).max(10_000),
  completedAt: z.string().datetime({ offset: true }).optional(),
};

/** Dados da troca de ONT (suporte com troca). */
export const OntSwapSchema = z.object({
  newSerialItemId: z.string().uuid().nullish(),
  newSnGpon: z.string().max(64).nullish(),
  allowStockBypass: z.boolean().default(false),
  returnLocationId: z.string().uuid(),
  // Wi-Fi OPCIONAL: a troca mantém o mesmo nome/senha do contrato. O service
  // herda do contrato; estes campos só sobrescrevem se enviados (legado).
  ssid: z.string().min(1).max(32).nullish(),
  wifiPassword: z.string().min(8).max(63).nullish(),
  wifiBandMode: z.enum(['BAND_STEERING', 'DUAL_BAND']).default('BAND_STEERING'),
});
export type OntSwap = z.infer<typeof OntSwapSchema>;

export const CompleteFieldRequestSchema = z.discriminatedUnion('mode', [
  // INSTALLATION — provisiona tudo (one-touch).
  z.object({
    mode: z.literal('INSTALLATION'),
    install: InstallCustomerRequestSchema,
    enclosureId: z.string().uuid().nullish(),
    enclosurePort: z.string().max(32).nullish(),
    materials: z.array(FieldMaterialSchema).max(100).default([]),
    ...fieldCommon,
  }),
  // SUPPORT — atendimento SEM troca de ONT (não mexe no provisionamento).
  z.object({
    mode: z.literal('SUPPORT'),
    materials: z.array(FieldMaterialSchema).max(100).default([]),
    ...fieldCommon,
  }),
  // SUPPORT_SWAP — atendimento COM troca de ONT.
  z.object({
    mode: z.literal('SUPPORT_SWAP'),
    swap: OntSwapSchema,
    materials: z.array(FieldMaterialSchema).max(100).default([]),
    ...fieldCommon,
  }),
  // RETRIEVAL — recolhe equipamento + desprovisiona + encerra contrato.
  z.object({
    mode: z.literal('RETRIEVAL'),
    returnLocationId: z.string().uuid(),
    cancelReason: z.string().max(500).optional(),
    ...fieldCommon,
  }),
]);
export type CompleteFieldRequest = z.infer<typeof CompleteFieldRequestSchema>;

// =============================================================================
// LIST / FILTROS
// =============================================================================
export const ListServiceOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  contractId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  reasonId: z.string().uuid().optional(),
  /**
   * UUID de um user → filtra as O.S desse técnico.
   * `'unassigned'` (string literal) → filtra O.S sem técnico atribuído.
   * `undefined` → sem filtro.
   */
  assignedToId: z.union([z.string().uuid(), z.literal('unassigned')]).optional(),

  /**
   * Filtro por status. Aceita os status persistidos OU o derivado OVERDUE.
   * Quando OVERDUE, o backend faz: scheduledAt < now AND status ∈ {OPEN,
   * SCHEDULED}.
   */
  status: ServiceOrderDisplayStatusSchema.optional(),

  /** Cidade — filtro contains (case-insensitive). */
  city: z.string().max(120).optional(),

  /** Range do scheduledAt (ISO 8601). */
  scheduledFrom: z.string().datetime({ offset: true }).optional(),
  scheduledTo: z.string().datetime({ offset: true }).optional(),

  /** Busca livre (code / openDescription). */
  search: z.string().max(255).optional(),

  sortBy: z
    .enum(['scheduledAt', 'openedAt', 'createdAt', 'updatedAt'])
    .default('openedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListServiceOrdersQuery = z.infer<typeof ListServiceOrdersQuerySchema>;

// =============================================================================
// RESPONSE
// =============================================================================
export interface ServiceOrderResponse {
  id: string;
  tenantId: string;
  contractId: string;
  reasonId: string;
  code: string | null;

  /** Status persistido no banco. */
  status: ServiceOrderStatus;
  /**
   * Status para exibição (igual ao `status`, exceto quando vencido —
   * `displayStatus` vira OVERDUE pra UI mostrar em vermelho sem precisar
   * recomputar).
   */
  displayStatus: ServiceOrderDisplayStatus;

  openedAt: string;
  scheduledAt: string | null;
  enRouteAt: string | null;
  checkinAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /**
   * Etapa 1 do one-touch de instalação concluída: provisionado em campo,
   * aguardando o técnico confirmar online e fechar a O.S. Quando preenchido e
   * status != COMPLETED, a tela do técnico abre direto na confirmação.
   */
  fieldProvisionedAt: string | null;

  openDescription: string;
  closeDescription: string | null;

  city: string | null;
  state: string | null;

  assignedToId: string | null;

  createdAt: string;
  updatedAt: string;

  // Relations enxutos pra UI:
  reason?: { id: string; name: string; kind: ServiceOrderReasonKind } | null;
  contract?: {
    id: string;
    code: string | null;
    // null em contratos IPoE — autenticam via circuit-id/MAC.
    pppoeUsername: string | null;
    customerId: string;
    // Localização do contrato — usada pra navegação no app do técnico.
    installationAddress: string | null;
    installationMapsUrl: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  customer?: { id: string; displayName: string } | null;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
  /** Fotos de campo (preenchido no detalhe; URLs assinadas on-demand). */
  photos?: ServiceOrderPhotoResponse[];
}
