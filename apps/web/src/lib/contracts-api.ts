/**
 * Cliente tipado para os endpoints do módulo de Contratos.
 * Rotas proxiadas pelo gateway em `/api/v1/*`.
 */
import { api } from './api';
import type { Paginated } from './crm-types';

// -----------------------------------------------------------------------------
// Tipos (espelho do backend; mantidos aqui para evitar import do package shared
// que só é distribuído em dist/ para Node)
// -----------------------------------------------------------------------------
export type ContractStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
export type ContractSuspendReason = 'MANUAL' | 'OVERDUE_PAYMENT' | 'OTHER';
export type InvoiceStatus = 'OPEN' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type ContractAuthMethod = 'PPPOE' | 'IPOE';

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
  monthlyValue: number;
  bandwidthMbps: number;
  dueDay: number;
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
  status: InvoiceStatus;
  paidAt: string | null;
  paidAmount: number | null;
  /** Desconto aplicado no pagamento (positivo). */
  discountAmount: number | null;
  /** Forma como o cliente pagou. */
  paidVia: 'CASH' | 'PIX' | 'CARD' | 'BANK_TRANSFER' | 'OTHER' | null;
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
function qs<T extends Record<string, unknown>>(params: T | Record<string, never> = {}): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
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
  sortBy?: 'createdAt' | 'updatedAt' | 'dueDay' | 'monthlyValue';
  sortDir?: 'asc' | 'desc';
}

interface CommonContractInput {
  customerId: string;
  code?: string;
  installationAddress: string;
  installationMapsUrl?: string | null;
  monthlyValue: number;
  bandwidthMbps: number;
  dueDay: number;
  notes?: string | null;
  firstDueDate?: string;
}

export type CreateContractInput =
  | (CommonContractInput & {
      authMethod: 'PPPOE';
      pppoeUsername: string;
      pppoePassword: string;
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
  monthlyValue?: number;
  bandwidthMbps?: number;
  dueDay?: number;
  notes?: string | null;
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
};

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
  paidVia?: 'CASH' | 'PIX' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
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
  pay(id: string, input: PayInvoiceInput = {}) {
    return api.post<ContractInvoice>(`/v1/contract-invoices/${id}/pay`, input);
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
