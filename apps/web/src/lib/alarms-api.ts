/**
 * Cliente da Central de Alarmes CPE/OLT.
 * Backend: apps/core-service/src/modules/alarms.
 */
import { api } from './api';
import type { Paginated } from './crm-types';

export type AlarmScope = 'ONT' | 'PON' | 'CTO' | 'CABLE' | 'OLT' | 'GEO';
export type IncidentStatus = 'OPEN' | 'ACK' | 'RESOLVED';
export type IncidentSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlarmRootCause =
  | 'POWER_OUTAGE'
  | 'FIBER_CUT'
  | 'OPTICAL_DEGRADED'
  | 'ISOLATED'
  | 'UNKNOWN';
export type SignalFlag = 'OK' | 'LOW' | 'HIGH';

export interface Incident {
  id: string;
  scope: AlarmScope;
  scopeRefId: string | null;
  scopeLabel: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  rootCause: AlarmRootCause;
  affectedCount: number;
  totalInScope: number;
  affectedPct: number;
  parentIncidentId: string | null;
  aiSummary: string | null;
  aiRootCause: string | null;
  firstEventAt: string;
  lastEventAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlarmPolicy {
  ctoPctThreshold: number;
  ctoMinCount: number;
  ponPctThreshold: number;
  ponMinCount: number;
  cablePctThreshold: number;
  cableMinCount: number;
  oltMinCount: number;
  geoMinCount: number;
  debounceSeconds: number;
  rxLowDbm: number;
  rxHighDbm: number;
  severityMap: Record<string, IncidentSeverity> | null;
  updatedAt: string | null;
}
export type UpdateAlarmPolicyInput = Partial<Omit<AlarmPolicy, 'updatedAt'>>;

export interface OntSignal {
  ontId: string;
  snGpon: string;
  contractCode: string | null;
  status: string;
  rxPower: number | null;
  txPower: number | null;
  flag: SignalFlag;
}
export interface CtoRssi {
  ctoId: string;
  ontCount: number;
  withReading: number;
  rxAvg: number | null;
  rxMin: number | null;
  rxMax: number | null;
  lowCount: number;
  highCount: number;
  onts: OntSignal[];
}
export interface SignalReportItem {
  ontId: string;
  snGpon: string;
  contractCode: string | null;
  rxPower: number | null;
  flag: SignalFlag;
}

export interface ListIncidentsParams {
  page?: number;
  pageSize?: number;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  scope?: AlarmScope;
  includeSuppressed?: boolean;
}

function qs(p: ListIncidentsParams = {}): string {
  const u = new URLSearchParams();
  if (p.page) u.set('page', String(p.page));
  if (p.pageSize) u.set('pageSize', String(p.pageSize));
  if (p.status) u.set('status', p.status);
  if (p.severity) u.set('severity', p.severity);
  if (p.scope) u.set('scope', p.scope);
  if (p.includeSuppressed) u.set('includeSuppressed', 'true');
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const alarmsApi = {
  listIncidents: (p: ListIncidentsParams = {}) =>
    api.get<Paginated<Incident>>(`/v1/alarms/incidents${qs(p)}`),
  getIncident: (id: string) => api.get<Incident>(`/v1/alarms/incidents/${id}`),
  ack: (id: string) => api.post<Incident>(`/v1/alarms/incidents/${id}/ack`, {}),
  resolve: (id: string) => api.post<Incident>(`/v1/alarms/incidents/${id}/resolve`, {}),
  getPolicy: () => api.get<AlarmPolicy>('/v1/alarms/policy'),
  updatePolicy: (body: UpdateAlarmPolicyInput) => api.patch<AlarmPolicy>('/v1/alarms/policy', body),
  rssiByCto: (ctoId: string) => api.get<CtoRssi>(`/v1/alarms/rssi/cto/${ctoId}`),
  signalReport: () => api.get<SignalReportItem[]>('/v1/alarms/signal-report'),
};
