/**
 * Regras de disparo dos alarmes de tendência do painel do NOC.
 *
 * Módulo PURO de propósito: a decisão "isto é um alarme?" é a parte que mais
 * precisa de teste e a que menos deve depender de banco, HTTP ou relógio.
 * Isolada aqui, cada limiar é travado por teste sem subir nada.
 *
 * Os limiares vêm por parâmetro (não lidos de env aqui dentro) pra que o teste
 * possa exercer as bordas sem mexer em variável de ambiente global.
 */
import type {
  DashboardAlarm,
  DevicesPanel,
  OltPanel,
  OpticalPanel,
  SessionsPanel,
  TrafficPanel,
} from './nms-dashboard.types';

export interface AlarmThresholds {
  pppoeDropWarnPct: number;
  pppoeDropCritPct: number;
  pppoeDropMinAbs: number;
  trafficDeltaWarnPct: number;
  trafficDeltaCritPct: number;
  trafficMinBps: number;
  staleMin: number;
}

export interface AlarmInput {
  sessions: SessionsPanel;
  traffic: TrafficPanel;
  devices: DevicesPanel;
  olts: OltPanel;
  optical: OpticalPanel;
}

const SEVERITY_RANK: Record<DashboardAlarm['severity'], number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

/**
 * Avalia todos os blocos e devolve os alarmes, mais graves primeiro.
 *
 * Princípio geral: ausência de dado NUNCA vira alarme. Baseline null, tráfego
 * null (NMS fora) e tráfego abaixo do piso simplesmente não disparam — um
 * alarme por "não sei" treina o operador a ignorar o painel.
 */
export function deriveAlarms(p: AlarmInput, t: AlarmThresholds): DashboardAlarm[] {
  const alarms: DashboardAlarm[] = [];

  // ── PPPoE: queda contra o baseline ─────────────────────────────────────
  if (p.sessions.baseline !== null && p.sessions.deltaPct !== null) {
    const lost = p.sessions.baseline - p.sessions.active;
    const dropPct = -p.sessions.deltaPct;
    // As DUAS condições juntas: só percentual alarma rede pequena à toa (2 de
    // 12 clientes = 17%); só absoluto ignora queda proporcionalmente grave.
    if (dropPct >= t.pppoeDropWarnPct && lost >= t.pppoeDropMinAbs) {
      alarms.push({
        kind: 'PPPOE_DROP',
        severity: dropPct >= t.pppoeDropCritPct ? 'CRITICAL' : 'WARNING',
        title: 'Queda de sessões PPPoE',
        detail: `${lost} sessões a menos que a média da última hora (${p.sessions.active} agora vs ${p.sessions.baseline} de baseline, −${dropPct.toFixed(1)}%).`,
      });
    }
  }

  // ── Tráfego: queda ou pico ─────────────────────────────────────────────
  const totalNow =
    p.traffic.inBps === null || p.traffic.outBps === null ? null : p.traffic.inBps + p.traffic.outBps;
  if (
    totalNow !== null &&
    p.traffic.deltaPct !== null &&
    p.traffic.baselineBps !== null &&
    // Piso: percentual sobre tráfego ínfimo é ruído (1→3 Mbps de madrugada é
    // +200% e não significa nada).
    Math.max(totalNow, p.traffic.baselineBps) >= t.trafficMinBps
  ) {
    const d = p.traffic.deltaPct;
    const mag = Math.abs(d);
    if (mag >= t.trafficDeltaWarnPct) {
      const severity = mag >= t.trafficDeltaCritPct ? 'CRITICAL' : 'WARNING';
      alarms.push(
        d < 0
          ? {
              kind: 'TRAFFIC_DROP',
              severity,
              title: 'Queda brusca de tráfego',
              detail: `Tráfego agregado ${mag.toFixed(1)}% abaixo da média da última hora.`,
            }
          : {
              kind: 'TRAFFIC_SPIKE',
              severity,
              title: 'Subida brusca de tráfego',
              detail: `Tráfego agregado ${mag.toFixed(1)}% acima da média da última hora.`,
            },
      );
    }
  }

  // ── Frota ──────────────────────────────────────────────────────────────
  if (p.devices.offline !== null && p.devices.offline > 0) {
    alarms.push({
      kind: 'DEVICES_OFFLINE',
      severity: p.devices.offline > 1 ? 'CRITICAL' : 'WARNING',
      title: 'Dispositivos offline',
      detail: `${p.devices.offline} de ${p.devices.total} dispositivos sem telemetria recente.`,
    });
  }
  if (p.devices.staleTelemetry > 0) {
    alarms.push({
      kind: 'STALE_TELEMETRY',
      severity: 'INFO',
      title: 'Telemetria atrasada',
      detail: `${p.devices.staleTelemetry} dispositivo(s) sem métrica há mais de ${t.staleMin} min — o painel pode estar mostrando dado velho.`,
    });
  }

  // ── OLTs ───────────────────────────────────────────────────────────────
  if (p.olts.offline > 0) {
    // UNKNOWN fica de fora: "nunca testou" não é "caiu".
    const down = p.olts.items.filter((o) => o.status !== 'ONLINE' && o.status !== 'UNKNOWN');
    const affected = down.reduce((a, o) => a + o.ontsTotal, 0);
    alarms.push({
      kind: 'OLT_OFFLINE',
      severity: 'CRITICAL',
      title: 'OLT inacessível',
      detail: `${down.map((o) => o.name).join(', ')} — ${affected} ONT(s) potencialmente afetadas.`,
    });
  }

  // ── Óptica ─────────────────────────────────────────────────────────────
  if (p.optical.critical > 0) {
    alarms.push({
      kind: 'OPTICAL_CRITICAL',
      severity: 'CRITICAL',
      title: 'ONTs sem sinal óptico',
      detail: `${p.optical.critical} ONT(s) em LOS/falha.`,
    });
  }

  return alarms.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
