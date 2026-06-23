/**
 * DTOs da Central de Alarmes (CPE/OLT) — incidents correlacionados + policy.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { z } from 'zod';

export const ALARM_SCOPES = ['ONT', 'PON', 'CTO', 'CABLE', 'OLT', 'GEO'] as const;
export const AlarmScopeSchema = z.enum(ALARM_SCOPES);
export type AlarmScope = z.infer<typeof AlarmScopeSchema>;

export const INCIDENT_STATUSES = ['OPEN', 'ACK', 'RESOLVED'] as const;
export const IncidentStatusSchema = z.enum(INCIDENT_STATUSES);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const INCIDENT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export const IncidentSeveritySchema = z.enum(INCIDENT_SEVERITIES);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

export const ALARM_ROOT_CAUSES = [
  'POWER_OUTAGE',
  'FIBER_CUT',
  'OPTICAL_DEGRADED',
  'ISOLATED',
  'UNKNOWN',
] as const;
export const AlarmRootCauseSchema = z.enum(ALARM_ROOT_CAUSES);
export type AlarmRootCause = z.infer<typeof AlarmRootCauseSchema>;

export interface IncidentResponse {
  id: string;
  tenantId: string;
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
  /** Resumo gerado por IA (Fase 4) — null até a IA processar. */
  aiSummary: string | null;
  aiRootCause: string | null;
  firstEventAt: string;
  lastEventAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ListIncidentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: IncidentStatusSchema.optional(),
  severity: IncidentSeveritySchema.optional(),
  scope: AlarmScopeSchema.optional(),
  /** Inclui incidents suprimidos (com parentIncidentId). Default false. */
  includeSuppressed: z.coerce.boolean().default(false),
});
export type ListIncidentsQuery = z.infer<typeof ListIncidentsQuerySchema>;

// ── AlarmPolicy (config por tenant) ─────────────────────────────────────────
export interface AlarmPolicyResponse {
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

// ── RSSI / sinal (F5) ───────────────────────────────────────────────────────
export type SignalFlag = 'OK' | 'LOW' | 'HIGH';

export interface OntSignal {
  ontId: string;
  snGpon: string;
  contractCode: string | null;
  status: string;
  rxPower: number | null;
  txPower: number | null;
  flag: SignalFlag;
}

export interface CtoRssiResponse {
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

const pct = z.coerce.number().int().min(0).max(100);
const count = z.coerce.number().int().min(1).max(10_000);

export const UpdateAlarmPolicySchema = z
  .object({
    ctoPctThreshold: pct.optional(),
    ctoMinCount: count.optional(),
    ponPctThreshold: pct.optional(),
    ponMinCount: count.optional(),
    cablePctThreshold: pct.optional(),
    cableMinCount: count.optional(),
    oltMinCount: count.optional(),
    geoMinCount: count.optional(),
    debounceSeconds: z.coerce.number().int().min(5).max(600).optional(),
    rxLowDbm: z.coerce.number().min(-60).max(0).optional(),
    rxHighDbm: z.coerce.number().min(-60).max(10).optional(),
    severityMap: z.record(z.string(), IncidentSeveritySchema).nullish(),
  })
  .strict();
export type UpdateAlarmPolicy = z.infer<typeof UpdateAlarmPolicySchema>;
