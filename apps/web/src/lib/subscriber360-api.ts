/**
 * Client do BFF "Assinante 360" (read-only) + busca de clientes pro console do
 * atendente. Endpoints atrás do gateway → core-service:
 *   GET /v1/field/subscriber360/:customerId
 *   GET /v1/customers?search=&pageSize=
 * Tipos locais (convenção do front — não importa DTO do @netx/shared direto).
 */
import { api } from './api';

export interface S360Customer {
  id: string;
  code: string | null;
  displayName: string;
  type: 'INDIVIDUAL' | 'COMPANY';
  status: string;
  primaryPhone: string | null;
  primaryEmail: string | null;
}

export interface S360Ont {
  id: string;
  snGpon: string;
  status: string;
  lastRxPowerDbm: number | null;
  lastTxPowerDbm: number | null;
  lastSeenAt: string | null;
}

export interface S360Contract {
  id: string;
  code: string | null;
  status: string;
  authMethod: string;
  planName: string | null;
  monthlyValue: number;
  bandwidthMbps: number;
  uploadMbps: number | null;
  pppoeUsername: string | null;
  installationAddress: string;
  latitude: number | null;
  longitude: number | null;
  activatedAt: string | null;
  connection: { online: boolean; radiusIdentifier: string | null };
  ont: S360Ont | null;
  opticalPort: { enclosureCode: string; number: number } | null;
}

export interface S360Invoice {
  id: string;
  contractId: string;
  amount: number;
  dueDate: string;
  status: 'OPEN' | 'OVERDUE';
}

export interface S360ServiceOrder {
  id: string;
  code: string | null;
  status: string;
  displayStatus: string;
  reasonName: string;
  scheduledAt: string | null;
  openedAt: string;
}

export interface Subscriber360 {
  customer: S360Customer;
  contracts: S360Contract[];
  openInvoices: S360Invoice[];
  recentServiceOrders: S360ServiceOrder[];
  balanceDue: number;
  generatedAt: string;
}

export interface CustomerSearchItem {
  id: string;
  displayName: string;
  code: string | null;
  primaryPhone: string | null;
}

interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export function subscriber360Path(customerId: string) {
  return `/v1/field/subscriber360/${customerId}`;
}

export function getSubscriber360(customerId: string) {
  return api.get<Subscriber360>(subscriber360Path(customerId));
}

export async function searchCustomers(query: string): Promise<CustomerSearchItem[]> {
  if (!query.trim()) return [];
  const res = await api.get<Paginated<CustomerSearchItem>>(
    `/v1/customers?search=${encodeURIComponent(query)}&pageSize=10`,
  );
  return res.data ?? [];
}
