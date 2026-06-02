/**
 * DTOs e limiares de diagnóstico TR-069 (monitoramento proativo de CPEs).
 *
 * Fonte da verdade dos LIMIARES ópticos/Wi-Fi: usados pelo ACS (apps/cwmp-server,
 * que mantém uma cópia local — não depende de @netx/shared), pelo core-service
 * (endpoints + cron) e espelhados no front pra colorir os cards.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { z } from 'zod';

// =============================================================================
// Enums (espelham os enums do Prisma)
// =============================================================================
export type Tr069OpticalHealth = 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

export type Tr069AlertType =
  | 'OPTICAL_RX_LOW'
  | 'OPTICAL_RX_HIGH'
  | 'OPTICAL_TX_ABNORMAL'
  | 'DEVICE_OFFLINE'
  | 'WIFI_WEAK_CLIENT'
  | 'WIFI_HIGH_UTIL';

export type Tr069AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type Tr069AlertStatus = 'OPEN' | 'RESOLVED';

// =============================================================================
// Limiares ópticos GPON (dBm, já normalizados) — receptor da ONT
// =============================================================================
/**
 * Faixa de potência de recepção (RX) saudável num receptor GPON Class B+:
 * tipicamente entre -8 e -27 dBm. Fora disso o link degrada (fraco demais →
 * perda de pacote/LOS; forte demais → satura o fotodiodo).
 */
export const OPTICAL_RX_THRESHOLDS = {
  /** Acima disso o sinal é forte demais (falta atenuador) — crítico. */
  critHigh: -5,
  /** Zona de atenção no lado forte. */
  warnHigh: -8,
  /** Zona de atenção no lado fraco. */
  warnLow: -25,
  /** Abaixo disso o link está à beira de cair (LOS) — crítico. */
  critLow: -27,
} as const;

/** Faixa de potência de transmissão (TX) normal da ONT (dBm). */
export const OPTICAL_TX_THRESHOLDS = {
  min: 0.0,
  max: 7.0,
} as const;

/** RSSI (dBm) abaixo do qual um cliente Wi-Fi é considerado mal coberto. */
export const WIFI_WEAK_RSSI_DBM = -75;

/**
 * Classifica a saúde do RX óptico. `rx` em dBm normalizado, ou null se a ONT
 * não reportou. Usado pra colorir a UI e definir a severidade do alerta.
 */
export function classifyRxPower(rx: number | null | undefined): Tr069OpticalHealth {
  if (rx === null || rx === undefined || Number.isNaN(rx)) return 'UNKNOWN';
  const t = OPTICAL_RX_THRESHOLDS;
  if (rx < t.critLow || rx > t.critHigh) return 'CRITICAL';
  if (rx < t.warnLow || rx > t.warnHigh) return 'WARNING';
  return 'OK';
}

/** True se a potência TX da ONT está fora da faixa esperada. */
export function isTxPowerAbnormal(tx: number | null | undefined): boolean {
  if (tx === null || tx === undefined || Number.isNaN(tx)) return false;
  return tx < OPTICAL_TX_THRESHOLDS.min || tx > OPTICAL_TX_THRESHOLDS.max;
}

// =============================================================================
// Query schemas
// =============================================================================
export const ListTr069AlertsQuerySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED']).optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  deviceId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListTr069AlertsQuery = z.infer<typeof ListTr069AlertsQuerySchema>;

export const ListTr069DiagnosticsQuerySchema = z.object({
  /** Quantos pontos da série retornar (mais recente primeiro). */
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type ListTr069DiagnosticsQuery = z.infer<typeof ListTr069DiagnosticsQuerySchema>;

// =============================================================================
// Response DTOs
// =============================================================================
export interface Tr069WifiClient {
  mac: string | null;
  band: string;
  rssi: number | null;
  txRate: number | null;
  rxRate: number | null;
}

export interface Tr069DiagnosticDto {
  id: string;
  capturedAt: string;
  rxPower: number | null;
  txPower: number | null;
  temperature: number | null;
  voltage: number | null;
  biasCurrent: number | null;
  opticalHealth: Tr069OpticalHealth;
  wifiClients24: number | null;
  wifiClients5: number | null;
  wifiChannel24: number | null;
  wifiChannel5: number | null;
  wifiWorstRssi: number | null;
  wifiClients: Tr069WifiClient[];
}

export interface Tr069AlertDto {
  id: string;
  deviceId: string;
  type: Tr069AlertType;
  severity: Tr069AlertSeverity;
  status: Tr069AlertStatus;
  message: string;
  value: number | null;
  openedAt: string;
  resolvedAt: string | null;
  lastSeenAt: string;
  /** Enriquecido quando listado fora do contexto de um device. */
  device?: { id: string; deviceId: string; ontSnGpon: string | null } | null;
}

export interface Tr069TaskDto {
  id: string;
  action: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Tr069DeviceDetailResponse {
  id: string;
  deviceId: string;
  manufacturer: string | null;
  oui: string | null;
  productClass: string | null;
  hardwareVersion: string | null;
  softwareVersion: string | null;
  status: string;
  lastInformAt: string | null;
  lastInformReason: string | null;
  lastDiagnosticAt: string | null;
  connectionRequestUrl: string | null;
  ont: {
    id: string;
    snGpon: string;
    contractId: string;
    status: string;
    lastRxPower: string | null;
    lastTxPower: string | null;
  } | null;
  latest: Tr069DiagnosticDto | null;
  openAlerts: Tr069AlertDto[];
  recentTasks: Tr069TaskDto[];
}

export interface Tr069RefreshResponse {
  taskId: string;
  message: string;
}
