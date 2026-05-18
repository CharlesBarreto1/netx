/**
 * Cliente tipado de Finance — caixas + cobranças avulsas + métodos de pagamento.
 * Endpoints atrás do gateway em `/api/v1/cash-registers` e `/api/v1/charges`.
 */
import { api } from './api';
import type { Paginated } from './crm-types';

// =============================================================================
// ENUMS / TIPOS
// =============================================================================
export type CashRegisterType = 'CASH' | 'BANK' | 'PIX' | 'CARD' | 'OTHER';
export type CashRegisterRole = 'OPERATOR' | 'VIEWER';
export type PaymentMethod = 'CASH' | 'PIX' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
export type OneTimeChargeStatus = 'OPEN' | 'PAID' | 'CANCELLED';

export interface CashRegisterMember {
  userId: string;
  role: CashRegisterRole;
  user: { id: string; firstName: string; lastName: string; email: string };
  createdAt: string;
}

export interface CashRegister {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: CashRegisterType;
  color: string | null;
  currency: string;
  isActive: boolean;
  openingBalance: number;
  currentBalance?: number;
  members?: CashRegisterMember[];
  createdAt: string;
  updatedAt: string;
}

export interface OneTimeCharge {
  id: string;
  tenantId: string;
  customerId: string;
  contractId: string | null;
  code: string | null;
  description: string;
  amount: number;
  dueDate: string;
  issuedAt: string;
  status: OneTimeChargeStatus;
  paidAt: string | null;
  paidAmount: number | null;
  discountAmount: number | null;
  paidVia: PaymentMethod | null;
  cashRegisterId: string | null;
  paymentNote: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; displayName: string } | null;
  contract?: { id: string; code: string | null } | null;
  cashRegister?: { id: string; name: string } | null;
}

// =============================================================================
// LABELS PRA UI
// =============================================================================
export const PAYMENT_METHOD_LABEL_KEY: Record<PaymentMethod, string> = {
  CASH: 'cash',
  PIX: 'pix',
  CARD: 'card',
  BANK_TRANSFER: 'bankTransfer',
  OTHER: 'other',
};

export const CASH_REGISTER_TYPE_LABEL_KEY: Record<CashRegisterType, string> = {
  CASH: 'cash',
  BANK: 'bank',
  PIX: 'pix',
  CARD: 'card',
  OTHER: 'other',
};

// =============================================================================
// QUERY HELPER
// =============================================================================
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

// =============================================================================
// CASH REGISTERS
// =============================================================================
export interface CreateCashRegisterInput {
  name: string;
  description?: string | null;
  type?: CashRegisterType;
  color?: string | null;
  currency?: string;
  isActive?: boolean;
  openingBalance?: number;
  operatorUserIds?: string[];
}

export interface UpdateCashRegisterInput {
  name?: string;
  description?: string | null;
  type?: CashRegisterType;
  color?: string | null;
  currency?: string;
  isActive?: boolean;
  openingBalance?: number;
}

export const cashRegistersApi = {
  listPath: (includeInactive = false) =>
    `/v1/cash-registers${includeInactive ? '?includeInactive=true' : ''}`,
  list(includeInactive = false) {
    return api.get<CashRegister[]>(this.listPath(includeInactive));
  },
  getPath: (id: string) => `/v1/cash-registers/${id}`,
  get(id: string) {
    return api.get<CashRegister>(this.getPath(id));
  },
  create(input: CreateCashRegisterInput) {
    return api.post<CashRegister>('/v1/cash-registers', input);
  },
  update(id: string, input: UpdateCashRegisterInput) {
    return api.patch<CashRegister>(`/v1/cash-registers/${id}`, input);
  },
  remove(id: string) {
    return api.delete(`/v1/cash-registers/${id}`);
  },
  addMember(id: string, userId: string, role: CashRegisterRole = 'OPERATOR') {
    return api.post<CashRegisterMember>(`/v1/cash-registers/${id}/members`, {
      userId,
      role,
    });
  },
  removeMember(id: string, userId: string) {
    return api.delete(`/v1/cash-registers/${id}/members/${userId}`);
  },
  // ---- movements / balance / transfer
  balancePath: (id: string) => `/v1/cash-registers/${id}/balance`,
  balance(id: string) {
    return api.get<CashRegisterBalance>(this.balancePath(id));
  },
  movementsPath: (id: string, params: ListMovementsParams = {}) =>
    `/v1/cash-registers/${id}/movements${qs(params)}`,
  listMovements(id: string, params: ListMovementsParams = {}) {
    return api.get<Paginated<CashMovement>>(this.movementsPath(id, params));
  },
  createMovement(
    id: string,
    input: { type: 'INCOME' | 'OUTCOME' | 'ADJUSTMENT'; amount: number; description?: string; occurredAt?: string },
  ) {
    return api.post<CashMovement>(`/v1/cash-registers/${id}/movements`, input);
  },
  transfer(
    fromId: string,
    input: { toCashRegisterId: string; amount: number; description?: string; occurredAt?: string },
  ) {
    return api.post<{ outId: string; inId: string; transferGroupId: string }>(
      `/v1/cash-registers/${fromId}/transfer`,
      input,
    );
  },
};

// =============================================================================
// MOVEMENT TYPES
// =============================================================================
export type CashMovementType =
  | 'INCOME'
  | 'OUTCOME'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT';

export type CashMovementSource = 'INVOICE' | 'CHARGE' | 'TRANSFER' | 'MANUAL';

export interface CashMovement {
  id: string;
  tenantId: string;
  cashRegisterId: string;
  type: CashMovementType;
  source: CashMovementSource;
  amount: number;
  description: string | null;
  occurredAt: string;
  sourceId: string | null;
  transferGroupId: string | null;
  createdById: string | null;
  createdAt: string;
  counterpart?: {
    cashRegisterId: string;
    cashRegisterName: string;
  } | null;
}

export interface CashRegisterBalance {
  cashRegisterId: string;
  openingBalance: number;
  movementsTotal: number;
  currentBalance: number;
  byType: {
    income: number;
    outcome: number;
    transferIn: number;
    transferOut: number;
    adjustment: number;
  };
}

export interface ListMovementsParams {
  page?: number;
  pageSize?: number;
  type?: CashMovementType;
  source?: CashMovementSource;
  from?: string;
  to?: string;
}

// =============================================================================
// ONE-TIME CHARGES
// =============================================================================
export interface ListChargesParams {
  page?: number;
  pageSize?: number;
  customerId?: string;
  contractId?: string;
  cashRegisterId?: string;
  status?: OneTimeChargeStatus;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
  sortBy?: 'dueDate' | 'createdAt' | 'amount';
  sortDir?: 'asc' | 'desc';
}

export interface CreateChargeInput {
  customerId: string;
  contractId?: string | null;
  code?: string;
  description: string;
  amount: number;
  dueDate: string;
}

export interface UpdateChargeInput {
  description?: string;
  amount?: number;
  dueDate?: string;
  contractId?: string | null;
}

export interface PayPaymentInput {
  cashRegisterId?: string | null;
  paidVia?: PaymentMethod;
  discountAmount?: number;
  paidAmount?: number;
  paidAt?: string;
  note?: string;
}

export const chargesApi = {
  listPath: (params: ListChargesParams = {}) => `/v1/charges${qs(params)}`,
  list(params: ListChargesParams = {}) {
    return api.get<Paginated<OneTimeCharge>>(this.listPath(params));
  },
  getPath: (id: string) => `/v1/charges/${id}`,
  get(id: string) {
    return api.get<OneTimeCharge>(this.getPath(id));
  },
  create(input: CreateChargeInput) {
    return api.post<OneTimeCharge>('/v1/charges', input);
  },
  update(id: string, input: UpdateChargeInput) {
    return api.patch<OneTimeCharge>(`/v1/charges/${id}`, input);
  },
  pay(id: string, input: PayPaymentInput) {
    return api.post<OneTimeCharge>(`/v1/charges/${id}/pay`, input);
  },
  cancel(id: string, reason?: string) {
    return api.post<OneTimeCharge>(`/v1/charges/${id}/cancel`, { reason });
  },
  remove(id: string) {
    return api.delete(`/v1/charges/${id}`);
  },
};
