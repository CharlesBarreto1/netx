/**
 * Cliente tipado para os endpoints do módulo de Estoque (Fase 1).
 * Rotas proxiadas pelo gateway em `/api/v1/stock/*`.
 *
 * Convenção: types mantidos aqui (mirror dos schemas em @netx/shared/stock).
 * Importar do @netx/shared direto aceitaria mas exige build do shared antes
 * do web — manter aqui dispensa essa dependência em dev.
 */
import { api } from './api';

/**
 * Shape de paginação usado pelos endpoints de stock (kardex). Difere do
 * `Paginated<T>` de `./crm-types` (que usa `data` + `pagination.total`).
 * O backend de stock retorna `{ items, total, page, pageSize }` direto —
 * mantemos um tipo local pra evitar confusão com o pattern do CRM.
 */
export interface PaginatedStock<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// =============================================================================
// SUPPLIERS
// =============================================================================
export type SupplierTaxIdType = 'CNPJ' | 'CPF' | 'RUC' | 'DNI' | 'CI' | 'OTHER';

export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
  taxId: string | null;
  taxIdType: SupplierTaxIdType | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupplierInput {
  name: string;
  taxId?: string | null;
  taxIdType?: SupplierTaxIdType | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  notes?: string | null;
  isActive?: boolean;
}
export type UpdateSupplierInput = Partial<CreateSupplierInput>;

// =============================================================================
// PRODUCTS
// =============================================================================
export type ProductType = 'PATRIMONIAL' | 'CONSUMIVEL';

export interface Product {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  description: string | null;
  brand: string | null;
  model: string | null;
  type: ProductType;
  unit: string;
  cost: string; // Decimal serializado como string
  price: string | null;
  minStock: string | null;
  isActive: boolean;
  totalStock?: string;
  totalAllocated?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  model?: string | null;
  type: ProductType;
  unit?: string;
  price?: number | null;
  minStock?: number | null;
  isActive?: boolean;
}
export type UpdateProductInput = Partial<Omit<CreateProductInput, 'type'>>;

// =============================================================================
// STOCK LOCATIONS
// =============================================================================
export interface StockLocation {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  userAccess?: Array<{ userId: string; canWrite: boolean; userName?: string }>;
  stats?: { consumableProducts: number; serialItemsInStock: number };
  createdAt: string;
  updatedAt: string;
}

export interface CreateStockLocationInput {
  code: string;
  name: string;
  address?: string | null;
  isActive?: boolean;
  userIds?: string[];
}
export type UpdateStockLocationInput = Partial<CreateStockLocationInput>;

export interface SetLocationAccessInput {
  userIds: Array<{ userId: string; canWrite: boolean }>;
}

// =============================================================================
// PURCHASES
// =============================================================================
export interface PurchaseItemInput {
  productId: string;
  locationId: string;
  quantity: number | string;
  unitCost: number | string;
  serials?: string[];
  notes?: string | null;
}

/**
 * Condição de pagamento da compra → gera parcelas no contas a pagar:
 * CASH = à vista (1 parcela já paga, caixa opcional);
 * INSTALLMENTS = a prazo (N parcelas; soma deve bater com o total).
 */
export interface PurchasePaymentInput {
  condition: 'CASH' | 'INSTALLMENTS';
  cashRegisterId?: string | null;
  paidVia?: string;
  installments?: Array<{ dueDate: string; amount: number }>;
}

export interface CreatePurchaseInput {
  supplierId: string;
  invoiceNumber?: string | null;
  date: string; // ISO
  notes?: string | null;
  items: PurchaseItemInput[];
  /** Opcional — sem ele a compra não gera financeiro. */
  payment?: PurchasePaymentInput | null;
}

export interface Purchase {
  id: string;
  tenantId: string;
  supplierId: string;
  supplierName?: string;
  invoiceNumber: string | null;
  date: string;
  totalCost: string;
  notes: string | null;
  createdById: string;
  createdByName?: string;
  createdAt: string;
  // Última edição (null = nunca editada). Trilha completa via getPurchaseAudit.
  updatedById?: string | null;
  updatedByName?: string | null;
  updatedAt?: string;
  // Parcelas do contas a pagar geradas pela compra (vazio = sem financeiro).
  payables?: Array<{
    id: string;
    installmentNumber: number;
    installmentCount: number;
    amount: string;
    dueDate: string;
    status: 'OPEN' | 'PAID' | 'CANCELLED';
    paidAt: string | null;
    paidVia: string | null;
    cashRegisterId: string | null;
  }>;
  items: Array<{
    id: string;
    productId: string;
    productName?: string;
    productSku?: string;
    productType?: ProductType;
    locationId: string;
    locationName?: string;
    quantity: string;
    unitCost: string;
    totalCost: string;
    serials: string[];
    notes: string | null;
  }>;
}

// Mesma forma do create — edição é um REPLACE total (reverte + reaplica).
export type UpdatePurchaseInput = CreatePurchaseInput;

export interface PurchaseAuditEntry {
  id: string;
  action: string; // purchase.created | purchase.updated | purchase.deleted
  createdAt: string;
  userId: string | null;
  userName: string | null;
  beforeState: unknown;
  afterState: unknown;
}

// Seriais de uma linha PATRIMONIAL (entrada incremental / correção).
export interface PurchaseItemSerial {
  id: string;
  serial: string;
  status:
    | 'IN_STOCK'
    | 'ALLOCATED'
    | 'IN_TRANSIT'
    | 'DEFECTIVE'
    | 'WRITTEN_OFF'
    | 'SOLD'
    | 'DISCARDED';
  locationName: string | null;
  contractCode: string | null;
}

export interface PurchaseItemSerials {
  itemId: string;
  productSku: string;
  quantity: number;
  registered: number;
  serials: PurchaseItemSerial[];
}

// =============================================================================
// STOCK MOVEMENTS (kardex)
// =============================================================================
export type MovementType =
  | 'PURCHASE'
  | 'PURCHASE_RETURN'
  | 'SALE'
  | 'SALE_RETURN'
  | 'COMODATO_OUT'
  | 'COMODATO_RETURN'
  | 'OS_CONSUMPTION'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN';

export interface StockMovement {
  id: string;
  type: MovementType;
  productId: string;
  productName?: string;
  serialItemId: string | null;
  serial?: string | null;
  fromLocationId: string | null;
  fromLocationName?: string | null;
  toLocationId: string | null;
  toLocationName?: string | null;
  quantity: string;
  unitCost: string;
  totalCost: string;
  purchaseId: string | null;
  notes: string | null;
  createdById: string;
  createdByName?: string;
  createdAt: string;
}

export interface ListMovementsQuery {
  page?: number;
  pageSize?: number;
  productId?: string | null;
  serialItemId?: string | null;
  locationId?: string | null;
  type?: MovementType | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface CreateAdjustmentInput {
  direction: 'IN' | 'OUT';
  productId: string;
  locationId: string;
  quantity: number | string;
  unitCost?: number | string;
  serials?: string[];
  reason: string;
  notes?: string | null;
}

export interface CreateStockTransferInput {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number | string;
  serialItemIds?: string[];
  notes?: string | null;
}

// =============================================================================
// QUERY STRING HELPER
// =============================================================================
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
// API CLIENT
// =============================================================================
export const stockApi = {
  // Suppliers ----------------------------------------------------------------
  suppliersPath: (params?: { search?: string; isActive?: boolean }) =>
    `/v1/stock/suppliers${qs(params ?? {})}`,
  listSuppliers: (params?: { search?: string; isActive?: boolean }) =>
    api.get<Supplier[]>(`/v1/stock/suppliers${qs(params ?? {})}`),
  getSupplier: (id: string) => api.get<Supplier>(`/v1/stock/suppliers/${id}`),
  createSupplier: (input: CreateSupplierInput) =>
    api.post<Supplier>('/v1/stock/suppliers', input),
  updateSupplier: (id: string, input: UpdateSupplierInput) =>
    api.patch<Supplier>(`/v1/stock/suppliers/${id}`, input),
  deleteSupplier: (id: string) => api.delete(`/v1/stock/suppliers/${id}`),

  // Products -----------------------------------------------------------------
  productsPath: (params?: { search?: string; type?: ProductType; isActive?: boolean }) =>
    `/v1/stock/products${qs(params ?? {})}`,
  listProducts: (params?: { search?: string; type?: ProductType; isActive?: boolean }) =>
    api.get<Product[]>(`/v1/stock/products${qs(params ?? {})}`),
  getProduct: (id: string) => api.get<Product>(`/v1/stock/products/${id}`),
  createProduct: (input: CreateProductInput) =>
    api.post<Product>('/v1/stock/products', input),
  updateProduct: (id: string, input: UpdateProductInput) =>
    api.patch<Product>(`/v1/stock/products/${id}`, input),
  deleteProduct: (id: string) => api.delete(`/v1/stock/products/${id}`),

  // Stock locations ----------------------------------------------------------
  locationsPath: (params?: { search?: string; isActive?: boolean }) =>
    `/v1/stock/locations${qs(params ?? {})}`,
  listLocations: (params?: { search?: string; isActive?: boolean }) =>
    api.get<StockLocation[]>(`/v1/stock/locations${qs(params ?? {})}`),
  getLocation: (id: string) => api.get<StockLocation>(`/v1/stock/locations/${id}`),
  createLocation: (input: CreateStockLocationInput) =>
    api.post<StockLocation>('/v1/stock/locations', input),
  updateLocation: (id: string, input: UpdateStockLocationInput) =>
    api.patch<StockLocation>(`/v1/stock/locations/${id}`, input),
  deleteLocation: (id: string) => api.delete(`/v1/stock/locations/${id}`),
  // Backend usa POST (não PUT) — operação "replace inteiro" mas o controller
  // foi exposto como POST por convenção do módulo.
  setLocationAccess: (id: string, input: SetLocationAccessInput) =>
    api.post<void>(`/v1/stock/locations/${id}/access`, input),

  // Purchases ----------------------------------------------------------------
  // listPurchases retorna array direto (não paginado — backend take:200).
  purchasesPath: () => `/v1/stock/purchases`,
  listPurchases: () => api.get<Purchase[]>('/v1/stock/purchases'),
  getPurchase: (id: string) => api.get<Purchase>(`/v1/stock/purchases/${id}`),
  createPurchase: (input: CreatePurchaseInput) =>
    api.post<Purchase>('/v1/stock/purchases', input),
  /** Edita/corrige uma compra — reverte e reaplica (só se nada foi movimentado). */
  updatePurchase: (id: string, input: UpdatePurchaseInput) =>
    api.patch<Purchase>(`/v1/stock/purchases/${id}`, input),
  /** Exclui/reverte uma compra (só se nada foi movimentado). */
  deletePurchase: (id: string) => api.delete(`/v1/stock/purchases/${id}`),
  purchaseAuditPath: (id: string) => `/v1/stock/purchases/${id}/audit`,
  /** Trilha de auditoria da compra (criação + edições, com before/after). */
  getPurchaseAudit: (id: string) =>
    api.get<PurchaseAuditEntry[]>(`/v1/stock/purchases/${id}/audit`),

  // Seriais incrementais de uma linha PATRIMONIAL ----------------------------
  purchaseItemSerialsPath: (purchaseId: string, itemId: string) =>
    `/v1/stock/purchases/${purchaseId}/items/${itemId}/serials`,
  listPurchaseItemSerials: (purchaseId: string, itemId: string) =>
    api.get<PurchaseItemSerials>(
      `/v1/stock/purchases/${purchaseId}/items/${itemId}/serials`,
    ),
  /** Adiciona um lote de seriais a uma linha já lançada. */
  addPurchaseItemSerials: (purchaseId: string, itemId: string, serials: string[]) =>
    api.post<PurchaseItemSerials>(
      `/v1/stock/purchases/${purchaseId}/items/${itemId}/serials`,
      { serials },
    ),
  /** Remove um serial adicionado por engano (só se ainda IN_STOCK, intocado). */
  removePurchaseItemSerial: (purchaseId: string, itemId: string, serialItemId: string) =>
    api.delete<PurchaseItemSerials>(
      `/v1/stock/purchases/${purchaseId}/items/${itemId}/serials/${serialItemId}`,
    ),
  /** Corrige o serial (erro de digitação) — funciona mesmo em comodato. */
  renameSerial: (serialItemId: string, serial: string) =>
    api.patch<SerialItem>(`/v1/stock/serial-items/${serialItemId}/serial`, { serial }),

  // Movements (kardex) -------------------------------------------------------
  movementsPath: (params?: ListMovementsQuery) =>
    `/v1/stock/movements${qs(params ?? {})}`,
  listMovements: (params?: ListMovementsQuery) =>
    api.get<PaginatedStock<StockMovement>>(`/v1/stock/movements${qs(params ?? {})}`),
  createAdjustment: (input: CreateAdjustmentInput) =>
    api.post<StockMovement>('/v1/stock/adjustments', input),
  createTransfer: (input: CreateStockTransferInput) =>
    api.post<StockMovement[]>('/v1/stock/transfers', input),
  /** Reverte um ajuste de inventário ou consumo em O.S lançado errado. */
  reverseMovement: (movementId: string) =>
    api.delete(`/v1/stock/movements/${movementId}`),

  // Comodato (Fase 2) --------------------------------------------------------
  comodatoByContractPath: (contractId: string) =>
    `/v1/stock/comodato/contracts/${contractId}`,
  listComodatoByContract: (contractId: string) =>
    api.get<ComodatoSerial[]>(`/v1/stock/comodato/contracts/${contractId}`),
  listComodatoAvailable: (productId?: string) =>
    api.get<ComodatoAvailableSerial[]>(
      `/v1/stock/comodato/available${productId ? `?productId=${productId}` : ''}`,
    ),
  allocateComodato: (input: AllocateComodatoInput) =>
    api.post('/v1/stock/comodato/allocate', input),
  returnComodato: (input: ReturnComodatoInput) =>
    api.post('/v1/stock/comodato/return', input),

  // OS Consumption (Fase 2) --------------------------------------------------
  osConsumptionPath: (serviceOrderId: string) =>
    `/v1/service-orders/${serviceOrderId}/consumption`,
  listOsConsumption: (serviceOrderId: string) =>
    api.get<OsConsumptionMovement[]>(`/v1/service-orders/${serviceOrderId}/consumption`),
  addOsConsumption: (serviceOrderId: string, input: AddOsConsumptionInput) =>
    api.post<StockMovement[]>(`/v1/service-orders/${serviceOrderId}/consumption`, input),

  // Serial items (patrimônios) ----------------------------------------------
  serialItemsPath: (params?: ListSerialItemsParams) =>
    `/v1/stock/serial-items${qs(params ?? {})}`,
  listSerialItems: (params?: ListSerialItemsParams) =>
    api.get<PaginatedData<SerialItem>>(`/v1/stock/serial-items${qs(params ?? {})}`),
  changeSerialStatus: (id: string, input: ChangeSerialStatusInput) =>
    api.patch<SerialItem>(`/v1/stock/serial-items/${id}/status`, input),

  // Relatório de estoque/patrimônio -----------------------------------------
  stockReportPath: (params?: StockReportParams) =>
    `/v1/stock/serial-items/report${qs(params ?? {})}`,
  stockReport: (params?: StockReportParams) =>
    api.get<StockReport>(`/v1/stock/serial-items/report${qs(params ?? {})}`),

  // Histórico (timeline) de um patrimônio -----------------------------------
  serialHistoryPath: (id: string) => `/v1/stock/serial-items/${id}/history`,
  serialHistory: (id: string) =>
    api.get<SerialHistory>(`/v1/stock/serial-items/${id}/history`),
};

export type SerialHistoryEventType =
  | 'PURCHASE'
  | 'PURCHASE_RETURN'
  | 'TRANSFER'
  | 'COMODATO_OUT'
  | 'COMODATO_RETURN'
  | 'OS_CONSUMPTION'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'SALE'
  | 'SALE_RETURN';

export interface SerialHistoryEvent {
  id: string;
  type: SerialHistoryEventType;
  date: string;
  user: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  supplier: string | null;
  invoiceNumber: string | null;
  contractCode: string | null;
  customerName: string | null;
  notes: string | null;
}

export interface SerialHistory {
  serial: string;
  product: { sku: string; name: string };
  status: SerialStatus;
  events: SerialHistoryEvent[];
}

export interface StockReportParams {
  locationId?: string;
  productId?: string;
  status?: SerialStatus;
  city?: string;
  onlyComodato?: boolean;
  search?: string;
  acquiredFrom?: string;
  acquiredTo?: string;
}

export interface StockReportItem {
  id: string;
  serial: string;
  status: SerialStatus;
  productSku: string;
  productName: string;
  locationName: string | null;
  contractCode: string | null;
  customerName: string | null;
  city: string | null;
  purchaseValue: number;
}

export interface StockReport {
  summary: { totalUnits: number; totalPurchaseValue: number };
  byProduct: Array<{
    productId: string;
    sku: string;
    name: string;
    units: number;
    purchaseValue: number;
  }>;
  byStatus: Array<{ status: SerialStatus; units: number; purchaseValue: number }>;
  byCity: Array<{ city: string | null; units: number; purchaseValue: number }>;
  items: StockReportItem[];
  truncated: boolean;
}

// =============================================================================
// SERIAL ITEMS (patrimônios)
// =============================================================================
/** Paginação no formato `data` + `pagination` (igual aos demais módulos). */
export interface PaginatedData<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export type SerialStatus =
  | 'IN_STOCK'
  | 'ALLOCATED'
  | 'IN_TRANSIT'
  | 'DEFECTIVE'
  | 'WRITTEN_OFF'
  | 'SOLD'
  | 'DISCARDED';

/** Status que o operador pode aplicar pela tela de patrimônios. */
export type SerialStatusTarget =
  | 'IN_STOCK'
  | 'DEFECTIVE'
  | 'WRITTEN_OFF'
  | 'SOLD'
  | 'DISCARDED';

export interface SerialItem {
  id: string;
  serial: string;
  /** Código de patrimônio da operação ("ZUXPAT-000123"). Null no acervo antigo. */
  assetTag: string | null;
  status: SerialStatus;
  product: { id: string; sku: string; name: string; brand: string | null; model: string | null };
  location: { id: string; name: string } | null;
  contract: { id: string; code: string | null } | null;
  acquisitionCost: string | null;
  acquisitionDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListSerialItemsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: SerialStatus;
  productId?: string;
  locationId?: string;
}

export interface ChangeSerialStatusInput {
  status: SerialStatusTarget;
  reason?: string;
  locationId?: string;
}

// =============================================================================
// FASE 2 — COMODATO + OS CONSUMPTION
// =============================================================================

export interface ComodatoSerial {
  id: string;
  serial: string;
  status: string;
  allocatedAt: string | null;
  contractId: string | null;
  acquisitionCost: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    brand?: string | null;
    model?: string | null;
  };
}

export interface ComodatoAvailableSerial {
  id: string;
  serial: string;
  product: { id: string; sku: string; name: string };
  location: { id: string; code: string; name: string };
}

export interface AllocateComodatoInput {
  contractId: string;
  serialItemId: string;
  notes?: string | null;
}

export interface ReturnComodatoInput {
  serialItemId: string;
  toLocationId: string;
  notes?: string | null;
}

export interface OsConsumptionMovement {
  id: string;
  productId: string;
  product?: { sku: string; name: string; unit: string };
  fromLocationId: string | null;
  fromLocation?: { code: string; name: string };
  quantity: string;
  unitCost: string;
  totalCost: string;
  notes: string | null;
  createdAt: string;
  createdBy?: { firstName: string | null; lastName: string | null; email: string };
}

export interface AddOsConsumptionInput {
  items: Array<{
    productId: string;
    locationId: string;
    quantity: number | string;
    notes?: string | null;
  }>;
}
