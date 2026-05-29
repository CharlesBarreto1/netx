/**
 * Cliente tipado dos endpoints da Frota. Rotas proxiadas pelo gateway em
 * `/api/v1/fleet/*`. Types espelham os schemas de @netx/shared/fleet (mantidos
 * aqui pra dispensar build do shared antes do web em dev — mesma convenção do
 * stock-api).
 */
import { api } from './api';

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

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
// VEÍCULOS
// =============================================================================
export type VehicleType = 'CAR' | 'MOTORCYCLE' | 'TRUCK' | 'VAN' | 'PICKUP' | 'OTHER';
export type VehicleStatus = 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';

export interface Vehicle {
  id: string;
  tenantId: string;
  plate: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  type: VehicleType;
  color: string | null;
  renavam: string | null;
  chassis: string | null;
  status: VehicleStatus;
  trackerUniqueId: string | null;
  odometer: number;
  notes: string | null;
  currentDriverId: string | null;
  createdAt: string;
  updatedAt: string;
  currentDriver?: { id: string; name: string } | null;
}

export interface CreateVehicleInput {
  plate: string;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  type?: VehicleType;
  color?: string | null;
  renavam?: string | null;
  chassis?: string | null;
  status?: VehicleStatus;
  trackerUniqueId?: string | null;
  odometer?: number;
  notes?: string | null;
  currentDriverId?: string | null;
}
export type UpdateVehicleInput = Partial<CreateVehicleInput>;

export interface ListVehiclesParams {
  search?: string;
  status?: VehicleStatus;
  type?: VehicleType;
  hasTracker?: boolean;
  page?: number;
  pageSize?: number;
}

// =============================================================================
// MOTORISTAS
// =============================================================================
export type DriverStatus = 'ACTIVE' | 'INACTIVE';

export interface Driver {
  id: string;
  tenantId: string;
  name: string;
  document: string | null;
  licenseNumber: string | null;
  licenseCategory: string | null;
  licenseExpiry: string | null;
  phone: string | null;
  status: DriverStatus;
  userId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDriverInput {
  name: string;
  document?: string | null;
  licenseNumber?: string | null;
  licenseCategory?: string | null;
  licenseExpiry?: string | null;
  phone?: string | null;
  status?: DriverStatus;
  userId?: string | null;
  notes?: string | null;
}
export type UpdateDriverInput = Partial<CreateDriverInput>;

// =============================================================================
// DESPESAS
// =============================================================================
export type FleetExpenseType =
  | 'FUEL'
  | 'TOLL'
  | 'FINE'
  | 'INSURANCE'
  | 'REPAIR'
  | 'TAX'
  | 'OTHER';

export interface FleetExpense {
  id: string;
  tenantId: string;
  vehicleId: string;
  driverId: string | null;
  type: FleetExpenseType;
  amount: number;
  occurredAt: string;
  odometer: number | null;
  description: string | null;
  cashRegisterId: string | null;
  cashMovementId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  vehicle?: { id: string; plate: string } | null;
  driver?: { id: string; name: string } | null;
  cashRegister?: { id: string; name: string } | null;
}

export interface CreateFleetExpenseInput {
  vehicleId: string;
  driverId?: string | null;
  type: FleetExpenseType;
  amount: number;
  occurredAt: string; // ISO datetime
  odometer?: number | null;
  description?: string | null;
  cashRegisterId?: string | null;
}
export type UpdateFleetExpenseInput = Partial<CreateFleetExpenseInput>;

export interface ListExpensesParams {
  vehicleId?: string;
  driverId?: string;
  type?: FleetExpenseType;
  cashRegisterId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

// =============================================================================
// MANUTENÇÕES
// =============================================================================
export type MaintenanceKind =
  | 'OIL_CHANGE'
  | 'REVISION'
  | 'TIRES'
  | 'BRAKES'
  | 'FILTERS'
  | 'ALIGNMENT'
  | 'OTHER';

export type MaintenanceDueStatus = 'OK' | 'DUE_SOON' | 'OVERDUE' | 'UNKNOWN';

export interface MaintenancePlan {
  id: string;
  tenantId: string;
  vehicleId: string;
  kind: MaintenanceKind;
  description: string | null;
  intervalKm: number | null;
  intervalDays: number | null;
  lastServiceOdometer: number | null;
  lastServiceDate: string | null;
  nextDueOdometer: number | null;
  nextDueDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  dueStatus: MaintenanceDueStatus;
  kmRemaining: number | null;
  daysRemaining: number | null;
  vehicle?: { id: string; plate: string; odometer: number } | null;
}

export interface CreateMaintenancePlanInput {
  vehicleId: string;
  kind: MaintenanceKind;
  description?: string | null;
  intervalKm?: number | null;
  intervalDays?: number | null;
  lastServiceOdometer?: number | null;
  lastServiceDate?: string | null;
  active?: boolean;
}
export type UpdateMaintenancePlanInput = Partial<Omit<CreateMaintenancePlanInput, 'vehicleId'>>;

export interface MaintenanceRecord {
  id: string;
  tenantId: string;
  vehicleId: string;
  planId: string | null;
  kind: MaintenanceKind;
  performedAt: string;
  odometer: number | null;
  cost: number | null;
  workshop: string | null;
  description: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  vehicle?: { id: string; plate: string } | null;
}

export interface CreateMaintenanceRecordInput {
  vehicleId: string;
  planId?: string | null;
  kind: MaintenanceKind;
  performedAt: string; // YYYY-MM-DD
  odometer?: number | null;
  cost?: number | null;
  workshop?: string | null;
  description?: string | null;
}

// =============================================================================
// AO VIVO
// =============================================================================
export type LiveVehicleStatus = 'MOVING' | 'STOPPED' | 'OFFLINE';

export interface LivePosition {
  vehicleId: string;
  plate: string;
  label: string;
  trackerUniqueId: string | null;
  latitude: number;
  longitude: number;
  speed: number | null;
  course: number | null;
  address: string | null;
  deviceTime: string;
  serverTime: string;
  status: LiveVehicleStatus;
  driverName: string | null;
}

export interface FleetLive {
  positions: LivePosition[];
  generatedAt: string;
  trackedVehicles: number;
  traccarConfigured: boolean;
}

// =============================================================================
// API CLIENT
// =============================================================================
export const fleetApi = {
  // Veículos -----------------------------------------------------------------
  vehiclesPath: (p?: ListVehiclesParams) => `/v1/fleet/vehicles${qs(p ?? {})}`,
  listVehicles: (p?: ListVehiclesParams) =>
    api.get<Paginated<Vehicle>>(`/v1/fleet/vehicles${qs(p ?? {})}`),
  getVehicle: (id: string) => api.get<Vehicle>(`/v1/fleet/vehicles/${id}`),
  createVehicle: (input: CreateVehicleInput) => api.post<Vehicle>('/v1/fleet/vehicles', input),
  updateVehicle: (id: string, input: UpdateVehicleInput) =>
    api.patch<Vehicle>(`/v1/fleet/vehicles/${id}`, input),
  deleteVehicle: (id: string) => api.delete(`/v1/fleet/vehicles/${id}`),

  // Motoristas ---------------------------------------------------------------
  driversPath: (p?: { search?: string; status?: DriverStatus; pageSize?: number }) =>
    `/v1/fleet/drivers${qs(p ?? {})}`,
  listDrivers: (p?: { search?: string; status?: DriverStatus; pageSize?: number }) =>
    api.get<Paginated<Driver>>(`/v1/fleet/drivers${qs(p ?? {})}`),
  createDriver: (input: CreateDriverInput) => api.post<Driver>('/v1/fleet/drivers', input),
  updateDriver: (id: string, input: UpdateDriverInput) =>
    api.patch<Driver>(`/v1/fleet/drivers/${id}`, input),
  deleteDriver: (id: string) => api.delete(`/v1/fleet/drivers/${id}`),

  // Despesas -----------------------------------------------------------------
  expensesPath: (p?: ListExpensesParams) => `/v1/fleet/expenses${qs(p ?? {})}`,
  listExpenses: (p?: ListExpensesParams) =>
    api.get<Paginated<FleetExpense>>(`/v1/fleet/expenses${qs(p ?? {})}`),
  createExpense: (input: CreateFleetExpenseInput) =>
    api.post<FleetExpense>('/v1/fleet/expenses', input),
  updateExpense: (id: string, input: UpdateFleetExpenseInput) =>
    api.patch<FleetExpense>(`/v1/fleet/expenses/${id}`, input),
  deleteExpense: (id: string) => api.delete(`/v1/fleet/expenses/${id}`),

  // Manutenções --------------------------------------------------------------
  plansPath: (p?: { vehicleId?: string; active?: boolean; dueOnly?: boolean; pageSize?: number }) =>
    `/v1/fleet/maintenance/plans${qs(p ?? {})}`,
  listPlans: (p?: { vehicleId?: string; active?: boolean; dueOnly?: boolean; pageSize?: number }) =>
    api.get<Paginated<MaintenancePlan>>(`/v1/fleet/maintenance/plans${qs(p ?? {})}`),
  createPlan: (input: CreateMaintenancePlanInput) =>
    api.post<MaintenancePlan>('/v1/fleet/maintenance/plans', input),
  updatePlan: (id: string, input: UpdateMaintenancePlanInput) =>
    api.patch<MaintenancePlan>(`/v1/fleet/maintenance/plans/${id}`, input),
  deletePlan: (id: string) => api.delete(`/v1/fleet/maintenance/plans/${id}`),

  recordsPath: (p?: { vehicleId?: string; planId?: string; pageSize?: number }) =>
    `/v1/fleet/maintenance/records${qs(p ?? {})}`,
  listRecords: (p?: { vehicleId?: string; planId?: string; pageSize?: number }) =>
    api.get<Paginated<MaintenanceRecord>>(`/v1/fleet/maintenance/records${qs(p ?? {})}`),
  createRecord: (input: CreateMaintenanceRecordInput) =>
    api.post<MaintenanceRecord>('/v1/fleet/maintenance/records', input),

  // Ao vivo ------------------------------------------------------------------
  livePath: () => `/v1/fleet/live/positions`,
  getLive: () => api.get<FleetLive>('/v1/fleet/live/positions'),
};

// =============================================================================
// LABELS (pt-BR) — reuso entre páginas
// =============================================================================
export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  CAR: 'Carro',
  MOTORCYCLE: 'Moto',
  TRUCK: 'Caminhão',
  VAN: 'Van',
  PICKUP: 'Pickup',
  OTHER: 'Outro',
};

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  ACTIVE: 'Ativo',
  MAINTENANCE: 'Em manutenção',
  INACTIVE: 'Inativo',
};

export const EXPENSE_TYPE_LABELS: Record<FleetExpenseType, string> = {
  FUEL: 'Combustível',
  TOLL: 'Pedágio',
  FINE: 'Multa',
  INSURANCE: 'Seguro',
  REPAIR: 'Reparo',
  TAX: 'Imposto/Taxa',
  OTHER: 'Outro',
};

export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = {
  OIL_CHANGE: 'Troca de óleo',
  REVISION: 'Revisão',
  TIRES: 'Pneus',
  BRAKES: 'Freios',
  FILTERS: 'Filtros',
  ALIGNMENT: 'Alinhamento',
  OTHER: 'Outro',
};
