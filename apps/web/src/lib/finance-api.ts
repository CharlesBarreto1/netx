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
export type PaymentMethod = 'CASH' | 'PIX' | 'CARD' | 'BANK_TRANSFER' | 'BOLETO' | 'OTHER';
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
  BOLETO: 'boleto',
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
    input: {
      type: 'INCOME' | 'OUTCOME' | 'ADJUSTMENT';
      amount: number;
      description?: string;
      occurredAt?: string;
      attachment?: CashMovementAttachmentInput;
    },
  ) {
    return api.post<CashMovement>(`/v1/cash-registers/${id}/movements`, input);
  },
  /** Passo 1 do anexo: pede URL presigned pra subir a NF antes de lançar. */
  presignMovementAttachment(
    id: string,
    input: { fileName: string; contentType?: string },
  ) {
    return api.post<{ uploadUrl: string; storageKey: string; expiresIn: number }>(
      `/v1/cash-registers/${id}/movements/attachment-presign`,
      input,
    );
  },
  /** Reverte um lançamento manual/transferência (não serve pra fatura/cobrança/folha). */
  reverseMovement(registerId: string, movementId: string) {
    return api.delete(`/v1/cash-registers/${registerId}/movements/${movementId}`);
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

export interface CashMovementAttachmentInput {
  storageKey: string;
  fileName: string;
  contentType?: string;
  sizeBytes?: number;
}

export interface CashMovementAttachment {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  url?: string;
}

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
  attachments?: CashMovementAttachment[];
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
  /** Estorna a baixa de uma cobrança paga errada. */
  unpay(id: string) {
    return api.post<OneTimeCharge>(`/v1/charges/${id}/unpay`, {});
  },
  cancel(id: string, reason?: string) {
    return api.post<OneTimeCharge>(`/v1/charges/${id}/cancel`, { reason });
  },
  remove(id: string) {
    return api.delete(`/v1/charges/${id}`);
  },
};

// =============================================================================
// CONTAS A PAGAR — parcelas de pagamento a fornecedor (geradas pela compra
// de estoque: à vista = 1 parcela paga; a prazo = N parcelas em aberto).
// =============================================================================
export type PayableStatus = 'OPEN' | 'PAID' | 'CANCELLED';

export interface SupplierPayable {
  id: string;
  tenantId: string;
  supplierId: string;
  supplierName?: string;
  purchaseId: string | null;
  purchaseInvoiceNumber?: string | null;
  description: string | null;
  installmentNumber: number;
  installmentCount: number;
  amount: number;
  dueDate: string;
  status: PayableStatus;
  /** Derivado no backend: OPEN + vencimento antes de hoje. */
  isOverdue: boolean;
  paidAt: string | null;
  paidAmount: number | null;
  paidVia: PaymentMethod | null;
  cashRegisterId: string | null;
  cashRegisterName?: string | null;
  paymentNote: string | null;
  createdById: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayablesSummary {
  openCount: number;
  openTotal: number;
  overdueCount: number;
  overdueTotal: number;
  paidThisMonthTotal: number;
}

export interface ListPayablesParams {
  page?: number;
  pageSize?: number;
  supplierId?: string;
  purchaseId?: string;
  status?: PayableStatus;
  overdueOnly?: boolean;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
  sortBy?: 'dueDate' | 'createdAt' | 'amount';
  sortDir?: 'asc' | 'desc';
}

export interface PayPayableInput {
  cashRegisterId?: string | null;
  paidVia?: PaymentMethod;
  paidAmount?: number;
  paidAt?: string;
  note?: string;
}

export const payablesApi = {
  listPath: (params: ListPayablesParams = {}) => `/v1/finance/payables${qs(params)}`,
  list(params: ListPayablesParams = {}) {
    return api.get<Paginated<SupplierPayable>>(this.listPath(params));
  },
  summaryPath: () => `/v1/finance/payables/summary`,
  summary() {
    return api.get<PayablesSummary>(this.summaryPath());
  },
  get(id: string) {
    return api.get<SupplierPayable>(`/v1/finance/payables/${id}`);
  },
  /** Dá baixa numa parcela (opcionalmente lançando a saída num caixa). */
  pay(id: string, input: PayPayableInput) {
    return api.post<SupplierPayable>(`/v1/finance/payables/${id}/pay`, input);
  },
  /** Estorna a baixa de uma parcela paga errada (desfaz o caixa). */
  unpay(id: string) {
    return api.post<SupplierPayable>(`/v1/finance/payables/${id}/unpay`, {});
  },
};

// =============================================================================
// EFI / EfiPay — pagamentos BR (Pix imediato + boleto híbrido "Bolix")
// =============================================================================
export type EfiChargeKind = 'PIX' | 'BOLIX';
export type EfiChargeStatus = 'PENDING' | 'ACTIVE' | 'PAID' | 'CANCELED' | 'ERROR';

export interface EfiCharge {
  id: string;
  tenantId: string;
  invoiceId: string;
  kind: EfiChargeKind;
  status: EfiChargeStatus;
  amount: number;
  txid: string | null;
  efiChargeId: string | null;
  pixCopiaECola: string | null;
  pixQrImage: string | null; // dataURL image/png
  barcode: string | null; // linha digitável
  pdfUrl: string | null;
  paymentLink: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  paidAmount: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EfiConfigView {
  tenantId: string;
  environment: 'PRODUCTION' | 'SANDBOX';
  enabled: boolean;
  hasCredentials: boolean;
  hasCertificate: boolean;
  pixKey: string | null;
  defaultChargeKind: EfiChargeKind;
  expirationDays: number;
  autoGenerate: boolean;
  finePercent: number | null;
  interestPercent: number | null;
  pixWebhookRegistered: boolean;
  pixWebhookUrl: string | null;
  boletoNotificationUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GenerateEfiChargeInput {
  kind?: EfiChargeKind;
  force?: boolean;
}

export interface EfiDiagnosticsProbe {
  api: 'pix' | 'cobrancas';
  ok: boolean;
  status: number;
  hint: string;
  body: unknown;
}

export interface EfiDiagnostics {
  environment: 'PRODUCTION' | 'SANDBOX';
  clientId: string;
  hasCertificate: boolean;
  pixKey: string | null;
  webhookBaseConfigured: boolean;
  webhookUrls: { pix: string | null; boleto: string | null };
  probes: EfiDiagnosticsProbe[];
}

export const efiApi = {
  configPath: () => `/v1/efi/config`,
  getConfig() {
    return api.get<EfiConfigView>(this.configPath());
  },
  // Diagnóstico "Testar conexão": OAuth Pix (mTLS) + Cobranças, sem emitir nada.
  diagnostics() {
    return api.get<EfiDiagnostics>('/v1/efi/config/diagnostics');
  },
  // Cobrança (ativa/mais recente) de uma fatura — null quando ainda não existe.
  invoiceChargePath: (invoiceId: string) => `/v1/efi/invoices/${invoiceId}/charge`,
  getForInvoice(invoiceId: string) {
    return api.get<EfiCharge | null>(this.invoiceChargePath(invoiceId));
  },
  generate(invoiceId: string, input: GenerateEfiChargeInput = {}) {
    return api.post<EfiCharge>(`/v1/efi/invoices/${invoiceId}/charge`, input);
  },
  saveConfig(input: UpsertEfiConfigInput) {
    return api.put<EfiConfigView>('/v1/efi/config', input);
  },
  registerWebhook() {
    return api.post<{ url: string }>('/v1/efi/config/register-webhook');
  },
  runAutogen() {
    return api.post<{ created: number }>('/v1/efi/config/run-autogen');
  },
};

/**
 * Upsert da config EFI. Segredos (clientId/secret/.p12) são WRITE-ONLY —
 * enviados aqui, nunca retornados; campos ausentes/'' mantêm o valor atual.
 */
export interface UpsertEfiConfigInput {
  environment?: 'PRODUCTION' | 'SANDBOX';
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
  certificateBase64?: string;
  certificatePassword?: string;
  pixKey?: string | null;
  defaultChargeKind?: EfiChargeKind;
  expirationDays?: number;
  autoGenerate?: boolean;
  finePercent?: number | null;
  interestPercent?: number | null;
}

// =============================================================================
// BTG Pactual — pagamentos BR (boleto + Pix cobrança + Pix Automático).
// Auth OAuth2 via BTG Id (Authorization Code → consentimento). Coexiste com EFI;
// o tenant escolhe o gateway BR ativo (br.gateway).
// =============================================================================
export type BtgChargeKind = 'BOLETO' | 'PIX';
export type BtgChargeStatus = 'PENDING' | 'ACTIVE' | 'PAID' | 'CANCELED' | 'ERROR';
export type BrPaymentGateway = 'MANUAL' | 'EFI' | 'BTG';
export type BtgRecurrencePeriod =
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUAL'
  | 'ANNUALLY';
export type BtgRecurrenceStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'CREATED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELED'
  | 'FINISHED'
  | 'ERROR';

export interface BtgCharge {
  id: string;
  tenantId: string;
  invoiceId: string;
  kind: BtgChargeKind;
  status: BtgChargeStatus;
  amount: number;
  txid: string | null;
  btgChargeId: string | null;
  pixEmv: string | null; // copia-e-cola
  pixQrImage: string | null;
  barcode: string | null;
  digitableLine: string | null;
  pdfUrl: string | null;
  paymentLink: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  paidAmount: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BtgRecurrence {
  id: string;
  tenantId: string;
  contractId: string;
  status: BtgRecurrenceStatus;
  contractRef: string;
  authorizationId: string | null;
  period: BtgRecurrencePeriod;
  retryPolicy: string;
  amount: number | null;
  minimumAmount: number | null;
  initialDate: string;
  finalDate: string | null;
  installments: number | null;
  emv: string | null;
  qrImage: string | null;
  approvedAt: string | null;
  canceledAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BtgConfigView {
  tenantId: string;
  environment: 'PRODUCTION' | 'SANDBOX';
  enabled: boolean;
  hasCredentials: boolean;
  authorized: boolean;
  authorizedAt: string | null;
  redirectUri: string | null;
  scopes: string | null;
  companyId: string | null;
  accountNumber: string | null;
  accountBranch: string | null;
  pixKey: string | null;
  defaultChargeKind: BtgChargeKind;
  expirationDays: number;
  autoGenerate: boolean;
  finePercent: number | null;
  interestPercent: number | null;
  webhookUrl: string | null;
  webhookRegistered: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UpsertBtgConfigInput {
  environment?: 'PRODUCTION' | 'SANDBOX';
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string | null;
  scopes?: string | null;
  companyId?: string | null;
  accountNumber?: string | null;
  accountBranch?: string | null;
  pixKey?: string | null;
  defaultChargeKind?: BtgChargeKind;
  expirationDays?: number;
  autoGenerate?: boolean;
  finePercent?: number | null;
  interestPercent?: number | null;
}

export interface GenerateBtgChargeInput {
  kind?: BtgChargeKind;
  force?: boolean;
}

export interface BtgDiagnosticsProbe {
  env: 'SANDBOX' | 'PRODUCTION';
  idBase: string;
  ok: boolean;
  status: number;
  hint: string;
  body: unknown;
}

export interface BtgDiagnostics {
  environment: 'SANDBOX' | 'PRODUCTION';
  idBase: string;
  apiBase: string;
  clientId: string;
  redirectUri: string | null;
  scopes: string;
  companyId: string | null;
  authorizeUrl: string | null;
  probes: BtgDiagnosticsProbe[];
}

export interface CreateBtgRecurrenceInput {
  period?: BtgRecurrencePeriod;
  amount?: number | null;
  minimumAmount?: number | null;
  initialDate?: string;
  finalDate?: string | null;
  installments?: number | null;
  force?: boolean;
}

export const btgApi = {
  configPath: () => `/v1/btg/config`,
  getConfig() {
    return api.get<BtgConfigView>(this.configPath());
  },
  saveConfig(input: UpsertBtgConfigInput) {
    return api.put<BtgConfigView>('/v1/btg/config', input);
  },
  // Consentimento OAuth — devolve a URL do BTG Id p/ abrir no navegador.
  authorize() {
    return api.post<{ authorizeUrl: string }>('/v1/btg/config/authorize');
  },
  // Diagnóstico: authorizeUrl exata + probes client_credentials nos 2 hosts.
  diagnostics() {
    return api.get<BtgDiagnostics>('/v1/btg/config/diagnostics');
  },
  registerWebhook() {
    return api.post<{ url: string }>('/v1/btg/config/register-webhook');
  },
  getGateway() {
    return api.get<{ gateway: BrPaymentGateway }>('/v1/btg/gateway');
  },
  setGateway(gateway: BrPaymentGateway) {
    return api.put<{ gateway: BrPaymentGateway }>('/v1/btg/gateway', { gateway });
  },
  // Cobranças
  invoiceChargePath: (invoiceId: string) => `/v1/btg/invoices/${invoiceId}/charge`,
  getForInvoice(invoiceId: string) {
    return api.get<BtgCharge | null>(this.invoiceChargePath(invoiceId));
  },
  generate(invoiceId: string, input: GenerateBtgChargeInput = {}) {
    return api.post<BtgCharge>(`/v1/btg/invoices/${invoiceId}/charge`, input);
  },
  pdfPath: (chargeId: string) => `/v1/btg/charges/${chargeId}/pdf`,
  // Pix Automático (recorrências)
  contractRecurrencePath: (contractId: string) => `/v1/btg/contracts/${contractId}/recurrence`,
  getRecurrenceForContract(contractId: string) {
    return api.get<BtgRecurrence | null>(this.contractRecurrencePath(contractId));
  },
  createRecurrence(contractId: string, input: CreateBtgRecurrenceInput = {}) {
    return api.post<BtgRecurrence>(`/v1/btg/contracts/${contractId}/recurrence`, input);
  },
  cancelRecurrence(id: string) {
    return api.post<BtgRecurrence>(`/v1/btg/recurrences/${id}/cancel`);
  },
};
