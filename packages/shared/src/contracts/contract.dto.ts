import { z } from 'zod';

import { SsidSchema, WifiPasswordSchema } from '../provisioning/types';

// -----------------------------------------------------------------------------
// Enums (espelho do schema.prisma)
// -----------------------------------------------------------------------------
export const ContractStatusSchema = z.enum([
  // Fase 1 ZTP: contrato criado pelo comercial mas ainda não foi
  // instalado/provisionado (técnico precisa visitar). Não aplica em RADIUS.
  'PENDING_INSTALL',
  'ACTIVE',
  'SUSPENDED',
  'CANCELLED',
]);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const ContractSuspendReasonSchema = z.enum([
  'MANUAL',
  'OVERDUE_PAYMENT',
  'OTHER',
]);
export type ContractSuspendReason = z.infer<typeof ContractSuspendReasonSchema>;

export const ContractAuthMethodSchema = z.enum(['PPPOE', 'IPOE']);
export type ContractAuthMethod = z.infer<typeof ContractAuthMethodSchema>;

// Modo de pagamento — POSTPAID = clássico (fatura mensal no dueDay, primeira
// pro-rata se ativou fora do dia); PREPAID = paga antes (1ª vence na ativação,
// ciclo ancorado em activatedAt). Default POSTPAID.
export const PaymentModeSchema = z.enum(['POSTPAID', 'PREPAID']);
export type PaymentMode = z.infer<typeof PaymentModeSchema>;

// -----------------------------------------------------------------------------
// Validators de campo
// -----------------------------------------------------------------------------
// MAC address — aceita formato AA:BB:CC:DD:EE:FF, AA-BB-..., aabbccddeeff,
// e normaliza pra UPPER + ":". O service consome o resultado deste schema
// (z.preprocess) — quem chama recebe a forma canônica.
const macAddressSchema = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    const cleaned = v.replace(/[^0-9A-Fa-f]/gu, '').toUpperCase();
    if (cleaned.length !== 12) return v;
    return cleaned.match(/.{2}/gu)!.join(':');
  },
  z
    .string()
    .regex(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/u, 'MAC inválido (esperado AA:BB:CC:DD:EE:FF)'),
);

// IP framed — aceita IPv4 e IPv6 textual. Validação leve.
const framedIpSchema = z.string().max(45).refine(
  (v) =>
    /^(\d{1,3}\.){3}\d{1,3}$/u.test(v) /* v4 */ ||
    /^[0-9a-fA-F:]+$/u.test(v) /* v6 simplificado */,
  'IP inválido',
);

// -----------------------------------------------------------------------------
// Create / Update
// -----------------------------------------------------------------------------
// Campos comuns (não dependem de PPPoE/IPoE).
const commonContractFields = {
  installationAddress: z.string().min(5).max(500),
  // Link de localização (Google Maps / OSM / Apple Maps). Validação leve:
  // só exige URL válida; aceitar qualquer host pra não amarrar a um provedor.
  installationMapsUrl: z.string().url().max(500).nullish(),
  // Plano de internet (opcional). Quando selecionado, o front preenche
  // monthlyValue/bandwidthMbps/uploadMbps a partir do plano. O operador pode
  // ajustar o monthlyValue (desconto/acréscimo) — o planId fica como
  // referência. Sem plano = valores 100% manuais.
  planId: z.string().uuid().nullish(),
  monthlyValue: z.coerce.number().positive().max(1_000_000),
  bandwidthMbps: z.coerce.number().int().min(1).max(100_000),   // download
  uploadMbps: z.coerce.number().int().min(1).max(100_000).nullish(),
  dueDay: z.coerce.number().int().min(1).max(28),
  // Modo de pagamento. Default POSTPAID = comportamento histórico.
  // PREPAID inverte o fluxo: 1ª fatura vence na ativação (vide
  // InvoiceGenerator), ciclo ancorado em activatedAt, sem dueDay efetivo.
  paymentMode: PaymentModeSchema.default('POSTPAID'),
  // Override per-contrato dos dias até o bloqueio por inadimplência.
  // null/undefined = usa Plan.blockAfterDays (fallback 5).
  blockAfterDays: z.coerce.number().int().min(0).max(60).nullish(),
  // Coordenadas pro módulo Mapeamento. Operador marca via LocationPicker
  // (UI) ou via PATCH direto. Nullable — contratos antigos ficam sem
  // pino até backfill. Faixas: lat -90..90, lng -180..180.
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  notes: z.string().max(10_000).nullish(),
  // Wi-Fi do cliente — capturado no CADASTRO (antes era só na instalação, pelo
  // técnico). O provisionamento (install/troca/O.S) lê daqui em vez de pedir ao
  // técnico. Opcional no schema (back-compat de API e contratos sem Wi-Fi), mas
  // o formulário web torna obrigatório. A senha é cifrada at-rest no service.
  ssid: SsidSchema.nullish(),
  wifiPassword: WifiPasswordSchema.nullish(),
};

// Bloco PPPoE.
// usuário/senha são OPCIONAIS no request: quando ausentes, o backend gera
//   - login: derivado do nome do cliente (vide pppoe-login.ts)
//   - senha: '1234' (padrão da operação — segurança real fica na camada
//            GPON/OLT, não na credencial PPPoE; decisão do admin 2026-05-22)
const pppoeFields = {
  authMethod: z.literal('PPPOE'),
  pppoeUsername: z
    .string()
    .min(3)
    .max(64)
    .regex(
      /^[A-Za-z0-9._-]+$/u,
      'pppoeUsername deve conter apenas letras, números, "." "_" "-"',
    )
    .optional(),
  // min(4) — senha curta é decisão consciente da operação (segurança na OLT).
  pppoePassword: z.string().min(4).max(128).optional(),
};

// Bloco IPoE — pelo menos circuitId OU macAddress quando ACTIVE. Refinado
// abaixo. Quando `initialStatus === 'PENDING_INSTALL'` a regra é relaxada
// (técnico em campo vai preencher SN/MAC via /provisioning/install).
const ipoeFields = {
  authMethod: z.literal('IPOE'),
  circuitId: z.string().min(1).max(128).nullish(),
  remoteId: z.string().max(128).nullish(),
  macAddress: macAddressSchema.nullish(),
  framedIpAddress: framedIpSchema.nullish(),
  vlanId: z.coerce.number().int().min(1).max(4094).nullish(),
};

// initialStatus: define se o contrato nasce PENDING_INSTALL (fluxo ZTP
// padrão — técnico instala em campo via /provisioning/install) ou ACTIVE
// (exceção — instalação já realizada antes do cadastro).
// Default PENDING_INSTALL: o caminho normal da operação é o contrato entrar
// na fila de instalações pendentes. Aplica-se a PPPoE e IPoE.
const initialStatusField = {
  initialStatus: z.enum(['ACTIVE', 'PENDING_INSTALL']).default('PENDING_INSTALL'),
};

// CreateContract: discriminated union pra que o backend não precise validar
// à mão a coerência entre authMethod e os campos de cada bloco.
//
// IMPORTANTE: cada branch tem que ser um `ZodObject` puro — `discriminatedUnion`
// do Zod v3 não aceita `ZodEffects` (o que `superRefine` produz). Por isso a
// regra "IPoE exige circuit OU mac" mora num `.superRefine` aplicado no
// resultado da union, não dentro de uma branch.
export const CreateContractRequestSchema = z
  .discriminatedUnion('authMethod', [
    z.object({
      customerId: z.string().uuid(),
      firstDueDate: z.string().date().optional(),
      ...commonContractFields,
      ...pppoeFields,
      ...initialStatusField,
    }),
    z.object({
      customerId: z.string().uuid(),
      firstDueDate: z.string().date().optional(),
      ...commonContractFields,
      ...ipoeFields,
      ...initialStatusField,
    }),
  ])
  .superRefine((data, ctx) => {
    // IPoE precisa de identificador (circuit/MAC) só quando vai entrar ACTIVE
    // direto. Em PENDING_INSTALL o técnico ainda vai vincular a ONT em campo.
    if (
      data.authMethod === 'IPOE' &&
      data.initialStatus === 'ACTIVE' &&
      !data.circuitId &&
      !data.macAddress
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Em IPoE ativo, informe pelo menos circuitId ou macAddress. ' +
          'Pra cadastrar sem identificador, use status "PENDING_INSTALL" e ' +
          'vincule depois via /provisioning/install.',
        path: ['circuitId'],
      });
    }
  });
export type CreateContractRequest = z.infer<typeof CreateContractRequestSchema>;

// Update: tudo opcional. Não usa discriminated union porque PATCH parcial
// pode não ter authMethod. O service valida coerência se authMethod vier.
export const UpdateContractRequestSchema = z
  .object({
    authMethod: ContractAuthMethodSchema.optional(),
    pppoeUsername: pppoeFields.pppoeUsername.optional(),
    pppoePassword: pppoeFields.pppoePassword.optional(),
    circuitId: ipoeFields.circuitId,
    remoteId: ipoeFields.remoteId,
    macAddress: ipoeFields.macAddress,
    framedIpAddress: ipoeFields.framedIpAddress,
    vlanId: ipoeFields.vlanId,
    ...commonContractFields,
    // Sobrescreve o `paymentMode: ...default('POSTPAID')` de commonContractFields.
    // Sem isso, o `.partial()` do Zod 4 AINDA aplica o default e injeta
    // 'POSTPAID' em todo PATCH — o que dispara o bloqueio de troca PREPAID↔POSTPAID
    // no service e quebra QUALQUER edição de contrato PREPAID. Aqui fica opcional
    // sem default (o service ainda bloqueia uma troca real, se enviada de fato).
    paymentMode: PaymentModeSchema.optional(),
  })
  .partial();
export type UpdateContractRequest = z.infer<typeof UpdateContractRequestSchema>;

// -----------------------------------------------------------------------------
// Transições de estado (acionadas pelo usuário)
// -----------------------------------------------------------------------------
export const SuspendContractRequestSchema = z.object({
  reason: ContractSuspendReasonSchema.default('MANUAL'),
  note: z.string().max(500).optional(),
});
export type SuspendContractRequest = z.infer<typeof SuspendContractRequestSchema>;

export const ReactivateContractRequestSchema = z.object({
  note: z.string().max(500).optional(),
});
export type ReactivateContractRequest = z.infer<typeof ReactivateContractRequestSchema>;

export const CancelContractRequestSchema = z.object({
  note: z.string().max(500).optional(),
});
export type CancelContractRequest = z.infer<typeof CancelContractRequestSchema>;

// Troca de plano com prorate. Endpoint dedicado porque o cálculo de
// crédito/débito é não-trivial (vide ContractsService.changePlan).
// PATCH /contracts/:id NÃO aceita planId — força o uso deste endpoint.
//
// applyProration:
//   true  (default) — gera fatura PRORATION (delta positivo) ou CREDIT
//                     (delta negativo) cobrindo do dia da troca ao próximo
//                     dueDay. Próxima fatura cheia com o novo valor.
//   false           — troca planId/monthlyValue/banda agora, sem cobrança
//                     de ajuste. Próxima fatura cheia com o novo valor.
export const ChangeContractPlanRequestSchema = z.object({
  planId: z.string().uuid(),
  applyProration: z.coerce.boolean().default(true),
  // Data efetiva da troca. Default = agora. Útil pra antedatar correções
  // operacionais (ex.: "troquei dia 15 mas só registro hoje").
  effectiveDate: z.string().date().optional(),
  note: z.string().max(500).optional(),
});
export type ChangeContractPlanRequest = z.infer<typeof ChangeContractPlanRequestSchema>;

// Preview do cálculo de troca antes de aplicar. Mesma assinatura sem note.
export const PreviewChangePlanRequestSchema = ChangeContractPlanRequestSchema.omit({
  note: true,
});
export type PreviewChangePlanRequest = z.infer<typeof PreviewChangePlanRequestSchema>;

export interface ChangePlanPreviewResponse {
  // Plano novo proposto.
  newPlanId: string;
  newPlanName: string;
  newMonthlyValue: number;
  // Janela do ciclo atual (POSTPAID).
  cycleStart: string;        // YYYY-MM-DD
  cycleEnd: string;          // YYYY-MM-DD (= próximo dueDay)
  totalDays: number;
  remainDays: number;
  // Componentes do cálculo (delta = chargeNew - creditOld).
  creditOld: number;         // crédito proporcional do plano antigo
  chargeNew: number;         // cobrança proporcional do plano novo
  delta: number;             // positivo = cobrança extra; negativo = crédito
  // Como o sistema vai materializar — pra UI confirmar com o operador.
  willCreate: 'PRORATION' | 'CREDIT' | 'NONE';
}

// -----------------------------------------------------------------------------
// Listagem / busca
// -----------------------------------------------------------------------------
export const ListContractsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),

  customerId: z.string().uuid().optional(),
  status: ContractStatusSchema.optional(),
  pppoeUsername: z.string().max(64).optional(),
  search: z.string().max(255).optional(), // código / endereço / pppoe

  /**
   * Filtro por estado de conexão RADIUS (sessão ativa em radius.radacct).
   * online = tem sessão sem acctstoptime; offline = não tem. Usado pelos
   * cards do dashboard. Caro pra DB (cruza contracts × radacct) — evitar
   * polling agressivo.
   */
  connection: z.enum(['online', 'offline']).optional(),
  /** Só contratos com fatura nessa situação (ex.: OVERDUE — card do dashboard). */
  invoiceStatus: z.enum(['OPEN', 'OVERDUE']).optional(),

  sortBy: z.enum(['createdAt', 'updatedAt', 'dueDay', 'monthlyValue']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListContractsQuery = z.infer<typeof ListContractsQuerySchema>;

// -----------------------------------------------------------------------------
// Response
// -----------------------------------------------------------------------------
export interface ContractResponse {
  id: string;
  tenantId: string;
  customerId: string;
  code: string | null;

  authMethod: ContractAuthMethod;

  // PPPoE — preenchidos só quando authMethod === 'PPPOE'.
  pppoeUsername: string | null;
  // Senha NUNCA retorna em listagens; só aparece em GET /:id para usuários com permissão.
  pppoePassword?: string | null;

  // IPoE — preenchidos só quando authMethod === 'IPOE'.
  circuitId: string | null;
  remoteId: string | null;
  macAddress: string | null;
  framedIpAddress: string | null;
  vlanId: number | null;

  installationAddress: string;
  installationMapsUrl: string | null;
  /** Coordenada do pino no módulo Mapeamento. Null = não georreferenciado. */
  latitude: number | null;
  longitude: number | null;
  planId: string | null;
  /** Nome do plano (denormalizado pra UI — evita N+1 na listagem). */
  planName?: string | null;
  monthlyValue: number;
  bandwidthMbps: number;        // download
  uploadMbps: number | null;
  dueDay: number;

  // Modelo de cobrança. POSTPAID = paga depois (dueDay); PREPAID = paga antes.
  paymentMode: PaymentMode;
  // Override por contrato; null = usa plan.blockAfterDays.
  blockAfterDays: number | null;
  // Resolvido pela API (contract.blockAfterDays ?? plan.blockAfterDays ?? 5).
  // Útil pra UI mostrar o valor efetivo sem precisar carregar o plano.
  effectiveBlockAfterDays: number;
  // PREPAID — data até onde o cliente está pago.
  prepaidUntil: string | null;
  // PREPAID — dia do mês âncora do ciclo (clamp 28/fev).
  cycleAnchorDay: number | null;

  status: ContractStatus;
  suspendReason: ContractSuspendReason | null;

  activatedAt: string | null;
  suspendedAt: string | null;
  cancelledAt: string | null;

  notes: string | null;

  createdAt: string;
  updatedAt: string;

  customer?: {
    id: string;
    displayName: string;
    type: 'INDIVIDUAL' | 'COMPANY';
  } | null;
}
