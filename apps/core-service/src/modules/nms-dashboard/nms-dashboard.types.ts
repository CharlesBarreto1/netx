/**
 * Contratos do painel do NMS. Ficam em arquivo próprio porque o frontend
 * espelha estes tipos em `apps/web/src/lib/nms-dashboard-api.ts` — manter a
 * forma num só lugar evita o drift silencioso entre API e tela.
 */

/** Severidade de um alarme do painel. Espelha IncidentSeverity do schema. */
export type DashboardAlarmSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

/**
 * Alarme derivado em runtime pelo painel (tendência), distinto do `Incident`
 * persistido pelo correlacionador de syslog. Não é gravado: é recalculado a
 * cada leitura a partir do histórico, então nunca fica "preso" aberto depois
 * que a rede normaliza.
 */
export interface DashboardAlarm {
  /** Chave estável do tipo de alarme — a UI usa pra ícone/ordenação. */
  kind:
    | 'PPPOE_DROP'
    | 'TRAFFIC_DROP'
    | 'TRAFFIC_SPIKE'
    | 'DEVICES_OFFLINE'
    | 'OLT_OFFLINE'
    | 'OPTICAL_CRITICAL'
    | 'STALE_TELEMETRY';
  severity: DashboardAlarmSeverity;
  title: string;
  /** Texto pronto pra exibição, com os números que motivaram o disparo. */
  detail: string;
}

/** Ponto da série temporal do painel (uma amostra de network_snapshots). */
export interface SnapshotPoint {
  t: string;
  activeSessions: number;
  totalInBps: number | null;
  totalOutBps: number | null;
}

/** Bloco "PPPoE ativos". */
export interface SessionsPanel {
  /** Sessões ativas agora (RADIUS, acctstoptime IS NULL). */
  active: number;
  /** Contratos ACTIVE — o denominador. */
  contracts: number;
  /** Média das amostras da janela de baseline, ou null se não há histórico. */
  baseline: number | null;
  /** Variação percentual contra o baseline (negativa = queda). */
  deltaPct: number | null;
  /** Momento da leitura de `active` (cara — servida de cache). */
  at: string;
}

/** Bloco "Tráfego agregado". */
export interface TrafficPanel {
  /** bits/s agora. Null quando o NMS não respondeu. */
  inBps: number | null;
  outBps: number | null;
  /** Média do total (in+out) na janela de baseline. */
  baselineBps: number | null;
  deltaPct: number | null;
  /** Série curta pro sparkline (mesma fonte do baseline). */
  series: SnapshotPoint[];
}

/** Bloco "Dispositivos online e sincronizados". */
export interface DevicesPanel {
  /** Devices monitorados no NMS. Null = NMS indisponível. */
  total: number | null;
  online: number | null;
  offline: number | null;
  /**
   * Equipamentos marcados como monitorados na Planta que NÃO chegaram no NMS
   * (nmsDeviceId nulo ou erro de sync) — a divergência que o NmsSyncService
   * existe pra eliminar, exposta em vez de silenciosa.
   */
  desynced: number;
  /** Devices cuja última métrica é mais velha que a janela de frescor. */
  staleTelemetry: number;
}

/** Uma OLT no bloco de saúde. */
export interface OltHealthItem {
  id: string;
  name: string;
  vendor: string;
  status: string;
  lastSeenAt: string | null;
  /** ONTs vinculadas, por estado — o que dá dimensão ao impacto. */
  ontsTotal: number;
  ontsOnline: number;
  ontsOffline: number;
}

/** Bloco "Saúde das OLTs". */
export interface OltPanel {
  total: number;
  online: number;
  offline: number;
  items: OltHealthItem[];
}

/** Bloco "Saúde óptica" — distribuição de RX das ONTs. */
export interface OpticalPanel {
  /** ONTs com leitura óptica conhecida (denominador das faixas). */
  measured: number;
  /** RX dentro da faixa boa. */
  ok: number;
  /** RX abaixo de rxLowDbm (sinal fraco) — pré-falha. */
  low: number;
  /** RX acima de rxHighDbm (saturado). */
  high: number;
  /** ONTs em LOS/FAULT — perderam o sinal. */
  critical: number;
  /** Limiares vigentes (AlarmPolicy do tenant), pra UI explicar as faixas. */
  rxLowDbm: number;
  rxHighDbm: number;
  /** Piores casos, pro operador agir sem sair da tela. */
  worst: Array<{
    ontId: string;
    contractId: string;
    snGpon: string;
    oltName: string;
    rxDbm: number | null;
    status: string;
  }>;
}

/** Interface saturada — bloco de gargalos. */
export interface SaturatedInterface {
  deviceId: string;
  hostname: string;
  ifName: string;
  /** Utilização % sobre a capacidade nominal da interface. */
  utilPct: number;
  inBps: number;
  outBps: number;
  speedBps: number;
}

/** Bloco "Top talkers e gargalos". */
export interface CapacityPanel {
  /** Devices com mais tráfego agora. */
  topDevices: Array<{ id: string; hostname: string; site: string | null; totalBps: number }>;
  /** Interfaces acima do limiar de utilização. */
  saturated: SaturatedInterface[];
  /** Devices com CPU ou temperatura fora da faixa. */
  hot: Array<{ id: string; hostname: string; cpuPct: number | null; tempC: number | null }>;
}

/** Incidente correlacionado aberto (motor de alarmes já existente). */
export interface IncidentItem {
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

/** Payload completo do painel. */
export interface NmsDashboard {
  generatedAt: string;
  /** Alarmes de tendência derivados agora (ver DashboardAlarm). */
  alarms: DashboardAlarm[];
  sessions: SessionsPanel;
  traffic: TrafficPanel;
  devices: DevicesPanel;
  optical: OpticalPanel;
  olts: OltPanel;
  capacity: CapacityPanel;
  incidents: IncidentItem[];
  /**
   * Sinaliza que o NMS não respondeu — a UI marca os blocos dependentes como
   * "indisponível" em vez de mostrar zeros que parecem rede parada.
   */
  nmsAvailable: boolean;
}
