import { z } from 'zod';

/**
 * Contrato de EVENTOS assíncronos publicados pelo device-gateway no canal pub/sub
 * (traps SNMP / syslog normalizados, progresso de job). A API assina e repassa via WebSocket.
 */

export const EventSeverity = z.enum(['info', 'warning', 'error', 'critical']);
export type EventSeverity = z.infer<typeof EventSeverity>;

/** Evento normalizado de equipamento (trap/syslog) que vira linha em `Event`. */
export const DeviceEventSchema = z.object({
  deviceId: z.string().uuid(),
  severity: EventSeverity,
  type: z.string().min(1),
  message: z.string(),
  ts: z.string().datetime(),
});
export type DeviceEvent = z.infer<typeof DeviceEventSchema>;

/** Progresso de um job de longa duração, para feedback ao operador na UI. */
export const JobProgressSchema = z.object({
  jobId: z.string().uuid(),
  deviceId: z.string().uuid(),
  phase: z.string(),
  pct: z.number().min(0).max(100).optional(),
  ts: z.string().datetime(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;
