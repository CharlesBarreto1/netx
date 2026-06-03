/**
 * DTOs da integração com a Ufinet (rede neutra PY, API TM Forum assíncrona).
 *
 * Aqui ficam SÓ os contratos NetX↔front (config da OLT, status do serviço pra
 * UI, ações). Os payloads/respostas TMF crus são internos ao core-service
 * (modules/ufinet/ufinet.types.ts) — não vazam pro frontend.
 *
 * Decisões da operação (ver AGENTS.md / task #29):
 *   - 1 polígono Ufinet = 1 OLT no NetX (providerMode=ORCHESTRATOR, vendor=UFINET).
 *   - externalId = LABEL_DROP = `ZUX-{code do contrato}` (gerado pelo NetX).
 *   - Caso A: todo cliente é "ZUX 1G" na Ufinet; banda/QoS real vem do RADIUS.
 */
import { z } from 'zod';

// -----------------------------------------------------------------------------
// Lifecycle (espelha enum Prisma UfinetLifecycle — manter sincronizado)
// -----------------------------------------------------------------------------
export const UFINET_LIFECYCLES = [
  'PENDING_PROVIDE',
  'PROVIDING',
  'RESERVED',
  'CONFIRMING_ONT',
  'CONFIRMING_SERVICE',
  'ACTIVE',
  'SUSPENDING',
  'SUSPENDED',
  'REACTIVATING',
  'SWAPPING_ONT',
  'CEASING',
  'CEASED',
  'CANCELLING',
  'CANCELLED',
  'FAILED',
] as const;
export const UfinetLifecycleSchema = z.enum(UFINET_LIFECYCLES);
export type UfinetLifecycle = z.infer<typeof UfinetLifecycleSchema>;

/** Estados de lifecycle que o poller (cron) ainda precisa avançar. */
export const UFINET_TRANSIENT_LIFECYCLES = [
  'PENDING_PROVIDE',
  'PROVIDING',
  'CONFIRMING_ONT',
  'CONFIRMING_SERVICE',
  'SUSPENDING',
  'REACTIVATING',
  'SWAPPING_ONT',
  'CEASING',
  'CANCELLING',
] as const satisfies readonly UfinetLifecycle[];

// -----------------------------------------------------------------------------
// Config da OLT-orquestradora (vai cifrada em parte; ver split abaixo)
// -----------------------------------------------------------------------------
/**
 * Segredos — gravados em `Olt.apiCredentialsEnc` (AES-256-GCM). NUNCA voltam
 * em response.
 */
export const UfinetCredentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  /** Header `Access` da APIM (chave estática por operador). */
  accessKey: z.string().min(1),
});
export type UfinetCredentials = z.infer<typeof UfinetCredentialsSchema>;

/**
 * Config NÃO-secreta — gravada em `Olt.apiConfig` (JSON plano). Pode voltar em
 * response (útil pra UI). Cada polígono Ufinet vira uma OLT, então o
 * `polygonAlias` mora aqui.
 */
export const UfinetOltConfigSchema = z.object({
  /** Operador no multiop (ex. "ZUX_PY"). */
  operator: z.string().min(1).max(64),
  /** Código de região (ex. "MQN-PY"). */
  region: z.string().min(1).max(64),
  /** contractId TMF do operador (ex. "FTTH_ZUX_PY") — NÃO é o contrato NetX. */
  contractId: z.string().min(1).max(64),
  /** Alias do polígono atendido por esta OLT (ex. "JLMPY-MALLORQUIN"). */
  polygonAlias: z.string().max(120).nullish(),
  /** Usuário API (username nos payloads + relatedParty). */
  userName: z.string().min(1).max(160),
  country: z.string().max(64).default('Paraguay'),
  city: z.string().max(120).nullish(),
  /** NMS da ONT (ex. "HUAWEI-NCE") + seu id no catálogo. */
  nms: z.string().max(64).default('HUAWEI-NCE'),
  nmsId: z.string().max(16).default('2'),
  /** Perfil de banda Ufinet — Caso A: fixo "ZUX 1G" pra todos. */
  bandwidthProfile: z.string().max(64).default('ZUX 1G'),
  bandwidthProfileId: z.string().max(16).default('499'),
  /** Scope OAuth (distingue qa/prod). */
  scope: z.string().min(1).max(255),
  /** Endpoint de token OAuth (tenant Microsoft). */
  tokenUrl: z.string().url(),
  /**
   * Prefixo do externalId/marquilla drop. O NetX gera sequencial por tenant:
   * `{prefixo}-{n}` → "ZUX-1", "ZUX-2", … (curto e legível pro técnico em campo).
   */
  externalIdPrefix: z.string().min(1).max(16).default('ZUX'),
  /**
   * Alta enxuta: quando true, o payload de ALTA (provide) NÃO envia dados
   * pessoais — omite CONTACT_NAME, CONTACT_PHONE e a geometria (lat/long) do
   * endereço. Mantém só o necessário pra Ufinet: externalId, region, operator,
   * BANDWIDTH_PROFILE, polygonAlias (+ NMS) — e CTO_PORT/LABEL_DROP na
   * confirmação. Por-OLT, pra atender operação que não quer compartilhar PII.
   */
  minimalProvidePayload: z.boolean().default(false),
});
export type UfinetOltConfig = z.infer<typeof UfinetOltConfigSchema>;

/** Uma linha do trace de request/response NetX↔Ufinet (evidência/auditoria). */
export interface UfinetTraceEntry {
  id: string;
  method: string;
  path: string;
  status: number | null;
  durationMs: number;
  requestBody: unknown;
  responseBody: unknown;
  error: string | null;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Status do serviço Ufinet de um contrato (read-only pra UI / Hub do Atendente)
// -----------------------------------------------------------------------------
export interface UfinetServiceResponse {
  id: string;
  contractId: string;
  oltId: string;
  oltName: string | null;
  externalId: string;
  labelDrop: string;
  bandwidthProfile: string;
  lifecycle: UfinetLifecycle;
  /** Identificadores do lado Ufinet (null até o passo correspondente rodar). */
  ufinetContractId: string | null;
  serviceOrderId: string | null;
  parentServiceId: string | null;
  resPonAccessServiceId: string | null;
  /** Caixa (CTO) enviada à Ufinet. */
  ctoPort: string | null;
  /** Porta do drop (1..16) — controle interno do NetX, não vai pra Ufinet. */
  dropPort: string | null;
  serialNumber: string | null;
  /** Última leitura de níveis ópticos (STATUS_ONT) — exibida sempre no contrato. */
  lastSignalLevels: Array<{ name: string; value: string }> | null;
  lastSignalAt: string | null;
  /** Operação em voo / diagnóstico. */
  ufinetState: string | null;
  waitingCode: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Ações do controller próprio do NetX
// -----------------------------------------------------------------------------
export const ListUfinetServicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  lifecycle: UfinetLifecycleSchema.optional(),
  oltId: z.string().uuid().optional(),
  search: z.string().max(120).optional(),
});
export type ListUfinetServicesQuery = z.infer<typeof ListUfinetServicesQuerySchema>;

/**
 * Reprocessa um serviço FAILED (ou força um novo poll). `resetAttempts` zera o
 * backoff pra tentar imediatamente.
 */
export const RetryUfinetServiceRequestSchema = z
  .object({
    resetAttempts: z.coerce.boolean().default(true),
  })
  .strict();
export type RetryUfinetServiceRequest = z.infer<typeof RetryUfinetServiceRequestSchema>;
