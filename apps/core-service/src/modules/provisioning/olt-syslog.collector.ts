/**
 * OltSyslogCollector — listener UDP que ingere o syslog das OLTs Zyxel e
 * traduz os alarmes GPON em estado de ONT + evento (Fase 3).
 *
 * Por que syslog (e não SNMP trap): o ZyNOS já emite, em tempo real, linhas
 * que separam o MOTIVO da queda:
 *   - `ont-alarm: DGi  set: ont-3-1-1`  → Dying Gasp = QUEDA DE ENERGIA na ONU
 *   - `ont-alarm: LOSi set: ont-3-1-1`  → Loss of Signal = PERDA DE LINK/FIBRA
 *   - `ont-alarm: <x> clear: ...`       → alarme limpo (ONT voltou)
 *   - `omci-alarm: LowTxOpticalPower ... ont-3-2-1` → degradação óptica
 *
 * O coletor resolve a OLT pelo IP de origem do pacote, a ONT pelo AID
 * (ont-<slot>-<pon>-<idx> → Ont.ponSlot/ponFrame/ponOnuIndex), atualiza o
 * status e publica `netx-cpe.ont.down/up`. Carimba a hora NO RECEBIMENTO — o
 * relógio da OLT não é confiável (sem NTP costuma vir errado).
 *
 * Ativação: NETX_SYSLOG_LISTEN_ENABLED=true. Porta NETX_SYSLOG_LISTEN_PORT
 * (default 514 — o ZyNOS manda fixo na 514; bind <1024 exige privilégio, então
 * em prod use CAP_NET_BIND_SERVICE ou um redirect iptables 514→porta alta).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { createSocket, type Socket } from 'node:dgram';

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AlarmStream } from '../alarms/alarm-stream.service';
import { IncidentCorrelator } from '../alarms/incident-correlator.service';
import { EventBusPublisher } from '../events/event-bus.publisher';
import {
  CPE_ONT_DOWN,
  CPE_ONT_UP,
  type OntAlarmPayload,
  type OntDownReason,
} from '../events/event-types';
import { PrismaService } from '../prisma/prisma.service';

export type ZynosAlarmKind = 'DGi' | 'LOSi' | 'LOS' | 'LowTxOpticalPower';

export interface ZynosAlarmEvent {
  /** ont-alarm | interface | omci-alarm */
  facility: string;
  alarm: ZynosAlarmKind;
  action: 'set' | 'clear';
  /** ont-<slot>-<pon>-<idx> quando o alarme é por ONT. */
  aid: string | null;
  /** pon-<slot>-<port> quando o alarme é da porta PON. */
  pon: string | null;
  raw: string;
}

const ONT_ALARM_RE = /ont-alarm:\s*(DGi|LOSi)\s+(set|clear):\s*(ont-\d+-\d+-\d+)/i;
const IFACE_LOS_RE = /interface:\s*LOS\s+(set|clear):\s*(pon-\d+-\d+)/i;
const OMCI_RX_RE =
  /omci-alarm:\s*LowTxOpticalPower\b.*?\balarm\s+(set|clear):\s*(ont-\d+-\d+-\d+)/i;

/**
 * Parser PURO (testável) de uma linha de syslog do ZyNOS. Ignora o
 * prefixo `<PRI>`/timestamp/hostname — casa direto nos padrões de alarme.
 * Retorna null pra linhas que não interessam (login, save config, etc).
 */
export function parseZynosSyslog(raw: string): ZynosAlarmEvent | null {
  const line = raw.trim();

  let m = ONT_ALARM_RE.exec(line);
  if (m) {
    return {
      facility: 'ont-alarm',
      alarm: m[1] as ZynosAlarmKind,
      action: m[2].toLowerCase() as 'set' | 'clear',
      aid: m[3].toLowerCase(),
      pon: null,
      raw: line,
    };
  }
  m = OMCI_RX_RE.exec(line);
  if (m) {
    return {
      facility: 'omci-alarm',
      alarm: 'LowTxOpticalPower',
      action: m[1].toLowerCase() as 'set' | 'clear',
      aid: m[2].toLowerCase(),
      pon: null,
      raw: line,
    };
  }
  m = IFACE_LOS_RE.exec(line);
  if (m) {
    return {
      facility: 'interface',
      alarm: 'LOS',
      action: m[1].toLowerCase() as 'set' | 'clear',
      aid: null,
      pon: m[2].toLowerCase(),
      raw: line,
    };
  }
  return null;
}

/** ont-<slot>-<pon>-<idx> → posição numérica pra casar com a Ont. */
function aidToPosition(aid: string): { slot: number; pon: number; idx: number } | null {
  const m = aid.match(/ont-(\d+)-(\d+)-(\d+)/);
  if (!m) return null;
  return { slot: Number(m[1]), pon: Number(m[2]), idx: Number(m[3]) };
}

@Injectable()
export class OltSyslogCollector implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OltSyslogCollector.name);
  private socket: Socket | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBusPublisher,
    private readonly correlator: IncidentCorrelator,
    private readonly stream: AlarmStream,
  ) {}

  onApplicationBootstrap(): void {
    const enabled = /^(1|true)$/i.test(process.env.NETX_SYSLOG_LISTEN_ENABLED ?? '');
    if (!enabled) {
      this.logger.log('[syslog] coletor desabilitado (NETX_SYSLOG_LISTEN_ENABLED!=true)');
      return;
    }
    const port = Number(process.env.NETX_SYSLOG_LISTEN_PORT ?? 514) || 514;
    const host = process.env.NETX_SYSLOG_LISTEN_HOST?.trim() || '0.0.0.0';

    const socket = createSocket('udp4');
    socket.on('message', (msg, rinfo) => {
      // Nunca deixa uma linha malformada derrubar o listener.
      void this.handleDatagram(msg.toString('utf8'), rinfo.address).catch((err) =>
        this.logger.warn(`[syslog] erro ao processar de ${rinfo.address}: ${err?.message ?? err}`),
      );
    });
    socket.on('error', (err) => {
      // EACCES em porta <1024 sem privilégio é o caso comum — degrada com aviso.
      this.logger.error(
        `[syslog] socket erro: ${err.message}. ` +
          (port < 1024
            ? 'Porta <1024 exige CAP_NET_BIND_SERVICE ou redirect iptables 514→porta alta.'
            : ''),
      );
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    });
    socket.bind(port, host, () => {
      this.logger.log(`[syslog] coletor ouvindo em ${host}:${port}/udp`);
    });
    this.socket = socket;
  }

  onModuleDestroy(): void {
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
    this.socket = null;
  }

  /** Processa um datagrama (pode conter 1+ linhas). Exposto pra testes. */
  async handleDatagram(payload: string, sourceIp: string): Promise<void> {
    const events = payload
      .split(/\r?\n/)
      .map(parseZynosSyslog)
      .filter((e): e is ZynosAlarmEvent => e !== null);
    if (events.length === 0) return;

    // Resolve a OLT UMA vez pelo IP de origem (= managementIp da OLT).
    const olt = await this.prisma.olt.findFirst({
      where: { managementIp: sourceIp, deletedAt: null },
      select: { id: true, tenantId: true, name: true },
    });
    if (!olt) {
      this.logger.debug(`[syslog] pacote de ${sourceIp} sem OLT cadastrada — ignorado`);
      return;
    }
    for (const ev of events) await this.applyEvent(olt, ev);
  }

  private async applyEvent(
    olt: { id: string; tenantId: string; name: string },
    ev: ZynosAlarmEvent,
  ): Promise<void> {
    // Alarme de porta PON (sem ONT específica) é só informativo por ora.
    if (!ev.aid) return;
    const pos = aidToPosition(ev.aid);
    if (!pos) return;

    const ont = await this.prisma.ont.findFirst({
      where: {
        oltId: olt.id,
        ponSlot: pos.slot,
        ponFrame: pos.pon,
        ponOnuIndex: pos.idx,
      },
      select: { id: true, contractId: true, snGpon: true, status: true },
    });
    if (!ont) {
      this.logger.debug(`[syslog] ${ev.aid} sem ONT no NetX (OLT ${olt.name}) — ignorado`);
      return;
    }

    const at = new Date();

    // F0 — registra o evento bruto na trilha append-only (alimenta o motor de
    // correlação da Central de Alarmes). Best-effort: nunca derruba o coletor.
    const eventKind =
      ev.alarm === 'LowTxOpticalPower' ? 'DEGRADED' : ev.action === 'clear' ? 'UP' : 'DOWN';
    const rawReason =
      ev.alarm === 'DGi' ? 'POWER_LOSS' : ev.alarm === 'LOSi' ? 'LINK_LOSS' : null;
    const alarmEvent = await this.prisma.alarmEvent
      .create({
        data: {
          tenantId: olt.tenantId,
          ontId: ont.id,
          oltId: olt.id,
          contractId: ont.contractId,
          kind: eventKind,
          reason: rawReason,
          alarm: ev.alarm,
          aid: ev.aid,
          ponSlot: pos.slot,
          ponFrame: pos.pon,
          source: 'syslog',
          at,
        },
        select: { id: true },
      })
      .catch((err) => {
        this.logger.warn(`[syslog] falha ao gravar alarm_event: ${err?.message}`);
        return null;
      });

    // F3 — real-time pro painel/mobile (tela "caixa ao vivo").
    this.stream.publish(olt.tenantId, 'ont', {
      ontId: ont.id,
      oltId: olt.id,
      aid: ev.aid,
      kind: eventKind,
      reason: rawReason,
      at: at.toISOString(),
    });

    // F1 — dispara a correlação (best-effort, fora do caminho crítico).
    void this.correlator.ingest({
      tenantId: olt.tenantId,
      ontId: ont.id,
      eventId: alarmEvent?.id,
      kind: eventKind,
      at,
    });

    // Degradação óptica: não muda up/down, só registra (alerta proativo).
    if (ev.alarm === 'LowTxOpticalPower') {
      if (ev.action === 'set') {
        await this.persistEvent(olt, ont.id, 'degraded', {
          alarm: ev.alarm,
          aid: ev.aid,
          message: 'Potência óptica Tx baixa (fibra degradando)',
        });
      }
      return;
    }

    if (ev.action === 'clear') {
      // ONT voltou: limpa alarme e marca online.
      await this.prisma.ont.update({
        where: { id: ont.id },
        data: { status: 'ONLINE', lastError: null, lastSeenAt: at },
      });
      await this.persistEvent(olt, ont.id, 'up', { alarm: ev.alarm, aid: ev.aid });
      void this.bus.emit<OntAlarmPayload>(
        CPE_ONT_UP,
        olt.tenantId,
        {
          ontId: ont.id,
          oltId: olt.id,
          contractId: ont.contractId,
          snGpon: ont.snGpon,
          aid: ev.aid,
          alarm: ev.alarm,
          at: at.toISOString(),
        },
        'netx-cpe',
      );
      return;
    }

    // action === 'set' → ONT caiu. DGi (dying gasp) = energia vence LOSi.
    const reason: OntDownReason = ev.alarm === 'DGi' ? 'POWER_LOSS' : 'LINK_LOSS';
    // LOSi não deve rebaixar uma queda já classificada como energia.
    if (ev.alarm === 'LOSi' && ont.status === 'OFFLINE') return;

    const status = reason === 'POWER_LOSS' ? 'OFFLINE' : 'LOS';
    const message =
      reason === 'POWER_LOSS'
        ? 'Queda de energia na ONU (dying gasp)'
        : 'Perda de sinal óptico (LOS — link/fibra)';

    await this.prisma.ont.update({
      where: { id: ont.id },
      data: { status, lastError: message },
    });
    await this.persistEvent(olt, ont.id, 'down', { alarm: ev.alarm, aid: ev.aid, reason, message });
    void this.bus.emit<OntAlarmPayload>(
      CPE_ONT_DOWN,
      olt.tenantId,
      {
        ontId: ont.id,
        oltId: olt.id,
        contractId: ont.contractId,
        snGpon: ont.snGpon,
        aid: ev.aid,
        reason,
        alarm: ev.alarm,
        at: at.toISOString(),
      },
      'netx-cpe',
    );
    this.logger.log(
      `[syslog] ${olt.name}/${ev.aid}: ${reason === 'POWER_LOSS' ? 'ENERGIA' : 'LINK'} (${ev.alarm})`,
    );
  }

  private async persistEvent(
    olt: { id: string; tenantId: string },
    ontId: string,
    kind: 'down' | 'up' | 'degraded',
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.provisioningEvent
      .create({
        data: {
          tenantId: olt.tenantId,
          oltId: olt.id,
          ontId,
          contractId: null,
          action: 'OLT_STATUS_POLL',
          status: kind === 'down' ? 'FAILED' : 'SUCCESS',
          payload: { source: 'syslog', kind, ...payload } as Prisma.InputJsonValue,
          actorKind: 'system',
        },
      })
      .catch(() => undefined);
  }
}
