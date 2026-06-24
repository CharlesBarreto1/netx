/**
 * Cliente tipado para os endpoints do módulo de Contratos.
 * Rotas proxiadas pelo gateway em `/api/v1/*`.
 */
import { api } from './api';
import type { Paginated } from './crm-types';
import type { BrPaymentGateway } from './finance-api';

// -----------------------------------------------------------------------------
// Tipos (espelho do backend; mantidos aqui para evitar import do package shared
// que só é distribuído em dist/ para Node)
// -----------------------------------------------------------------------------
export type ContractStatus = 'PENDING_INSTALL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
export type ContractSuspendReason = 'MANUAL' | 'OVERDUE_PAYMENT' | 'OTHER';
export type InvoiceStatus = 'OPEN' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type InvoiceKind = 'REGULAR' | 'INITIAL' | 'PRORATION' | 'CREDIT';
export type ContractAuthMethod = 'PPPOE' | 'IPOE';
export type PaymentMode = 'POSTPAID' | 'PREPAID';

export interface Contract {
  id: string;
  tenantId: string;
  customerId: string;
  code: string | null;
  authMethod: ContractAuthMethod;
  // PPPoE — preenchidos só quando authMethod === 'PPPOE'.
  pppoeUsername: string | null;
  pppoePassword?: string | null;
  // IPoE — preenchidos só quando authMethod === 'IPOE'.
  circuitId: string | null;
  remoteId: string | null;
  macAddress: string | null;
  framedIpAddress: string | null;
  vlanId: number | null;
  installationAddress: string;
  installationMapsUrl: string | null;
  /** Coordenadas da casa do cliente — preenchidas via app mobile ou form de edição. */
  latitude: number | null;
  longitude: number | null;
  planId: string | null;
  /** Nome do plano (denormalizado pelo backend pra evitar N+1 na listagem). */
  planName?: string | null;
  monthlyValue: number;
  bandwidthMbps: number;
  uploadMbps: number | null;
  dueDay: number;
  /** POSTPAID = paga depois (dueDay); PREPAID = paga antes (ciclo ancorado em activatedAt). */
  paymentMode: PaymentMode;
  /** Forma de cobrança BR do contrato (MANUAL | EFI | BTG). */
  brBillingGateway: BrPaymentGateway;
  /** Override per-contract dos dias até bloqueio. null = usa do plano. */
  blockAfterDays: number | null;
  /** Resolvido pelo backend (override > plan > 5). */
  effectiveBlockAfterDays: number;
  /** PREPAID — data até onde está pago. */
  prepaidUntil: string | null;
  /** PREPAID — dia do mês âncora (clamp 28/fev). */
  cycleAnchorDay: number | null;
  status: ContractStatus;
  suspendReason: ContractSuspendReason | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  cancelledAt: string | null;
  trustExtensionUntil: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; displayName: string; type: 'INDIVIDUAL' | 'COMPANY' } | null;
}

export interface ContractInvoice {
  id: string;
  tenantId: string;
  contractId: string;
  amount: number;
  dueDate: string;
  issuedAt: string;
  /** Tipo da fatura — separa recorrente de ajustes (prorate, crédito). */
  kind: InvoiceKind;
  /** Início do período coberto (inclusive). Null em faturas pré-feature. */
  periodStart: string | null;
  /** Fim do período coberto (exclusive). Null em faturas pré-feature. */
  periodEnd: string | null;
  status: InvoiceStatus;
  paidAt: string | null;
  paidAmount: number | null;
  /** Desconto aplicado no pagamento (positivo). */
  discountAmount: number | null;
  /** Forma como o cliente pagou. */
  paidVia: 'CASH' | 'PIX' | 'CARD' | 'BANK_TRANSFER' | 'BOLETO' | 'OTHER' | null;
  /** Caixa que recebeu o pagamento. */
  cashRegisterId: string | null;
  paymentNote: string | null;
  reference: string | null;
  createdAt: string;
  updatedAt: string;
  contract?: {
    id: string;
    code: string | null;
    pppoeUsername: string | null;
    customerId: string;
  };
}

// -----------------------------------------------------------------------------
// QueryString helper
// -----------------------------------------------------------------------------
// Aceita qualquer interface/type via `object` constraint (interfaces TS não têm
// index signature, então `Record<string, unknown>` quebra). O cast interno é
// safe: nunca acessamos props arbitrárias, só iteramos `Object.entries`.
function qs<T extends object>(params: T | Record<string, never> = {}): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// -----------------------------------------------------------------------------
// CONTRACTS
// -----------------------------------------------------------------------------
export interface ListContractsParams {
  page?: number;
  pageSize?: number;
  customerId?: string;
  status?: ContractStatus;
  pppoeUsername?: string;
  search?: string;
  /** Estado da conexão RADIUS (sessão ativa no radacct). */
  connection?: 'online' | 'offline';
  /** Só contratos com fatura nessa situação (card "Faturas vencidas"). */
  invoiceStatus?: 'OPEN' | 'OVERDUE';
  sortBy?: 'createdAt' | 'updatedAt' | 'dueDay' | 'monthlyValue';
  sortDir?: 'asc' | 'desc';
}

interface CommonContractInput {
  customerId: string;
  installationAddress: string;
  installationMapsUrl?: string | null;
  /** Plano de internet selecionado (opcional). */
  planId?: string | null;
  monthlyValue: number;
  bandwidthMbps: number;
  /** Upload em Mbps (opcional). */
  uploadMbps?: number | null;
  dueDay: number;
  /** Default POSTPAID. PREPAID = ciclo ancorado em activatedAt. */
  paymentMode?: PaymentMode;
  /** Forma de cobrança BR. Omitido = herda o padrão do tenant. */
  brBillingGateway?: BrPaymentGateway;
  /** Override per-contract dos dias até bloqueio. null/undefined = usa do plano. */
  blockAfterDays?: number | null;
  notes?: string | null;
  firstDueDate?: string;
  /**
   * 'ACTIVE' (default) = comercial confirma instalação realizada → gera fatura
   * inicial + enfileira RADIUS sync.
   *
   * 'PENDING_INSTALL' = fluxo ZTP — técnico ainda vai visitar via
   * /provisioning/install/:contractId. Sem fatura/RADIUS até ativação.
   */
  initialStatus?: 'ACTIVE' | 'PENDING_INSTALL';
  /**
   * Wi-Fi do cliente — capturado no cadastro. O provisionamento aplica via
   * TR-069 lendo do contrato (técnico não digita mais). Opcional na API.
   */
  ssid?: string | null;
  wifiPassword?: string | null;
}

export type CreateContractInput =
  | (CommonContractInput & {
      authMethod: 'PPPOE';
      // Opcionais — o backend gera quando ausentes (login derivado do nome
      // do cliente, senha padrão da operação).
      pppoeUsername?: string;
      pppoePassword?: string;
    })
  | (CommonContractInput & {
      authMethod: 'IPOE';
      circuitId?: string | null;
      remoteId?: string | null;
      macAddress?: string | null;
      framedIpAddress?: string | null;
      vlanId?: number | null;
    });

export interface UpdateContractInput {
  authMethod?: ContractAuthMethod;
  pppoeUsername?: string;
  pppoePassword?: string;
  circuitId?: string | null;
  remoteId?: string | null;
  macAddress?: string | null;
  framedIpAddress?: string | null;
  vlanId?: number | null;
  installationAddress?: string;
  installationMapsUrl?: string | null;
  /** Coordenadas — preenchidas via app mobile ou form de edição. null limpa. */
  latitude?: number | null;
  longitude?: number | null;
  monthlyValue?: number;
  bandwidthMbps?: number;
  /** Upload em Mbps (opcional). */
  uploadMbps?: number | null;
  dueDay?: number;
  /**
   * Override per-contract dos dias até bloqueio. `null` explícito limpa
   * o override (volta a usar do plano).
   */
  blockAfterDays?: number | null;
  /** Forma de cobrança BR (MANUAL | EFI | BTG). Muda só faturas futuras. */
  brBillingGateway?: BrPaymentGateway;
  notes?: string | null;
  // NÃO inclua planId aqui — troca de plano vai por changePlan()
  // (calcula prorate). O backend rejeita planId no PATCH /contracts/:id.
}

/** Input do POST /contracts/:id/change-plan e /preview-change-plan. */
export interface ChangePlanInput {
  planId: string;
  /** true (default) = gera fatura de ajuste. false = só troca o plano. */
  applyProration?: boolean;
  /** YYYY-MM-DD. Default = hoje. */
  effectiveDate?: string;
  note?: string;
}

/** Preview do impacto financeiro da troca (resposta de /preview-change-plan). */
export interface ChangePlanPreview {
  newPlanId: string;
  newPlanName: string;
  newMonthlyValue: number;
  cycleStart: string;
  cycleEnd: string;
  totalDays: number;
  remainDays: number;
  /** Crédito proporcional do plano antigo. */
  creditOld: number;
  /** Cobrança proporcional do plano novo. */
  chargeNew: number;
  /** Positivo = cobrança extra; negativo = crédito; 0 = neutro. */
  delta: number;
  willCreate: 'PRORATION' | 'CREDIT' | 'NONE';
}

export const contractsApi = {
  listPath: (params: ListContractsParams = {}) => `/v1/contracts${qs(params)}`,
  list(params: ListContractsParams = {}) {
    return api.get<Paginated<Contract>>(this.listPath(params));
  },
  get(id: string) {
    return api.get<Contract>(`/v1/contracts/${id}`);
  },
  create(input: CreateContractInput) {
    return api.post<Contract>('/v1/contracts', input);
  },
  update(id: string, input: UpdateContractInput) {
    return api.patch<Contract>(`/v1/contracts/${id}`, input);
  },
  suspend(id: string, reason: ContractSuspendReason = 'MANUAL', note?: string) {
    return api.post<Contract>(`/v1/contracts/${id}/suspend`, { reason, note });
  },
  reactivate(id: string, note?: string) {
    return api.post<Contract>(`/v1/contracts/${id}/reactivate`, { note });
  },
  /**
   * Religue de confiança — reativa por N dias (default 5). Cron diário
   * re-suspende ao expirar se cliente não pagar.
   */
  trustExtend(id: string, days = 5, note?: string) {
    return api.post<Contract>(`/v1/contracts/${id}/trust-extend`, { days, note });
  },
  cancel(id: string, note?: string) {
    return api.post<Contract>(`/v1/contracts/${id}/cancel`, { note });
  },
  /** Reabre um contrato cancelado por engano. */
  reopen(id: string) {
    return api.post<Contract>(`/v1/contracts/${id}/reopen`, {});
  },
  /**
   * Preview de troca de plano. Não persiste — só calcula crédito/débito
   * pro operador confirmar antes de chamar changePlan().
   */
  previewChangePlan(id: string, input: ChangePlanInput) {
    return api.post<ChangePlanPreview>(
      `/v1/contracts/${id}/preview-change-plan`,
      input,
    );
  },
  /**
   * Aplica troca de plano. Em ACTIVE+applyProration cria fatura PRORATION
   * (delta > 0) ou CREDIT (delta < 0). Re-sincroniza RADIUS pra refletir
   * nova banda. Bloqueado em PREPAID (v1).
   */
  changePlan(id: string, input: ChangePlanInput) {
    return api.post<Contract>(`/v1/contracts/${id}/change-plan`, input);
  },
  /**
   * Força CoA Disconnect-Request pra todos os NASes com sessão ativa. NÃO
   * muda estado do contrato — só derruba sessão (cliente reconecta automa-
   * ticamente se RADIUS aceita). Útil em troca de plano, debug, IP travado.
   */
  kick(id: string) {
    return api.post<{
      kicked: number;
      results: Array<{ nasIp: string; ok: boolean; error?: string }>;
    }>(`/v1/contracts/${id}/kick`);
  },
  remove(id: string) {
    return api.delete(`/v1/contracts/${id}`);
  },

  // ---------------------------------------------------------------------------
  // Wi-Fi pós-instalação (TR-069)
  // ---------------------------------------------------------------------------
  wifiStatus(id: string) {
    return api.get<ContractWifiStatus>(`/v1/contracts/${id}/wifi`);
  },
  updateWifi(id: string, input: UpdateContractWifiInput) {
    return api.patch<UpdateContractWifiResponse>(`/v1/contracts/${id}/wifi`, input);
  },
  revealWifiPassword(id: string) {
    return api.get<RevealContractWifiResponse>(`/v1/contracts/${id}/wifi/reveal`);
  },
};

// -----------------------------------------------------------------------------
// WI-FI TYPES
// -----------------------------------------------------------------------------
export interface UpdateContractWifiInput {
  ssid: string;
  wifiPassword: string;
  reboot?: boolean;
}

export interface UpdateContractWifiResponse {
  setParamsTaskId: string;
  rebootTaskId: string | null;
  etaSeconds: number;
}

export interface RevealContractWifiResponse {
  ssid: string | null;
  wifiPassword: string;
}

export interface ContractWifiStatus {
  ssid: string | null;
  hasWifiPassword: boolean;
  hasTr069Device: boolean;
  lastTask: {
    id: string;
    action: 'SET_PARAMS' | 'GET_PARAMS' | 'SET_ATTRIBUTES' | 'REBOOT' | 'FACTORY_RESET' | 'DOWNLOAD' | 'ADD_OBJECT' | 'DELETE_OBJECT';
    status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
    createdAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
  lastInformAt: string | null;
}

// -----------------------------------------------------------------------------
// INVOICES
// -----------------------------------------------------------------------------
export interface ListInvoicesParams {
  page?: number;
  pageSize?: number;
  contractId?: string;
  customerId?: string;
  status?: InvoiceStatus;
  dueFrom?: string;
  dueTo?: string;
  sortBy?: 'dueDate' | 'createdAt' | 'amount';
  sortDir?: 'asc' | 'desc';
}

export interface PayInvoiceInput {
  paidAmount?: number;
  paidAt?: string;
  note?: string;
  /** Caixa que recebeu (UUID). Validado contra membership do user. */
  cashRegisterId?: string | null;
  /** Forma de pagamento. */
  paidVia?: 'CASH' | 'PIX' | 'CARD' | 'BANK_TRANSFER' | 'BOLETO' | 'OTHER';
  /** Desconto aplicado (positivo). Exige perm `finance.discount.apply`. */
  discountAmount?: number;
}

export const contractInvoicesApi = {
  listPath: (params: ListInvoicesParams = {}) => `/v1/contract-invoices${qs(params)}`,
  list(params: ListInvoicesParams = {}) {
    return api.get<Paginated<ContractInvoice>>(this.listPath(params));
  },
  byContractPath: (contractId: string) => `/v1/contracts/${contractId}/invoices`,
  byContract(contractId: string) {
    return api.get<Paginated<ContractInvoice>>(`/v1/contracts/${contractId}/invoices?pageSize=200&sortBy=dueDate&sortDir=desc`);
  },
  /** Gera uma fatura manual no contrato (casos excepcionais; o normal é o cron). */
  create(contractId: string, input: { amount: number; dueDate: string; reference?: string }) {
    return api.post<ContractInvoice>(`/v1/contracts/${contractId}/invoices`, input);
  },
  pay(id: string, input: PayInvoiceInput = {}) {
    return api.post<ContractInvoice>(`/v1/contract-invoices/${id}/pay`, input);
  },
  /** Estorna a baixa de uma fatura paga errada. */
  unpay(id: string) {
    return api.post<ContractInvoice>(`/v1/contract-invoices/${id}/unpay`, {});
  },
  cancel(id: string, note?: string) {
    return api.post<ContractInvoice>(`/v1/contract-invoices/${id}/cancel`, { note });
  },
  /**
   * Define desconto antes do pagamento. Passar 0 zera. Exige
   * permissão `finance.discount.apply`.
   */
  applyDiscount(id: string, discountAmount: number, note?: string) {
    return api.post<ContractInvoice>(`/v1/contract-invoices/${id}/discount`, {
      discountAmount,
      note,
    });
  },
  /**
   * Prorroga vencimento (sem dar baixa). Reativa contrato suspenso por
   * inadimplência se essa era a única fatura vencida.
   */
  postpone(id: string, newDueDate: string, note?: string) {
    return api.post<ContractInvoice>(`/v1/contract-invoices/${id}/postpone`, {
      newDueDate,
      note,
    });
  },
};
