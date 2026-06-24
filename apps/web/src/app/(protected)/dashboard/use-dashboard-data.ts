'use client';

/**
 * Fonte de dados REAIS do cockpit (dashboard de 3 lentes).
 *
 * Cada bloco do dashboard cai em um de dois grupos:
 *  - TEM endpoint → buscamos aqui via SWR (gated por permissão) e a página usa
 *    o valor real;
 *  - NÃO TEM fonte ainda (telemetria de NOC: tráfego/latência/uptime/saúde por
 *    região; aging por faixa; churn) → a página mantém o mock, marcado como
 *    "exemplo".
 *
 * Tudo é gated por permissão e degrada de forma graciosa: se o usuário não tem
 * a permissão (ou o módulo, ex.: `netx-cpe` para alarmes) o hook não dispara a
 * chamada e o campo fica `undefined` — a página então cai no mock marcado.
 */

import useSWR from 'swr';

import { hasPermission } from '@/lib/session';

// ── Formas de resposta (subset do que consumimos) ─────────────────────────
interface Paginated {
  pagination: { total: number };
}

interface OnlineSnapshot {
  online: number;
  offline: number;
  totalActive: number;
  snapshotAt: string;
}

interface Bucket {
  count: number;
  amount: number;
}
interface FinanceReport {
  open: Bucket;
  overdue: Bucket;
  receivedInPeriod: Bucket;
}

interface ForecastReport {
  monthlyBaseline: number;
}

export interface IncidentItem {
  id: string;
  scope: string;
  scopeLabel: string | null;
  severity: string;
  status: string;
  rootCause: string | null;
  affectedCount: number;
  totalInScope: number;
  affectedPct: number;
  firstEventAt: string;
  lastEventAt: string;
}
interface IncidentList {
  data: IncidentItem[];
  pagination?: { total: number };
}

export interface RecentInvoice {
  id: string;
  amount: number;
  dueDate: string;
  status: string;
  contract?: { code: string | null; pppoeUsername: string | null; customerId: string };
}
interface InvoiceList {
  data: RecentInvoice[];
  pagination: { total: number };
}

interface OltOption {
  id: string;
  name: string;
  vendor: string;
}

// SWR só dispara quando a key é não-nula (padrão condicional do SWR).
const gate = (perm: string, key: string): string | null =>
  hasPermission(perm) ? key : null;

export interface DashboardLive {
  /** Carregando enquanto qualquer chamada gated ainda não respondeu. */
  loading: boolean;

  activeContracts?: number;
  overdueCount?: number;
  online?: OnlineSnapshot;
  finance?: FinanceReport;
  monthlyBaseline?: number;
  incidents?: IncidentList;
  serviceOrdersOpen?: number;
  serviceOrdersOverdue?: number;
  oltCount?: number;
  recentInvoices?: RecentInvoice[];
}

/**
 * Lê apenas os endpoints relevantes para a lente atual — evita disparar 10
 * chamadas quando só uma lente está visível. Quem não tem fonte real não
 * aparece aqui (a página resolve com mock marcado).
 */
export function useDashboardData(lens: 'operador' | 'noc' | 'financeiro'): DashboardLive {
  const wantsBilling = lens === 'operador' || lens === 'financeiro';
  const wantsNoc = lens === 'operador' || lens === 'noc';

  // Assinantes ativos = contratos ACTIVE.
  const contracts = useSWR<Paginated>(
    wantsBilling ? gate('contracts.read', '/v1/contracts?status=ACTIVE&pageSize=1') : null,
  );
  // Inadimplência = faturas vencidas.
  const overdue = useSWR<Paginated>(
    wantsBilling ? gate('contracts.read', '/v1/contract-invoices?status=OVERDUE&pageSize=1') : null,
  );
  // Recebíveis agregados (em aberto / vencido / recebido no período).
  const finance = useSWR<FinanceReport>(
    wantsBilling ? gate('reports.read', '/v1/reports/finance') : null,
  );
  // MRR baseline = soma do monthlyValue dos contratos ativos.
  const forecast = useSWR<ForecastReport>(
    wantsBilling ? gate('reports.read', '/v1/reports/forecast?months=1') : null,
  );
  // Faturas recentes (lente financeira).
  const recent = useSWR<InvoiceList>(
    lens === 'financeiro' ? gate('contracts.read', '/v1/contract-invoices?pageSize=5') : null,
  );

  // Snapshot online/offline — refresh espaçado (cross join pesado no DB).
  const online = useSWR<OnlineSnapshot>(
    wantsNoc ? gate('contracts.read', '/v1/radius/stats/online') : null,
    { refreshInterval: 30 * 60 * 1000, dedupingInterval: 5 * 60 * 1000 },
  );
  // Incidentes/alarmes abertos — módulo netx-cpe; sem o módulo a chamada erra
  // e o campo fica undefined (página cai no mock marcado).
  const incidents = useSWR<IncidentList>(
    wantsNoc ? gate('provisioning.read', '/v1/alarms/incidents?status=OPEN&pageSize=10') : null,
    { shouldRetryOnError: false },
  );
  // OLTs ativas (contagem).
  const olts = useSWR<OltOption[]>(
    wantsNoc ? gate('network.read', '/v1/optical/olts') : null,
  );

  // O.S abertas / vencidas (lente operador).
  const soOpen = useSWR<Paginated>(
    lens === 'operador' ? gate('service_orders.read', '/v1/service-orders?status=OPEN&pageSize=1') : null,
  );
  const soOverdue = useSWR<Paginated>(
    lens === 'operador' ? gate('service_orders.read', '/v1/service-orders?status=OVERDUE&pageSize=1') : null,
  );

  const loading =
    contracts.isLoading ||
    overdue.isLoading ||
    finance.isLoading ||
    forecast.isLoading ||
    recent.isLoading ||
    online.isLoading ||
    incidents.isLoading ||
    olts.isLoading ||
    soOpen.isLoading ||
    soOverdue.isLoading;

  return {
    loading,
    activeContracts: contracts.data?.pagination.total,
    overdueCount: overdue.data?.pagination.total,
    online: online.data,
    finance: finance.data,
    monthlyBaseline: forecast.data?.monthlyBaseline,
    incidents: incidents.data,
    serviceOrdersOpen: soOpen.data?.pagination.total,
    serviceOrdersOverdue: soOverdue.data?.pagination.total,
    oltCount: olts.data?.length,
    recentInvoices: recent.data?.data,
  };
}
