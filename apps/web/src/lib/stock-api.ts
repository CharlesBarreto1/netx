/**
 * Cliente tipado para os endpoints do módulo de Estoque (Fase 1).
 * Rotas proxiadas pelo gateway em `/api/v1/stock/*`.
 *
 * Convenção: types mantidos aqui (mirror dos schemas em @netx/shared/stock).
 * Importar do @netx/shared direto aceitaria mas exige build do shared antes
 * do web — manter aqui dispensa essa dependência em dev.
 */
import { api } from './api';
import type { Paginated } from './crm-types';

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

export interface CreatePurchaseInput {
  supplierId: string;
  invoiceNumber?: string | null;
  date: string; // ISO
  notes?: string | null;
  items: PurchaseItemInput[];
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
  items: Array<{
    id: string;
    productId: string;
    productName?: string;
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
  setLocationAccess: (id: string, input: SetLocationAccessInput) =>
    api.put<void>(`/v1/stock/locations/${id}/access`, input),

  // Purchases ----------------------------------------------------------------
  purchasesPath: () => `/v1/stock/purchases`,
  listPurchases: () => api.get<Paginated<Purchase>>('/v1/stock/purchases'),
  getPurchase: (id: string) => api.get<Purchase>(`/v1/stock/purchases/${id}`),
  createPurchase: (input: CreatePurchaseInput) =>
    api.post<Purchase>('/v1/stock/purchases', input),

  // Movements (kardex) -------------------------------------------------------
  movementsPath: (params?: ListMovementsQuery) =>
    `/v1/stock/movements${qs(params ?? {})}`,
  listMovements: (params?: ListMovementsQuery) =>
    api.get<Paginated<StockMovement>>(`/v1/stock/movements${qs(params ?? {})}`),
  createAdjustment: (input: CreateAdjustmentInput) =>
    api.post<StockMovement>('/v1/stock/adjustments', input),
  createTransfer: (input: CreateStockTransferInput) =>
    api.post<StockMovement[]>('/v1/stock/transfers', input),

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
};

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
