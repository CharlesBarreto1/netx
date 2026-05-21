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
import type { Tr069Task } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  buildInformResponse,
  extractInform,
  parseCwmp,
  type ParsedCwmpMessage,
} from './cwmp-soap';
import { buildRpcForTask, detectFault, isResponseForTask } from './cwmp-rpc';

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
      this.logger.warn(
        `[CWMP] device órfão (sem ProvisioningService prep) — criando row sem tenantId. ` +
          `Admin precisa vincular manualmente. device=${inform.deviceId}`,
      );
      // Cria placeholder pra admin investigar. tenantId tem que existir
      // (NOT NULL no schema). Usamos o primeiro tenant ativo como fallback —
      // suficiente pro MVP single-tenant; multi-tenant exigirá lookup por
      // SerialNumber → contract.macAddress → contract.tenantId.
      const anyTenant = await this.prisma.tenant.findFirst({
        where: { deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!anyTenant) {
        this.logger.error('[CWMP] nenhum tenant cadastrado — não consigo persistir device órfão');
      } else {
        const created = await this.prisma.tr069Device.create({
          data: {
            tenantId: anyTenant.id,
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
      }
    }

    return {
      xml: buildInformResponse(parsed.cwmpId ?? '1'),
      status: 200,
      sessionId: sid,
    };
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
    await this.prisma.tr069Task.update({
      where: { id: task.id },
      data: {
        status: 'DONE',
        result: { kind: parsed.kind, body: parsed.body } as unknown as object,
        completedAt: new Date(),
      },
    });
    this.logger.log(`[CWMP] task ${task.id.slice(0, 8)} DONE (${parsed.kind})`);
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
