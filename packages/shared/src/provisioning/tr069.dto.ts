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
  | 'OPTICAL_FIBER_DEGRADED'
  | 'DEVICE_OFFLINE'
  | 'WIFI_WEAK_CLIENT'
  | 'WIFI_HIGH_UTIL'
  | 'WAN_DOWN';

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

export const SpeedTestRequestSchema = z.object({
  /** URL do arquivo de teste; se omitida usa TR069_SPEEDTEST_URL. */
  url: z.string().url().max(512).optional(),
});
export type SpeedTestRequest = z.infer<typeof SpeedTestRequestSchema>;

export const PingRequestSchema = z.object({
  host: z.string().min(1).max(255),
});
export type PingRequest = z.infer<typeof PingRequestSchema>;

export type Tr069DiagKind = 'DOWNLOAD' | 'UPLOAD' | 'PING' | 'TRACEROUTE';
export type Tr069DiagState = 'REQUESTED' | 'COMPLETED' | 'ERROR';

export interface Tr069DiagRunDto {
  id: string;
  kind: Tr069DiagKind;
  state: Tr069DiagState;
  target: string | null;
  throughputKbps: number | null;
  pingSuccess: number | null;
  pingFailure: number | null;
  pingAvgMs: number | null;
  pingMinMs: number | null;
  pingMaxMs: number | null;
  errorText: string | null;
  createdAt: string;
  completedAt: string | null;
}

export const ListWifiCoverageQuerySchema = z.object({
  /** Janela de análise em dias. */
  days: z.coerce.number().int().min(1).max(90).default(7),
  /** Só lista quem tem RSSI médio ≤ este limiar (dBm). -70 = cobertura ruim. */
  maxRssi: z.coerce.number().int().min(-100).max(0).default(-70),
  /** Mínimo de amostras no período pra evitar leitura isolada. */
  minSamples: z.coerce.number().int().min(1).max(1000).default(3),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListWifiCoverageQuery = z.infer<typeof ListWifiCoverageQuerySchema>;

export interface WifiCoverageRow {
  deviceId: string;
  deviceLabel: string;
  ontSnGpon: string | null;
  contractId: string | null;
  contractCode: string | null;
  customerId: string | null;
  customerName: string | null;
  avgRssi: number | null;
  worstRssi: number | null;
  samples: number;
  lastSeenAt: string | null;
}

export const FirmwareUpgradeRequestSchema = z.object({
  /** URL HTTP(S) de onde o CPE baixa a imagem. */
  url: z.string().url().max(512),
  /** TR-069 FileType; default "1 Firmware Upgrade Image". */
  fileType: z.string().max(64).optional(),
  targetFileName: z.string().max(128).optional(),
});
export type FirmwareUpgradeRequest = z.infer<typeof FirmwareUpgradeRequestSchema>;

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

export interface Tr069LanHost {
  mac: string | null;
  ip: string | null;
  hostname: string | null;
  active: boolean | null;
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
  gponStatus: string | null;
  fecErrors: number | null;
  hecErrors: number | null;
  dropRate: number | null;
  errorRate: number | null;
  pppStatus: string | null;
  pppLastError: string | null;
  wanUptime: number | null;
  hostsCount: number | null;
  hosts: Tr069LanHost[];
  wifiClients24: number | null;
  wifiClients5: number | null;
  wifiChannel24: number | null;
  wifiChannel5: number | null;
  wifiWorstRssi: number | null;
  wifiClients: Tr069WifiClient[];
  /** Recursos do CPE (DeviceInfo): % CPU, % memória, temperatura (°C). */
  cpuUsage: number | null;
  memUsage: number | null;
  deviceTemp: number | null;
  /** Contadores de bytes da WAN PPPoE (cumulativos) — base do throughput. */
  wanRxBytes: number | null;
  wanTxBytes: number | null;
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
    macAddress: string | null;
    contractId: string;
    status: string;
    lastRxPower: string | null;
    lastTxPower: string | null;
  } | null;
  /** Cliente/contrato vinculado (via ONT) — quem é o dono do CPE. */
  customer: {
    customerId: string;
    customerName: string;
    customerStatus: string;
    contractId: string;
    contractCode: string | null;
    contractStatus: string;
    pppoeUsername: string | null;
  } | null;
  latest: Tr069DiagnosticDto | null;
  openAlerts: Tr069AlertDto[];
  recentTasks: Tr069TaskDto[];
}

export interface Tr069RefreshResponse {
  taskId: string;
  message: string;
}

// =============================================================================
// Notas do device (anotações livres do atendimento N1)
// =============================================================================
export const CreateTr069DeviceNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type CreateTr069DeviceNote = z.infer<typeof CreateTr069DeviceNoteSchema>;

export interface Tr069DeviceNoteDto {
  id: string;
  body: string;
  createdById: string | null;
  createdByEmail: string | null;
  createdAt: string;
}

// =============================================================================
// Edição de rádio Wi-Fi (canal/potência/criptografia — SET direto no CPE)
// =============================================================================
export type Tr069WifiBand = '2.4G' | '5G';
export type Tr069WifiSecurity = 'WPA2' | 'WPA_WPA2';
export type Tr069WifiWidth = 'auto' | '20' | '40' | '80' | '160';

/** Larguras de canal suportadas por banda (2.4G não faz 80/160). */
export const TR069_WIFI_WIDTHS: Record<Tr069WifiBand, Tr069WifiWidth[]> = {
  '2.4G': ['auto', '20', '40'],
  '5G': ['auto', '20', '40', '80', '160'],
};

/** Potências (%) aceitas pelo EG8145X6 (TransmitPowerSupported). */
export const TR069_WIFI_TX_POWER_LEVELS = [20, 40, 60, 80, 100] as const;

/** Canais válidos por banda (PossibleChannels — regdomain PY). */
export const TR069_WIFI_CHANNELS: Record<Tr069WifiBand, number[]> = {
  '2.4G': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  '5G': [
    36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140,
    144, 149, 153, 157, 161,
  ],
};

export const SetWifiRadioSchema = z
  .object({
    band: z.enum(['2.4G', '5G']),
    /** true = auto-canal; false = fixa o `channel`. */
    autoChannel: z.boolean().optional(),
    channel: z.coerce.number().int().min(1).max(196).optional(),
    channelWidth: z.enum(['auto', '20', '40', '80', '160']).optional(),
    txPower: z.coerce.number().int().refine((v) => [20, 40, 60, 80, 100].includes(v), {
      message: 'Potência deve ser 20, 40, 60, 80 ou 100',
    }).optional(),
    security: z.enum(['WPA2', 'WPA_WPA2']).optional(),
  })
  .refine(
    (v) =>
      v.autoChannel !== undefined ||
      v.channel !== undefined ||
      v.channelWidth !== undefined ||
      v.txPower !== undefined ||
      v.security !== undefined,
    { message: 'Informe ao menos um campo pra alterar' },
  )
  .refine((v) => !(v.autoChannel === false && v.channel === undefined), {
    message: 'Canal manual exige escolher o canal',
    path: ['channel'],
  });
export type SetWifiRadio = z.infer<typeof SetWifiRadioSchema>;

// =============================================================================
// Toggles do roteador (TimeZone + BandSteering — SET direto no CPE)
// =============================================================================
/** Offsets de fuso comuns na operação (BR/PY). */
export const TR069_ROUTER_TZ_OFFSETS = ['-02:00', '-03:00', '-04:00', '-05:00'] as const;

export const SetRouterSettingsSchema = z
  .object({
    /** Liga/desliga o cliente de horário (NTP) do CPE. */
    timeEnable: z.boolean().optional(),
    /** Offset do fuso, ex. "-04:00". */
    timeZoneOffset: z
      .string()
      .regex(/^[+-]\d{2}:\d{2}$/, 'Use o formato ±HH:MM (ex.: -04:00)')
      .optional(),
    /** Rótulo do fuso (cosmético no WebUI). */
    timeZoneName: z.string().min(1).max(64).optional(),
    /** Servidor NTP primário. */
    ntpServer: z.string().min(1).max(128).optional(),
    /** Liga/desliga band steering (2.4G/5G unificado). */
    bandSteering: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.timeEnable !== undefined ||
      v.timeZoneOffset !== undefined ||
      v.timeZoneName !== undefined ||
      v.ntpServer !== undefined ||
      v.bandSteering !== undefined,
    { message: 'Informe ao menos um campo pra alterar' },
  );
export type SetRouterSettings = z.infer<typeof SetRouterSettingsSchema>;

// =============================================================================
// Scan de vizinhança Wi-Fi (heatmap de ocupação de canais 2.4G)
// =============================================================================
export interface Tr069WifiNeighbor {
  ssid: string | null;
  bssid: string | null;
  channel: number | null;
  /** "2.4GHz" | "5GHz" */
  band: string | null;
  /** Sinal recebido (dBm). */
  signal: number | null;
  bandwidth: string | null;
  security: string | null;
}

export interface Tr069WifiScanResponse {
  /** DiagnosticsState do CPE: None | Requested | Complete | Error_... */
  state: string | null;
  /** Quando a leitura da subárvore foi concluída (task GET). */
  scannedAt: string | null;
  /** Há uma leitura (GET) ainda pendente — UI segue fazendo polling. */
  pending: boolean;
  neighbors: Tr069WifiNeighbor[];
  /** Ocupação por canal 2.4G (1–13): nº de redes vizinhas. */
  channels24: Array<{ channel: number; count: number }>;
}

// =============================================================================
// Probe de data model (ferramenta de bancada — descobrir paths Huawei reais)
// =============================================================================
/**
 * Enfileira um GetParameterValues com caminhos ARBITRÁRIOS (parciais ou
 * completos) numa ONT de bancada pra descobrir os paths reais do firmware antes
 * de codar SET. ⚠️ Huawei devolve fault no GET INTEIRO se UM nome não existir —
 * prove um caminho parcial por vez (terminando em ".").
 */
export const Tr069ProbeRequestSchema = z.object({
  names: z.array(z.string().min(3).max(255)).min(1).max(20),
});
export type Tr069ProbeRequest = z.infer<typeof Tr069ProbeRequestSchema>;

export interface Tr069ProbeResultDto {
  taskId: string;
  /** PENDING | RUNNING | DONE | FAILED | CANCELLED */
  status: string;
  error: string | null;
  /** Caminhos pedidos no probe (payload.names). */
  names: string[];
  /** name→value do GetParameterValuesResponse (null enquanto não respondido). */
  params: Array<{ name: string; value: string }> | null;
  createdAt: string;
  completedAt: string | null;
}

// =============================================================================
// Histórico do device (aba Histórico — derivado de tasks + alertas, sem coletor novo)
// =============================================================================
export type Tr069TimelineSeverity = 'ok' | 'warn' | 'crit' | 'info';

export interface Tr069DeviceHistoryResponse {
  /** Reboots e quedas por dia — janela de 14 dias, do mais antigo pro mais novo. */
  daily: Array<{ date: string; reboots: number; outages: number }>;
  /** Disponibilidade por dia (30 dias, antigo→novo) — verde/âmbar/vermelho. */
  availability: Array<'ok' | 'warn' | 'crit'>;
  /** % de dias OK na janela de 30 dias. */
  availabilityPct: number;
  /** Linha do tempo de eventos (alertas + tasks), mais recentes primeiro. */
  timeline: Array<{
    at: string;
    severity: Tr069TimelineSeverity;
    title: string;
    description: string | null;
  }>;
}

// =============================================================================
// Profiles / conformidade (motor de desired-state — Fase 2/4)
// =============================================================================
export type Tr069RuleSource =
  | 'STATIC'
  | 'CONTRACT_PPPOE_USER'
  | 'CONTRACT_PPPOE_PASS'
  | 'CONTRACT_PPPOE_VLAN'
  | 'CONTRACT_WIFI_SSID'
  | 'CONTRACT_WIFI_SSID_5G'
  | 'CONTRACT_WIFI_PASS'
  | 'TENANT_ACCESS_PASSWORD';

export type Tr069RuleMode = 'ENFORCE' | 'REPORT_ONLY';

export type Tr069ComplianceStatus =
  | 'UNKNOWN'
  | 'COMPLIANT'
  | 'DRIFTED'
  | 'REMEDIATING'
  | 'PENDING_REBOOT'
  | 'FAILED';

export type Tr069DriftStatus =
  | 'OPEN'
  | 'REMEDIATING'
  | 'PENDING_REBOOT'
  | 'RESOLVED'
  | 'FAILED';

/** Rótulos legíveis das origens de valor (pro select no portal). */
export const TR069_RULE_SOURCE_LABELS: Record<Tr069RuleSource, string> = {
  STATIC: 'Valor fixo',
  CONTRACT_PPPOE_USER: 'PPPoE — usuário (contrato)',
  CONTRACT_PPPOE_PASS: 'PPPoE — senha (contrato)',
  CONTRACT_PPPOE_VLAN: 'PPPoE — VLAN (contrato)',
  CONTRACT_WIFI_SSID: 'Wi-Fi — SSID 2.4G (contrato)',
  CONTRACT_WIFI_SSID_5G: 'Wi-Fi — SSID 5G (contrato)',
  CONTRACT_WIFI_PASS: 'Wi-Fi — senha (contrato)',
  TENANT_ACCESS_PASSWORD: 'Senha de acesso (config da instância)',
};

export const Tr069RuleSourceSchema = z.enum([
  'STATIC',
  'CONTRACT_PPPOE_USER',
  'CONTRACT_PPPOE_PASS',
  'CONTRACT_PPPOE_VLAN',
  'CONTRACT_WIFI_SSID',
  'CONTRACT_WIFI_SSID_5G',
  'CONTRACT_WIFI_PASS',
  'TENANT_ACCESS_PASSWORD',
]);
export const Tr069RuleModeSchema = z.enum(['ENFORCE', 'REPORT_ONLY']);

export const Tr069ProfileRuleInputSchema = z.object({
  param: z.string().min(3).max(255),
  valueType: z.string().max(32).default('xsd:string'),
  source: Tr069RuleSourceSchema.default('STATIC'),
  staticValue: z.string().max(255).nullish(),
  mode: Tr069RuleModeSchema.default('REPORT_ONLY'),
  requiresReboot: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});
export type Tr069ProfileRuleInput = z.infer<typeof Tr069ProfileRuleInputSchema>;

export const CreateTr069ProfileSchema = z.object({
  name: z.string().min(1).max(120),
  manufacturer: z.string().min(1).max(64),
  productClass: z.string().max(64).nullish(),
  firmwarePattern: z.string().max(64).nullish(),
  active: z.boolean().default(true),
  rules: z.array(Tr069ProfileRuleInputSchema).max(100).default([]),
});
export type CreateTr069Profile = z.infer<typeof CreateTr069ProfileSchema>;

export const UpdateTr069ProfileSchema = CreateTr069ProfileSchema.partial();
export type UpdateTr069Profile = z.infer<typeof UpdateTr069ProfileSchema>;

export const ListTr069DevicesQuerySchema = z.object({
  /** Filtra por status de conformidade. */
  compliance: z
    .enum(['UNKNOWN', 'COMPLIANT', 'DRIFTED', 'REMEDIATING', 'PENDING_REBOOT', 'FAILED'])
    .optional(),
  /** Busca por deviceId/serial/fabricante. */
  search: z.string().max(120).optional(),
});
export type ListTr069DevicesQuery = z.infer<typeof ListTr069DevicesQuerySchema>;

export interface Tr069ProfileRuleDto {
  id: string;
  param: string;
  valueType: string;
  source: Tr069RuleSource;
  staticValue: string | null;
  mode: Tr069RuleMode;
  requiresReboot: boolean;
  enabled: boolean;
  sortOrder: number;
}

export interface Tr069ProfileDto {
  id: string;
  name: string;
  manufacturer: string;
  productClass: string | null;
  firmwarePattern: string | null;
  version: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  rules: Tr069ProfileRuleDto[];
  /** Quantos devices estão casados com este profile. */
  deviceCount: number;
}

export interface Tr069ProfileSummaryDto {
  id: string;
  name: string;
  manufacturer: string;
  productClass: string | null;
  version: number;
  active: boolean;
  ruleCount: number;
  deviceCount: number;
  updatedAt: string;
}

export interface Tr069DriftDto {
  id: string;
  param: string;
  expected: string | null;
  actual: string | null;
  status: Tr069DriftStatus;
  requiresReboot: boolean;
  attempts: number;
  detectedAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface Tr069DeviceComplianceDto {
  complianceStatus: Tr069ComplianceStatus;
  profileId: string | null;
  profileName: string | null;
  lastReconciledAt: string | null;
  pendingRebootSince: string | null;
  drifts: Tr069DriftDto[];
}

export interface Tr069ReconcileResponse {
  ok: boolean;
  complianceStatus: Tr069ComplianceStatus;
  message: string;
}

// =============================================================================
// Dashboard "Fila de diagnóstico" (CPE Manager — landing /tr069)
// =============================================================================
export interface Tr069DashboardQueueItem {
  deviceId: string;
  /** Cliente (displayName) ou o deviceId quando não há cliente vinculado. */
  label: string;
  model: string | null;
  severity: 'ok' | 'warn' | 'crit';
  /** Mensagem do alerta de maior severidade do device. */
  symptom: string;
  type: Tr069AlertType;
  /** Valor que disparou o alerta (ex.: RX dBm) — pra coluna "Sinal". */
  signal: number | null;
  lastInformAt: string | null;
}

/** Célula do "Mapa OLT" — saúde agregada dos CPEs de uma OLT. */
export interface Tr069DashboardOltCell {
  oltId: string;
  oltName: string;
  total: number;
  /** CPEs degradados (offline ou com alerta aberto). */
  degraded: number;
}

export interface Tr069DashboardResponse {
  kpis: { online: number; offline: number; alerta: number; naoConformes: number };
  queue: Tr069DashboardQueueItem[];
  symptoms: Array<{ type: Tr069AlertType; count: number }>;
  /** Saúde por OLT (modo "Mapa OLT" do dashboard). */
  olts: Tr069DashboardOltCell[];
}
