/**
 * CwmpSessionService — orquestra o ciclo CWMP por CPE.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Lifecycle padrão TR-069 (1 session = N requests HTTP do MESMO CPE):
 *
 *   CPE → POST /cwmp (body=Inform)
 *      ACS → 200 (body=InformResponse)            [primeira resposta sempre]
 *   CPE → POST /cwmp (body=empty)
 *      ACS → 200 (body=SetParameterValues)        [se há task PENDING]
 *   CPE → POST /cwmp (body=SetParameterValuesResponse)
 *      ACS → 200 (body=Reboot)                    [próxima task PENDING]
 *   CPE → POST /cwmp (body=RebootResponse)
 *      ACS → 204 No Content                       [fim de session]
 *
 * Session state é mantido em memória (Map<sessionId, SessionState>) — não
 * persiste em DB porque CPE Huawei tipicamente fecha conexão dentro de 30s.
 * Tasks ficam em Postgres (Tr069Task) e são "pegas" pra cada session.
 *
 * Identificação:
 *   - sessionId vem do cookie `cwmp.session` que ACS seta na primeira resposta
 *   - deviceId vem do Inform — guardado no session state
 *
 * Auth:
 *   - Fase 3 MVP: sem auth (porta 7547 idealmente fica atrás de firewall
 *     que só aceita VLAN/IP dos CPEs). TODO: HTTP Digest per-device.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Tr069AlertSeverity,
  Tr069AlertStatus,
  Tr069AlertType,
  Tr069DiagKind,
  Tr069DiagState,
} from '@prisma/client';
import type { Tr069Task } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  buildInformResponse,
  buildTransferCompleteResponse,
  extractInform,
  parseCwmp,
  type ParsedCwmpMessage,
} from './cwmp-soap';
import { buildRpcForTask, detectFault, isResponseForTask } from './cwmp-rpc';
import {
  extractDiagnostics,
  isTxPowerAbnormal,
  parseParameterList,
  parseTr143Result,
  RX_THRESHOLDS,
  TR143_RESULT_NAMES,
  WIFI_WEAK_RSSI_DBM,
  type ExtractedDiagnostics,
} from './diagnostics';

interface SessionState {
  /** OUI-Serial do device (set após Inform). */
  deviceId: string | null;
  /** ID do row Tr069Device em Postgres (set após upsert). */
  deviceDbId: string | null;
  /** Task atualmente RUNNING aguardando resposta. */
  inflightTask: Tr069Task | null;
  /** Timestamp criação — usado pra TTL/cleanup. */
  createdAt: number;
  /** Eventos do Inform pra contexto. */
  events: string[];
}

const SESSION_TTL_MS = 5 * 60_000; // 5 min

export interface CwmpResponse {
  /** XML do body de retorno. Vazio = 204 No Content (fim de session). */
  xml: string;
  /** Status HTTP. */
  status: number;
  /** sessionId pra cookie. Persiste através das requests da mesma session. */
  sessionId: string;
}

@Injectable()
export class CwmpSessionService {
  private readonly logger = new Logger(CwmpSessionService.name);
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly prisma: PrismaService) {
    // GC periódico de sessions órfãs (CPE caiu sem enviar empty post final).
    setInterval(() => this.gcSessions(), 60_000).unref();
  }

  /**
   * Handler principal — recebe XML do CPE e retorna XML do ACS.
   * Express controller delega aqui, mantém-se thin.
   */
  async handle(rawXml: string, sessionId: string | null): Promise<CwmpResponse> {
    const sid = sessionId ?? randomUUID();
    const state = this.sessions.get(sid) ?? this.createSession();
    this.sessions.set(sid, state);

    const parsed = parseCwmp(rawXml);

    this.logger.debug(
      `[CWMP] sid=${sid.slice(0, 8)} kind=${parsed.kind} cwmpId=${parsed.cwmpId ?? '∅'} ` +
        `device=${state.deviceId ?? '∅'} bodyBytes=${rawXml.length}`,
    );

    // 1. Inform — sempre primeiro. Persiste device, retorna InformResponse.
    if (parsed.kind === 'Inform') {
      return this.handleInform(parsed, state, sid);
    }

    // 2. Empty body — CPE pede "próxima RPC" OU confirma fim de session.
    if (parsed.kind === 'EmptyPost') {
      return this.handleEmptyPost(state, sid);
    }

    // 2b. TransferComplete — CPE avisa que terminou um Download (firmware).
    if (parsed.kind === 'TransferComplete') {
      await this.handleTransferComplete(parsed).catch((err: unknown) =>
        this.logger.error(`[CWMP] TransferComplete falhou: ${String(err)}`),
      );
      return { xml: buildTransferCompleteResponse(parsed.cwmpId ?? '1'), status: 200, sessionId: sid };
    }

    // 3. Response a uma RPC que mandamos — atualiza task em DB.
    if (state.inflightTask) {
      await this.completeInflight(state, parsed);
      // Após processar response, tenta despachar próxima task (chain).
      return this.dispatchNextOrClose(state, sid);
    }

    // CPE mandou algo inesperado — log e fecha session pra evitar loop.
    this.logger.warn(`[CWMP] sid=${sid.slice(0, 8)} kind=${parsed.kind} inesperado — fechando session`);
    this.sessions.delete(sid);
    return { xml: '', status: 204, sessionId: sid };
  }

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  private async handleInform(
    parsed: ParsedCwmpMessage,
    state: SessionState,
    sid: string,
  ): Promise<CwmpResponse> {
    const inform = extractInform(parsed);
    if (!inform) {
      this.logger.error(`[CWMP] sid=${sid.slice(0, 8)} Inform malformado`);
      return {
        xml: buildInformResponse(parsed.cwmpId ?? '1'),
        status: 200,
        sessionId: sid,
      };
    }

    state.deviceId = inform.deviceId;
    state.events = inform.events;
    this.logger.log(
      `[CWMP] Inform device=${inform.deviceId} events=[${inform.events.join(',')}] ` +
        `manuf=${inform.manufacturer} class=${inform.productClass}`,
    );

    // Upsert Tr069Device. Tenant vem do device pré-existente (criado pelo
    // ProvisioningService quando técnico ativou o cliente). Se device é
    // desconhecido, gravamos órfão com tenantId null e logamos warning.
    const existing = await this.prisma.tr069Device.findUnique({
      where: { deviceId: inform.deviceId },
    });

    // Placeholder com OUI-Serial baseado em SN GPON pode ter sido criado.
    // O Tr069TasksService usa pattern "00259E-<SN_GPON>" — quando CPE faz
    // Inform real, o deviceId pode bater (se SN GPON == serialNumber do CPE,
    // o que é típico em Huawei) ou divergir. Vamos tentar matchar pelo
    // serialNumber também.
    const matchedById = existing;
    const matchedBySerial = !matchedById
      ? await this.prisma.tr069Device.findFirst({
          where: {
            // Match placeholder pelo padrão "OUI-SerialNumber" onde o lado
            // serial pode coincidir com SN GPON.
            deviceId: { endsWith: `-${inform.serialNumber}` },
          },
        })
      : null;

    const target = matchedById ?? matchedBySerial;
    if (target) {
      const updated = await this.prisma.tr069Device.update({
        where: { id: target.id },
        data: {
          deviceId: inform.deviceId, // re-grava com OUI-Serial real
          manufacturer: inform.manufacturer,
          oui: inform.oui,
          productClass: inform.productClass,
          connectionRequestUrl: inform.connectionRequestUrl,
          parametersSnapshot: inform.parameters as unknown as object,
          status: 'ONLINE',
          lastInformAt: new Date(),
          lastInformReason: inform.events[0] ?? null,
        },
      });
      state.deviceDbId = updated.id;
    } else {
      // Device desconhecido: resolve o tenant pela ONT (SN GPON == SerialNumber
      // do CPE, típico em Huawei). NUNCA cair no "primeiro tenant" — isso
      // poluía cross-tenant (multi-tenancy estrito). Sem ONT correspondente,
      // logamos e NÃO persistimos (evita órfão mal-atribuído).
      const ont = inform.serialNumber
        ? await this.prisma.ont.findFirst({
            where: { snGpon: { equals: inform.serialNumber, mode: 'insensitive' } },
            select: { id: true, tenantId: true, tr069Device: { select: { id: true } } },
          })
        : null;

      if (!ont) {
        this.logger.warn(
          `[CWMP] device desconhecido sem ONT correspondente (SN=${inform.serialNumber}) — ` +
            `ignorando p/ não cruzar tenants. device=${inform.deviceId}`,
        );
      } else if (ont.tr069Device) {
        // ONT já tem device (deviceId divergente) — atualiza o existente.
        const updated = await this.prisma.tr069Device.update({
          where: { id: ont.tr069Device.id },
          data: {
            deviceId: inform.deviceId,
            manufacturer: inform.manufacturer,
            oui: inform.oui,
            productClass: inform.productClass,
            connectionRequestUrl: inform.connectionRequestUrl,
            parametersSnapshot: inform.parameters as unknown as object,
            status: 'ONLINE',
            lastInformAt: new Date(),
            lastInformReason: inform.events[0] ?? null,
          },
        });
        state.deviceDbId = updated.id;
      } else {
        const created = await this.prisma.tr069Device.create({
          data: {
            tenantId: ont.tenantId,
            ontId: ont.id,
            deviceId: inform.deviceId,
            manufacturer: inform.manufacturer,
            oui: inform.oui,
            productClass: inform.productClass,
            connectionRequestUrl: inform.connectionRequestUrl,
            parametersSnapshot: inform.parameters as unknown as object,
            status: 'ONLINE',
            lastInformAt: new Date(),
            lastInformReason: inform.events[0] ?? null,
          },
        });
        state.deviceDbId = created.id;
        this.logger.log(`[CWMP] device vinculado à ONT ${ont.id} via SN — tenant=${ont.tenantId}`);
      }
    }

    // TR-143: CPE terminou um diagnóstico (speed test / ping) — enfileira o GET
    // dos resultados pra ler ainda nesta sessão.
    if (state.deviceDbId && inform.events.some((e) => /DIAGNOSTICS COMPLETE/i.test(e))) {
      await this.enqueueDiagResultGet(state.deviceDbId).catch((err: unknown) =>
        this.logger.error(`[CWMP] enfileirar DIAG_RESULT falhou: ${String(err)}`),
      );
    }

    // CPE voltou a comunicar — fecha qualquer alerta de OFFLINE aberto.
    if (state.deviceDbId) {
      await this.resolveAlert(state.deviceDbId, Tr069AlertType.DEVICE_OFFLINE);
      // Notificações armadas (passivas) fazem o Inform já trazer os níveis
      // ópticos — grava o diagnóstico direto daqui, sem precisar de GET_PARAMS.
      // Sem óptico (CPE ainda não armado) o persist sai silencioso.
      await this.persistDiagnostics(state.deviceDbId, inform.deviceId, inform.parameters, false).catch(
        (err: unknown) => this.logger.error(`[CWMP] persist diag (inform) falhou: ${String(err)}`),
      );
    }

    return {
      xml: buildInformResponse(parsed.cwmpId ?? '1'),
      status: 200,
      sessionId: sid,
    };
  }

  /**
   * TransferComplete (CPE→ACS) após um Download. O CommandKey == task.id, então
   * correlacionamos e fechamos a task de firmware como DONE/FAILED pelo FaultCode.
   */
  private async handleTransferComplete(parsed: ParsedCwmpMessage): Promise<void> {
    const body = parsed.body;
    const commandKey = body.CommandKey != null ? String(body.CommandKey) : null;
    const faultStruct = body.FaultStruct as Record<string, unknown> | undefined;
    const faultCode = faultStruct?.FaultCode != null ? Number(faultStruct.FaultCode) : 0;
    const faultString = faultStruct?.FaultString != null ? String(faultStruct.FaultString) : null;
    this.logger.log(
      `[CWMP] TransferComplete commandKey=${commandKey ?? '∅'} faultCode=${faultCode}`,
    );
    if (!commandKey) return;
    // commandKey é o task.id; só atualiza se for um UUID de task DOWNLOAD válido.
    const task = await this.prisma.tr069Task.findFirst({
      where: { id: commandKey, action: 'DOWNLOAD' },
      select: { id: true },
    });
    if (!task) return;
    await this.prisma.tr069Task.update({
      where: { id: task.id },
      data:
        faultCode === 0
          ? { status: 'DONE', completedAt: new Date(), result: { transferComplete: true } as object }
          : { status: 'FAILED', completedAt: new Date(), error: `TransferComplete fault ${faultCode}: ${faultString ?? '?'}` },
    });
  }

  private async handleEmptyPost(state: SessionState, sid: string): Promise<CwmpResponse> {
    // CPE pergunta "tem mais RPC pra mim?" — pegamos próxima task PENDING.
    return this.dispatchNextOrClose(state, sid);
  }

  /**
   * Procura próxima Tr069Task PENDING do device, dispara, e marca RUNNING.
   * Se nada pendente, retorna 204 (fim de session).
   */
  private async dispatchNextOrClose(state: SessionState, sid: string): Promise<CwmpResponse> {
    if (!state.deviceDbId) {
      this.logger.debug(`[CWMP] sid=${sid.slice(0, 8)} sem device — fecha session`);
      this.sessions.delete(sid);
      return { xml: '', status: 204, sessionId: sid };
    }

    const next = await this.prisma.tr069Task.findFirst({
      where: { deviceId: state.deviceDbId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (!next) {
      this.logger.debug(`[CWMP] sid=${sid.slice(0, 8)} sem tasks PENDING — fecha session`);
      this.sessions.delete(sid);
      return { xml: '', status: 204, sessionId: sid };
    }

    let xml: string;
    let cwmpId: string;
    try {
      ({ xml, cwmpId } = buildRpcForTask(next));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[CWMP] task ${next.id} build falhou: ${msg}`);
      await this.prisma.tr069Task.update({
        where: { id: next.id },
        data: { status: 'FAILED', error: msg, completedAt: new Date() },
      });
      // Tenta próxima
      return this.dispatchNextOrClose(state, sid);
    }

    await this.prisma.tr069Task.update({
      where: { id: next.id },
      data: {
        status: 'RUNNING',
        attempts: { increment: 1 },
        startedAt: new Date(),
      },
    });
    state.inflightTask = { ...next, status: 'RUNNING' };
    this.logger.log(
      `[CWMP] dispatch task=${next.id.slice(0, 8)} action=${next.action} cwmpId=${cwmpId.slice(0, 8)}`,
    );
    return { xml, status: 200, sessionId: sid };
  }

  /** CPE respondeu a inflight task — marca DONE/FAILED. */
  private async completeInflight(state: SessionState, parsed: ParsedCwmpMessage): Promise<void> {
    const task = state.inflightTask;
    if (!task) return;
    state.inflightTask = null;

    const fault = detectFault(parsed.body);
    const correctRpc = isResponseForTask(task.action, parsed.kind);

    if (fault) {
      await this.prisma.tr069Task.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          error: fault,
          result: { kind: parsed.kind } as unknown as object,
          completedAt: new Date(),
        },
      });
      this.logger.warn(`[CWMP] task ${task.id.slice(0, 8)} fault: ${fault}`);
      return;
    }
    if (!correctRpc) {
      this.logger.warn(
        `[CWMP] task ${task.id.slice(0, 8)} esperava response mas recebeu ${parsed.kind}; ` +
          'aceitando assim mesmo (Huawei às vezes pula response intermediário)',
      );
    }
    // Pra GET, guarda também os params já parseados (nome→valor) — o
    // reconciliador (core-service) lê daqui sem reparsear SOAP.
    const getParams =
      task.action === 'GET_PARAMS' && parsed.kind === 'GetParameterValuesResponse'
        ? parseParameterList(parsed.body)
        : undefined;
    await this.prisma.tr069Task.update({
      where: { id: task.id },
      data: {
        status: 'DONE',
        result: {
          kind: parsed.kind,
          body: parsed.body,
          ...(getParams ? { params: getParams } : {}),
        } as unknown as object,
        completedAt: new Date(),
      },
    });
    this.logger.log(`[CWMP] task ${task.id.slice(0, 8)} DONE (${parsed.kind})`);

    // GET_PARAMS de diagnóstico — transforma a ParameterList em métricas
    // (níveis ópticos + Wi-Fi), persiste a série temporal e avalia alertas.
    if (task.action === 'GET_PARAMS' && parsed.kind === 'GetParameterValuesResponse' && state.deviceDbId) {
      const params = parseParameterList(parsed.body);
      await this.persistDiagnostics(state.deviceDbId, state.deviceId ?? '∅', params, true).catch(
        (err: unknown) => this.logger.error(`[CWMP] falha ao persistir diagnóstico: ${String(err)}`),
      );
      // Resultado de TR-143 (speed test / ping), se presente nesse GET.
      await this.processDiagResult(state.deviceDbId, params).catch((err: unknown) =>
        this.logger.error(`[CWMP] processar TR-143 falhou: ${String(err)}`),
      );
    }
  }

  /** Enfileira o GET dos resultados TR-143 (após "8 DIAGNOSTICS COMPLETE"). */
  private async enqueueDiagResultGet(deviceDbId: string): Promise<void> {
    const device = await this.prisma.tr069Device.findUnique({
      where: { id: deviceDbId },
      select: { tenantId: true },
    });
    if (!device) return;
    await this.prisma.tr069Task.create({
      data: {
        tenantId: device.tenantId,
        deviceId: deviceDbId,
        action: 'GET_PARAMS',
        payload: { names: TR143_RESULT_NAMES, purpose: 'DIAG_RESULT' },
        status: 'PENDING',
      },
    });
  }

  /**
   * Fecha as runs TR-143 REQUESTED do device com base nos resultados lidos.
   * Correlaciona por kind (a última REQUESTED daquele tipo). Best-effort.
   */
  private async processDiagResult(deviceDbId: string, params: Record<string, string>): Promise<void> {
    const { download, upload, ping } = parseTr143Result(params);

    for (const [kind, res] of [
      [Tr069DiagKind.DOWNLOAD, download],
      [Tr069DiagKind.UPLOAD, upload],
    ] as const) {
      if (!res) continue;
      const run = await this.prisma.tr069DiagnosticRun.findFirst({
        where: { deviceId: deviceDbId, kind, state: Tr069DiagState.REQUESTED },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (run) {
        const ok = /^Completed$/i.test(res.state);
        await this.prisma.tr069DiagnosticRun.update({
          where: { id: run.id },
          data: {
            state: ok ? Tr069DiagState.COMPLETED : Tr069DiagState.ERROR,
            throughputKbps: ok ? res.throughputKbps : null,
            errorText: ok ? null : res.state,
            raw: params as unknown as object,
            completedAt: new Date(),
          },
        });
        this.logger.log(`[CWMP] ${kind} device=${deviceDbId.slice(0, 8)} ${res.state} ${res.throughputKbps ?? '∅'}kbps`);
      }
    }

    if (ping) {
      const run = await this.prisma.tr069DiagnosticRun.findFirst({
        where: { deviceId: deviceDbId, kind: Tr069DiagKind.PING, state: Tr069DiagState.REQUESTED },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (run) {
        const ok = /^Complete/i.test(ping.state); // "Complete" / "Completed"
        await this.prisma.tr069DiagnosticRun.update({
          where: { id: run.id },
          data: {
            state: ok ? Tr069DiagState.COMPLETED : Tr069DiagState.ERROR,
            pingSuccess: ping.success,
            pingFailure: ping.failure,
            pingAvgMs: ping.avgMs,
            pingMinMs: ping.minMs,
            pingMaxMs: ping.maxMs,
            errorText: ok ? null : ping.state,
            raw: params as unknown as object,
            completedAt: new Date(),
          },
        });
        this.logger.log(`[CWMP] ping device=${deviceDbId.slice(0, 8)} ${ping.state} avg=${ping.avgMs ?? '∅'}ms`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Diagnóstico proativo
  // ---------------------------------------------------------------------------

  /**
   * Converte um mapa de parâmetros (de um GET_PARAMS OU de um Inform que já
   * carrega os ópticos por notificação passiva) em um Tr069Diagnostic, atualiza
   * os últimos níveis na ONT e abre/resolve alertas. Best-effort.
   *
   * `warnIfEmpty`: GET explícito loga aviso se não veio métrica (suspeita de
   * path errado); Inform NÃO loga (a maioria não traz óptico antes de armar).
   */
  private async persistDiagnostics(
    deviceDbId: string,
    deviceLabel: string,
    params: Record<string, string>,
    warnIfEmpty: boolean,
  ): Promise<void> {
    const diag = extractDiagnostics(params);
    // Nada de óptico nem Wi-Fi — não vale gravar ruído.
    if (
      !diag.hasOptical &&
      diag.wifiClients24 === null &&
      diag.wifiClients5 === null &&
      diag.wifiClients.length === 0
    ) {
      if (warnIfEmpty) {
        this.logger.warn(
          `[CWMP] diagnóstico sem métricas reconhecidas (device=${deviceLabel}) — ` +
            'confira HUAWEI_GPON_IFACE_PATH',
        );
      }
      return;
    }

    const device = await this.prisma.tr069Device.findUnique({
      where: { id: deviceDbId },
      select: { id: true, tenantId: true, ontId: true, lastDiagnosticAt: true },
    });
    if (!device) return;

    // Leitura anterior — pra calcular delta de FEC/HEC (degradação de fibra).
    const prev = await this.prisma.tr069Diagnostic.findFirst({
      where: { deviceId: device.id },
      orderBy: { capturedAt: 'desc' },
      select: { fecErrors: true, hecErrors: true },
    });

    // THROTTLE da série temporal: com notificações armadas o CPE informa a cada
    // ~60s; gravar 1 linha/min/device inflaria o banco. Gravamos no máximo 1
    // ponto a cada TR069_DIAGNOSTIC_MIN_INTERVAL_MIN (default 10) — suficiente
    // pra tendência/ranking. `force=true` (coleta manual) ignora o throttle.
    // Alertas e níveis da ONT são SEMPRE atualizados abaixo (real-time preservado).
    const minIntervalMs = parseInt(process.env.TR069_DIAGNOSTIC_MIN_INTERVAL_MIN ?? '10', 10) * 60_000;
    const writeSeries =
      warnIfEmpty || // coleta manual sempre grava
      !device.lastDiagnosticAt ||
      Date.now() - device.lastDiagnosticAt.getTime() >= minIntervalMs;

    if (writeSeries) {
      await this.prisma.tr069Diagnostic.create({
        data: {
          tenantId: device.tenantId,
          deviceId: device.id,
          rxPower: diag.rxPower,
          txPower: diag.txPower,
          temperature: diag.temperature,
          voltage: diag.voltage,
          biasCurrent: diag.biasCurrent,
          opticalHealth: diag.opticalHealth,
          gponStatus: diag.gponStatus,
          fecErrors: diag.fecErrors,
          hecErrors: diag.hecErrors,
          dropRate: diag.dropRate,
          errorRate: diag.errorRate,
          pppStatus: diag.pppStatus,
          pppLastError: diag.pppLastError,
          wanUptime: diag.wanUptime,
          hostsCount: diag.hosts.length || null,
          hosts: diag.hosts.length ? (diag.hosts as unknown as object) : undefined,
          wifiClients24: diag.wifiClients24,
          wifiClients5: diag.wifiClients5,
          wifiChannel24: diag.wifiChannel24,
          wifiChannel5: diag.wifiChannel5,
          wifiWorstRssi: diag.wifiWorstRssi,
          wifiAvgRssi: diag.wifiAvgRssi,
          wifiClients: diag.wifiClients as unknown as object,
          cpuUsage: diag.cpuUsage,
          memUsage: diag.memUsage,
          deviceTemp: diag.deviceTemp,
          wanRxBytes: diag.wanRxBytes,
          wanTxBytes: diag.wanTxBytes,
          // `raw` (mapa completo) só na coleta manual — é o que mais pesa. O
          // snapshot mais recente já vive em tr069_devices.parametersSnapshot.
          raw: warnIfEmpty ? (diag.raw as unknown as object) : undefined,
        },
      });
      await this.prisma.tr069Device.update({
        where: { id: device.id },
        data: { lastDiagnosticAt: new Date() },
      });
    }

    // Denormaliza os últimos níveis na ONT (mesma fonte que o poll de OLT usa).
    if (device.ontId && (diag.rxPower !== null || diag.txPower !== null)) {
      await this.prisma.ont.update({
        where: { id: device.ontId },
        data: {
          ...(diag.rxPower !== null ? { lastRxPower: diag.rxPower } : {}),
          ...(diag.txPower !== null ? { lastTxPower: diag.txPower } : {}),
          lastSeenAt: new Date(),
        },
      });
    }

    await this.evaluateOpticalAlerts(device.tenantId, device.id, diag);
    await this.evaluateFiberAlert(device.tenantId, device.id, diag, prev);
    await this.evaluateWanAlert(device.tenantId, device.id, diag);
    this.logger.log(
      `[CWMP] diagnóstico device=${deviceLabel} rx=${diag.rxPower ?? '∅'}dBm ` +
        `tx=${diag.txPower ?? '∅'}dBm health=${diag.opticalHealth} ` +
        `wifi=${diag.wifiClients24 ?? '∅'}/${diag.wifiClients5 ?? '∅'}`,
    );
  }

  /** Abre/atualiza ou resolve alertas ópticos com base na última leitura. */
  private async evaluateOpticalAlerts(
    tenantId: string,
    deviceId: string,
    diag: ExtractedDiagnostics,
  ): Promise<void> {
    const rx = diag.rxPower;

    // RX fraco (abaixo do piso de atenção).
    if (rx !== null && rx < RX_THRESHOLDS.warnLow) {
      await this.openAlert(
        tenantId,
        deviceId,
        Tr069AlertType.OPTICAL_RX_LOW,
        rx < RX_THRESHOLDS.critLow ? Tr069AlertSeverity.CRITICAL : Tr069AlertSeverity.WARNING,
        `Sinal óptico de recepção fraco: ${rx} dBm (esperado ≥ ${RX_THRESHOLDS.warnLow} dBm)`,
        rx,
      );
    } else {
      await this.resolveAlert(deviceId, Tr069AlertType.OPTICAL_RX_LOW);
    }

    // RX forte demais (acima do teto de atenção) — risco de saturar o receptor.
    if (rx !== null && rx > RX_THRESHOLDS.warnHigh) {
      await this.openAlert(
        tenantId,
        deviceId,
        Tr069AlertType.OPTICAL_RX_HIGH,
        rx > RX_THRESHOLDS.critHigh ? Tr069AlertSeverity.CRITICAL : Tr069AlertSeverity.WARNING,
        `Sinal óptico de recepção forte demais: ${rx} dBm (esperado ≤ ${RX_THRESHOLDS.warnHigh} dBm)`,
        rx,
      );
    } else {
      await this.resolveAlert(deviceId, Tr069AlertType.OPTICAL_RX_HIGH);
    }

    // TX da ONT fora da faixa.
    if (isTxPowerAbnormal(diag.txPower)) {
      await this.openAlert(
        tenantId,
        deviceId,
        Tr069AlertType.OPTICAL_TX_ABNORMAL,
        Tr069AlertSeverity.WARNING,
        `Potência de transmissão da ONT fora da faixa: ${diag.txPower} dBm`,
        diag.txPower,
      );
    } else {
      await this.resolveAlert(deviceId, Tr069AlertType.OPTICAL_TX_ABNORMAL);
    }

    // Cliente Wi-Fi com cobertura ruim (RSSI baixo). Só avalia quando houve
    // enumeração por cliente (worstRssi != null) — senão não mexe no alerta.
    if (diag.wifiWorstRssi !== null && diag.wifiWorstRssi < WIFI_WEAK_RSSI_DBM) {
      const weak = diag.wifiClients.filter(
        (c) => c.rssi !== null && c.rssi < WIFI_WEAK_RSSI_DBM,
      ).length;
      await this.openAlert(
        tenantId,
        deviceId,
        Tr069AlertType.WIFI_WEAK_CLIENT,
        Tr069AlertSeverity.WARNING,
        `${weak} cliente(s) Wi-Fi com sinal fraco (pior RSSI ${diag.wifiWorstRssi} dBm)`,
        diag.wifiWorstRssi,
      );
    } else if (diag.wifiWorstRssi !== null) {
      await this.resolveAlert(deviceId, Tr069AlertType.WIFI_WEAK_CLIENT);
    }

    // Congestionamento Wi-Fi. ⚠️ O firmware HW_WAP_CWMP_V02 NÃO expõe utilização
    // de canal (airtime), então usamos um PROXY: nº de clientes associados por
    // banda. Acima de TR069_WIFI_MAX_CLIENTS (default 20) abre WIFI_HIGH_UTIL.
    if (diag.wifiClients24 !== null || diag.wifiClients5 !== null) {
      const maxClients = Number(process.env.TR069_WIFI_MAX_CLIENTS ?? '20');
      const c24 = diag.wifiClients24 ?? 0;
      const c5 = diag.wifiClients5 ?? 0;
      if (c24 >= maxClients || c5 >= maxClients) {
        await this.openAlert(
          tenantId,
          deviceId,
          Tr069AlertType.WIFI_HIGH_UTIL,
          Tr069AlertSeverity.WARNING,
          `Wi-Fi congestionado: ${c24} cliente(s) em 2.4GHz / ${c5} em 5GHz (limite ${maxClients})`,
          Math.max(c24, c5),
        );
      } else {
        await this.resolveAlert(deviceId, Tr069AlertType.WIFI_HIGH_UTIL);
      }
    }
  }

  /**
   * Alerta de degradação de fibra: FEC/HEC corrigidos subindo entre leituras.
   * Compara contadores com a leitura anterior; ignora reset (delta negativo).
   * ⚠️ Limiar em env (TR069_FEC_HEC_DELTA_ALERT, default 1000) — validar com
   * dados reais; contadores são cumulativos e a unidade varia por firmware.
   */
  private async evaluateFiberAlert(
    tenantId: string,
    deviceId: string,
    diag: ExtractedDiagnostics,
    prev: { fecErrors: bigint | null; hecErrors: bigint | null } | null,
  ): Promise<void> {
    const threshold = Number(process.env.TR069_FEC_HEC_DELTA_ALERT ?? '1000');
    if (
      !prev ||
      diag.fecErrors === null ||
      diag.hecErrors === null ||
      prev.fecErrors === null ||
      prev.hecErrors === null
    ) {
      return; // sem base de comparação — não mexe no alerta
    }
    const fecD = diag.fecErrors - Number(prev.fecErrors);
    const hecD = diag.hecErrors - Number(prev.hecErrors);
    const delta = (fecD > 0 ? fecD : 0) + (hecD > 0 ? hecD : 0);
    if (delta >= threshold) {
      await this.openAlert(
        tenantId,
        deviceId,
        Tr069AlertType.OPTICAL_FIBER_DEGRADED,
        Tr069AlertSeverity.WARNING,
        `Erros ópticos (FEC+HEC) subiram ${delta} desde a última leitura — verifique fibra/conector`,
        delta,
      );
    } else {
      await this.resolveAlert(deviceId, Tr069AlertType.OPTICAL_FIBER_DEGRADED);
    }
  }

  /**
   * Alerta de WAN/PPPoE caída pelo lado do CPE. Abre quando ConnectionStatus
   * não está "Connected" (e o CPE ainda alcança o ACS pela WAN de gerência);
   * resolve quando reconecta. Mostra o LastConnectionError pra triagem.
   */
  private async evaluateWanAlert(
    tenantId: string,
    deviceId: string,
    diag: ExtractedDiagnostics,
  ): Promise<void> {
    if (diag.pppStatus === null) return; // sem dado de PPP — não mexe
    if (/connected/i.test(diag.pppStatus)) {
      await this.resolveAlert(deviceId, Tr069AlertType.WAN_DOWN);
      return;
    }
    const err = diag.pppLastError && !/ERROR_NONE/i.test(diag.pppLastError) ? ` (${diag.pppLastError})` : '';
    await this.openAlert(
      tenantId,
      deviceId,
      Tr069AlertType.WAN_DOWN,
      Tr069AlertSeverity.WARNING,
      `WAN do cliente não conectada: ${diag.pppStatus}${err}`,
      null,
    );
  }

  /**
   * Garante no máximo 1 alerta OPEN por (device, type): atualiza o existente
   * (refresh de valor/severidade/lastSeen) ou cria um novo.
   */
  private async openAlert(
    tenantId: string,
    deviceId: string,
    type: Tr069AlertType,
    severity: Tr069AlertSeverity,
    message: string,
    value: number | null,
  ): Promise<void> {
    const existing = await this.prisma.tr069Alert.findFirst({
      where: { deviceId, type, status: Tr069AlertStatus.OPEN },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.tr069Alert.update({
        where: { id: existing.id },
        data: { severity, message, value, lastSeenAt: new Date() },
      });
      return;
    }
    await this.prisma.tr069Alert.create({
      data: { tenantId, deviceId, type, severity, message, value },
    });
    this.logger.warn(`[CWMP] alerta ${type} aberto device=${deviceId.slice(0, 8)} sev=${severity}`);
  }

  /** Resolve qualquer alerta OPEN do tipo (condição voltou ao normal). */
  private async resolveAlert(deviceId: string, type: Tr069AlertType): Promise<void> {
    const res = await this.prisma.tr069Alert.updateMany({
      where: { deviceId, type, status: Tr069AlertStatus.OPEN },
      data: { status: Tr069AlertStatus.RESOLVED, resolvedAt: new Date() },
    });
    if (res.count > 0) {
      this.logger.log(`[CWMP] alerta ${type} resolvido device=${deviceId.slice(0, 8)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  private createSession(): SessionState {
    return {
      deviceId: null,
      deviceDbId: null,
      inflightTask: null,
      createdAt: Date.now(),
      events: [],
    };
  }

  private gcSessions(): void {
    const now = Date.now();
    let purged = 0;
    for (const [sid, state] of this.sessions.entries()) {
      if (now - state.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(sid);
        purged += 1;
        if (state.inflightTask) {
          // Task ficou pendurada — marcar TIMEOUT pra próxima tentativa
          this.prisma.tr069Task
            .update({
              where: { id: state.inflightTask.id },
              data: { status: 'FAILED', error: 'session timeout (CPE não respondeu)' },
            })
            .catch((err: unknown) =>
              this.logger.error(`[CWMP] gc: falhou marcar task como timeout: ${String(err)}`),
            );
        }
      }
    }
    if (purged > 0) this.logger.debug(`[CWMP] GC purged ${purged} session(s)`);
  }

  /** Snapshot pra debug/admin. */
  getStats(): { activeSessions: number; oldest: number | null } {
    let oldest: number | null = null;
    for (const s of this.sessions.values()) {
      if (oldest === null || s.createdAt < oldest) oldest = s.createdAt;
    }
    return {
      activeSessions: this.sessions.size,
      oldest: oldest ? Date.now() - oldest : null,
    };
  }
}
