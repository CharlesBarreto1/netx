/**
 * Cliente do painel do NOC.
 *
 * Difere do `nms-api.ts`: aquele fala com o módulo NMS via gateway
 * (`/v1/nms/*`); este fala com o CORE (`/v1/nms-dashboard`), porque o painel
 * agrega dados que só existem no banco do Core — sessões RADIUS, planta óptica,
 * OLTs e incidentes. O Core é quem busca a telemetria da frota no NMS e devolve
 * tudo junto, num instante só.
 *
 * Os tipos espelham `apps/core-service/src/modules/nms-dashboard/
 * nms-dashboard.types.ts`. Mantê-los em sincronia é manual — o Core é um build
 * separado e não exporta estes tipos por @netx/shared.
 */
import { api } from './api';

export type DashboardAlarmSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type DashboardAlarmKind =
  | 'PPPOE_DROP'
  | 'TRAFFIC_DROP'
  | 'TRAFFIC_SPIKE'
  | 'DEVICES_OFFLINE'
  | 'OLT_OFFLINE'
  | 'OPTICAL_CRITICAL'
  | 'STALE_TELEMETRY';

export interface DashboardAlarm {
  kind: DashboardAlarmKind;
  severity: DashboardAlarmSeverity;
  title: string;
  detail: string;
}

export interface SnapshotPoint {
  t: string;
  activeSessions: number;
  totalInBps: number | null;
  totalOutBps: number | null;
}

export interface SessionsPanel {
  active: number;
  contracts: number;
  baseline: number | null;
  deltaPct: number | null;
  at: string;
}

export interface TrafficPanel {
  inBps: number | null;
  outBps: number | null;
  baselineBps: number | null;
  deltaPct: number | null;
  series: SnapshotPoint[];
}

export interface DevicesPanel {
  total: number | null;
  online: number | null;
  offline: number | null;
  desynced: number;
  staleTelemetry: number;
}

export interface OltHealthItem {
  id: string;
  name: string;
  vendor: string;
  status: string;
  lastSeenAt: string | null;
  ontsTotal: number;
  ontsOnline: number;
  ontsOffline: number;
}

export interface OltPanel {
  total: number;
  online: number;
  offline: number;
  items: OltHealthItem[];
}

export interface OpticalPanel {
  measured: number;
  ok: number;
  low: number;
  high: number;
  critical: number;
  rxLowDbm: number;
  rxHighDbm: number;
  worst: Array<{
    ontId: string;
    contractId: string;
    snGpon: string;
    oltName: string;
    rxDbm: number | null;
    status: string;
  }>;
}

export interface CapacityPanel {
  topDevices: Array<{ id: string; hostname: string; site: string | null; totalBps: number }>;
  saturated: Array<{
    deviceId: string;
    hostname: string;
    ifName: string;
    utilPct: number;
    inBps: number;
    outBps: number;
    speedBps: number;
  }>;
  hot: Array<{ id: string; hostname: string; cpuPct: number | null; tempC: number | null }>;
}

export interface DashboardIncident {
  id: string;
  scope: string;
  scopeLabel: string;
  severity: string;
  rootCause: string;
  affectedCount: number;
  totalInScope: number;
  affectedPct: number;
  firstEventAt: string;
  lastEventAt: string;
}

export interface NmsDashboard {
  generatedAt: string;
  alarms: DashboardAlarm[];
  sessions: SessionsPanel;
  traffic: TrafficPanel;
  devices: DevicesPanel;
  optical: OpticalPanel;
  olts: OltPanel;
  capacity: CapacityPanel;
  incidents: DashboardIncident[];
  nmsAvailable: boolean;
}

export const nmsDashboardApi = {
  get: () => api.get<NmsDashboard>('/v1/nms-dashboard'),
};
