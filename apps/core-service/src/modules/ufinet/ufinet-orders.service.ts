/**
 * Máquina de estados das ordens Ufinet.
 *
 * Traduz as ações do NetX (alta/confirmar-ONT/confirmação/suspender/reativar/
 * baja/cancelar) nas operações TMF e avança o `lifecycle` de cada
 * `UfinetService`. O poller (cron) chama `advance()` nos estados transientes.
 *
 * Padrão SEND/POLL por passo: `currentOrderId == null` → ainda não enviei a
 * operação (faço o POST/PATCH e gravo o id); `!= null` → faço poll do
 * resultado e avanço o lifecycle quando concluir. Assim o poller pode rodar a
 * mesma linha N vezes sem reenviar a operação.
 *
 * Caso A: a Ufinet só provisiona a óptica; o RADIUS/PPPoE local autoriza o
 * tráfego. Todo cliente vai como "ZUX 1G" (banda real é do Mikrotik).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Olt, Prisma, UfinetService } from '@prisma/client';
import {
  paginationMeta,
  UfinetOltConfigSchema,
  UfinetCredentialsSchema,
  type ListUfinetServicesQuery,
  type Paginated,
  type RetryUfinetServiceRequest,
  type UfinetServiceResponse,
  type UfinetTraceEntry,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { FibermapSubscriberService } from '../fibermap/subscriber.service';
import { PrismaService } from '../prisma/prisma.service';

import { UfinetClientService, UfinetApiError } from './ufinet-client.service';
import { UfinetHealthService } from './ufinet-health.service';
import { ufinetTrace } from './ufinet-trace';
import {
  extractOrder,
  extractOrderId,
  normalizeUfinetState,
  UFINET_SPEC,
  UFINET_STATE,
  type UfinetConnection,
  type UfinetInventoryService,
  type UfinetOrderResponse,
} from './ufinet.types';

const SEND_RETRY_MS = 8_000; // logo após enviar, faz o 1º poll rápido
const POLL_MIN_MS = 15_000;
const POLL_MAX_MS = 5 * 60_000;
const MAX_ATTEMPTS = 240; // ~horas de poll antes de desistir (FAILED)
// Ufinet 426 "Tareas pendientes": aprovisionamento ainda em trabalho de campo/
// infra. NÃO é erro — espera calma, sem contar pro limite de FAILED.
const PENDING_RETRY_MS = 60_000;
// Teto de espera em "aprovisionando": se a Ufinet não concluir em 1h, vira
// FAILED em vez de repollar pra sempre (ex.: serial errado / ONT inexistente).
const PENDING_MAX_MS = 60 * 60_000;
// Backoff por serviço quando a Ufinet está INDISPONÍVEL (infra). Não conta pro
// limite de FAILED — só espaça a re-tentativa enquanto não recupera.
const INFRA_RETRY_MS = 2 * 60_000;
// Teto de 5xx/timeout persistente num ÚNICO serviço com a Ufinet NO AR (pedido
// envenenado, ex.: ordem travada que dá 500 no cancel) antes de virar FAILED.
const INFRA_FAIL_LIMIT = 8;

/**
 * Erro de INFRA (Ufinet inalcançável/instável) vs erro de negócio. Transporte
 * (status 0), 5xx e 429 = Ufinet fora; 4xx/426 = Ufinet respondeu (no ar).
 */
function isUfinetUnavailable(err: unknown): boolean {
  if (!(err instanceof UfinetApiError)) return true; // erro não-HTTP = transporte
  const s = err.status;
  return s === 0 || s === 429 || s >= 500;
}

@Injectable()
export class UfinetOrdersService {
  private readonly logger = new Logger(UfinetOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly client: UfinetClientService,
    private readonly audit: AuditService,
    private readonly health: UfinetHealthService,
    private readonly fibermapSubscriber: FibermapSubscriberService,
  ) {}

  /** Estado do circuit breaker da Ufinet (pra UI/diagnóstico). */
  healthSnapshot() {
    return this.health.snapshot();
  }

  // ===========================================================================
  // Conexão a partir da OLT (vendor=UFINET, providerMode=ORCHESTRATOR)
  // ===========================================================================
  resolveConnection(olt: Pick<Olt, 'apiEndpoint' | 'apiCredentialsEnc' | 'apiConfig'>): UfinetConnection {
    if (!olt.apiEndpoint) throw new Error('OLT Ufinet sem apiEndpoint configurado');
    if (!olt.apiCredentialsEnc) throw new Error('OLT Ufinet sem credenciais configuradas');

    const credsRaw = this.crypto.decrypt(olt.apiCredentialsEnc);
    const creds = UfinetCredentialsSchema.parse(JSON.parse(credsRaw));
    const config = UfinetOltConfigSchema.parse(olt.apiConfig ?? {});

    return {
      baseUrl: olt.apiEndpoint,
      tokenUrl: config.tokenUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      accessKey: creds.accessKey,
      scope: config.scope,
      operator: config.operator,
      region: config.region,
      contractId: config.contractId,
      polygonAlias: config.polygonAlias ?? null,
      userName: config.userName,
      country: config.country,
      city: config.city ?? null,
      nms: config.nms,
      nmsId: config.nmsId,
      bandwidthProfile: config.bandwidthProfile,
      bandwidthProfileId: config.bandwidthProfileId,
      minimalProvidePayload: config.minimalProvidePayload,
      inventoryFilterParam: config.inventoryFilterParam ?? null,
    };
  }

  /**
   * Teste de conexão REAL: valida OAuth (client_id/secret/scope/tokenUrl) +
   * Access key + conectividade/whitelist com um GET autenticado. Usado pelo
   * botão "Testar" da OLT. NÃO cria nada na Ufinet.
   */
  async testConnection(
    olt: Pick<Olt, 'apiEndpoint' | 'apiCredentialsEnc' | 'apiConfig'>,
  ): Promise<{ success: boolean; message: string; durationMs: number }> {
    const started = Date.now();
    try {
      const conn = this.resolveConnection(olt);
      await this.client.getToken(conn); // valida OAuth
      const orders = await this.client.listOrders(conn); // valida Access key + rede/whitelist
      return {
        success: true,
        message: `OK — OAuth + API Ufinet respondendo (${conn.operator}/${conn.region}; ${
          Array.isArray(orders) ? orders.length : 0
        } ordens visíveis).`,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      const message =
        err instanceof UfinetApiError
          ? `${err.message}${err.status ? ` (HTTP ${err.status})` : ''}`
          : err instanceof Error
            ? err.message
            : String(err);
      return { success: false, message, durationMs: Date.now() - started };
    }
  }

  // ===========================================================================
  // Entradas (enganches do contrato) — só mudam estado; o poller executa
  // ===========================================================================
  /**
   * Cria (ou re-aproveita) o UfinetService de um contrato em PENDING_PROVIDE.
   * Idempotente: se já existir, não duplica. Chamado fora da TX do contrato,
   * defensivo — falhar aqui não quebra a criação do contrato.
   */
  async enqueueProvide(input: {
    tenantId: string;
    contractId: string;
    oltId: string;
    actorUserId?: string | null;
  }): Promise<UfinetService> {
    const existing = await this.prisma.ufinetService.findUnique({
      where: { contractId: input.contractId },
    });
    if (existing) {
      // Terminal (baja/cancelación): a Ufinet CONSOME o externalId/marquilla. A
      // API NÃO tem operação de "reativar cancelado" — o REACTIVATE_SERVICE é só
      // o par da SUSPENSÃO. O único caminho documentado pra voltar a ter serviço
      // depois de baja/cancelación é uma ALTA NOVA. E re-enviar `provide` com o
      // MESMO externalId é recusado por duplicidade (erro MOP-410 "existen
      // servicios asociados al ExternalServiceId" / "el externalService ID ya se
      // ha usado anteriormente"). Então re-armamos a MESMA linha com marquilla
      // NOVA (sufixo -R{n}) e voltamos pra PENDING_PROVIDE. Ver ufinet/ (PDF +
      // planilha de erros) na raiz do repo.
      if (existing.lifecycle === 'CANCELLED' || existing.lifecycle === 'CEASED') {
        return this.reprovisionTerminal(existing, input.actorUserId ?? null);
      }
      return existing;
    }

    // externalId/Marquilla = código do contrato (Contract.code, ex.: ZUX-234),
    // gerado na CRIAÇÃO do contrato. A Ufinet só HERDA esse código — não há
    // sequencial próprio aqui (o sequencial vive no Contract).
    const contract = await this.prisma.contract.findUnique({
      where: { id: input.contractId },
      select: { code: true },
    });
    const externalId = contract?.code?.trim();
    if (!externalId) {
      throw new Error(
        `Ufinet: contrato ${input.contractId} sem código (Contract.code) — ` +
          'não dá pra montar o externalId/Marquilla',
      );
    }

    try {
      const created = await this.prisma.ufinetService.create({
        data: {
          tenantId: input.tenantId,
          contractId: input.contractId,
          oltId: input.oltId,
          externalId,
          labelDrop: externalId,
          lifecycle: 'PENDING_PROVIDE',
          nextAttemptAt: new Date(),
        },
      });
      await this.audit.log({
        tenantId: input.tenantId,
        userId: input.actorUserId ?? null,
        actor: input.actorUserId ? undefined : 'system',
        action: 'ufinet.provide.enqueued',
        resource: 'ufinet_services',
        resourceId: created.id,
        metadata: { externalId },
      });
      return created;
    } catch (err) {
      // Corrida: outra chamada já criou o serviço (unique contractId) → devolve.
      if ((err as { code?: string })?.code === 'P2002') {
        const again = await this.prisma.ufinetService.findUnique({
          where: { contractId: input.contractId },
        });
        if (again) return again;
      }
      throw err;
    }
  }

  /**
   * Re-arma um serviço em estado TERMINAL (CANCELLED/CEASED) pra uma alta NOVA:
   * gera marquilla nova (Contract.code + sufixo -R{n}), zera todos os ids do
   * lado Ufinet e volta pra PENDING_PROVIDE. Preserva serialNumber + ctoPort
   * (dropPort): quando a ONT física continua instalada (ex.: reativar um
   * contrato que estava ativo), o `providePoll` reconfirma sozinho ao reservar
   * a porta — sem precisar de nova visita. A MESMA linha é reusada (o unique é
   * por contractId); o trace antigo fica preservado sob o externalId anterior.
   */
  private async reprovisionTerminal(
    svc: UfinetService,
    actorUserId: string | null,
  ): Promise<UfinetService> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: svc.contractId },
      select: { code: true },
    });
    const baseCode = contract?.code?.trim();
    if (!baseCode) {
      throw new Error(
        `Ufinet: contrato ${svc.contractId} sem código (Contract.code) — não dá ` +
          'pra re-armar a alta com marquilla nova',
      );
    }
    const newExternalId = nextReactivationExternalId(svc.externalId, baseCode);
    const updated = await this.prisma.ufinetService.update({
      where: { id: svc.id },
      data: {
        externalId: newExternalId,
        labelDrop: newExternalId,
        lifecycle: 'PENDING_PROVIDE',
        // Serviço NOVO na Ufinet → zera todos os ids do bundle e da operação.
        ufinetContractId: null,
        serviceOrderId: null,
        parentServiceId: null,
        fiberAccessServiceId: null,
        hsdServiceId: null,
        resPonAccessServiceId: null,
        currentOrderId: null,
        ufinetState: null,
        waitingCode: null,
        // Preserva serialNumber + ctoPort + dropPort (ONT física segue lá).
        attempts: 0,
        error: null,
        pendingSince: null,
        nextAttemptAt: new Date(),
      },
    });
    await this.audit.log({
      tenantId: svc.tenantId,
      userId: actorUserId ?? null,
      actor: actorUserId ? undefined : 'system',
      action: 'ufinet.reprovision.rearmed',
      resource: 'ufinet_services',
      resourceId: svc.id,
      beforeState: { lifecycle: svc.lifecycle, externalId: svc.externalId },
      afterState: { lifecycle: 'PENDING_PROVIDE', externalId: newExternalId },
    });
    this.logger.log(
      `[ufinet] ${svc.externalId} (${svc.lifecycle}) RE-ARMADO como ${newExternalId} → ` +
        'PENDING_PROVIDE (alta nova, marquilla nova)',
    );
    return updated;
  }

  /**
   * ADOÇÃO — vincula no NetX um serviço que JÁ está ativo na Ufinet (cadastrado
   * manualmente lá). Consulta o inventário pelo externalId (= Contract.code) pra
   * descobrir os IDs do bundle e nasce já ACTIVE (NÃO faz alta — o serviço já
   * existe na Ufinet; o poller não vai reprovisionar).
   */
  async adoptExisting(input: {
    tenantId: string;
    contractId: string;
    oltId: string;
    actorUserId?: string | null;
  }): Promise<UfinetService> {
    const existing = await this.prisma.ufinetService.findUnique({
      where: { contractId: input.contractId },
    });
    if (existing) {
      throw new ConflictException('Contrato já tem serviço Ufinet vinculado');
    }

    const contract = await this.prisma.contract.findUnique({
      where: { id: input.contractId },
      select: { code: true, tenantId: true },
    });
    const externalId = contract?.code?.trim();
    if (!contract || contract.tenantId !== input.tenantId || !externalId) {
      throw new BadRequestException(
        'Contrato sem código (Contract.code) — não dá pra casar com o externalId na Ufinet',
      );
    }

    const olt = await this.prisma.olt.findFirst({
      where: { id: input.oltId, tenantId: input.tenantId, deletedAt: null },
    });
    if (!olt || olt.vendor !== 'UFINET' || olt.providerMode !== 'ORCHESTRATOR') {
      throw new BadRequestException('OLT informada não é uma OLT Ufinet (ORCHESTRATOR)');
    }
    const conn = this.resolveConnection(olt);

    // Descobre os IDs do bundle + serial + CTO consultando o inventário real.
    const ids = await ufinetTrace.run(
      { tenantId: input.tenantId, externalId },
      () => this.resolveBundle(conn, externalId),
    );
    if (!ids) {
      throw new BadRequestException(
        `Serviço "${externalId}" não encontrado no inventário da Ufinet desta OLT ` +
          '(confira o externalId e se a OLT é o polígono correto).',
      );
    }
    const bundle = await this.fetchBundleServices(conn, externalId);
    const datos = bundle.get(UFINET_SPEC.DATOS);
    const ctoPort =
      datos?.serviceCharacteristic?.find((c) => c.name?.toUpperCase() === 'CTO_PORT')?.value ?? null;
    const serial =
      datos?.serviceCharacteristic?.find((c) => c.name?.toUpperCase() === 'SERIAL_NUMBER')?.value ??
      null;

    const created = await this.prisma.ufinetService.create({
      data: {
        tenantId: input.tenantId,
        contractId: input.contractId,
        oltId: input.oltId,
        externalId,
        labelDrop: externalId,
        lifecycle: 'ACTIVE',
        ufinetState: 'completed',
        parentServiceId: ids.parent,
        fiberAccessServiceId: ids.fiberAccess,
        hsdServiceId: ids.hsd,
        resPonAccessServiceId: ids.resPonAccess,
        ctoPort,
        serialNumber: serial,
        nextAttemptAt: null,
      },
    });
    await this.audit.log({
      tenantId: input.tenantId,
      userId: input.actorUserId ?? null,
      action: 'ufinet.service.adopted',
      resource: 'ufinet_services',
      resourceId: created.id,
      metadata: { externalId, oltId: input.oltId, ctoPort, serial },
    });
    this.logger.log(`[ufinet] ${externalId} ADOTADO (serviço já ativo na Ufinet) → ACTIVE`);
    return created;
  }

  /**
   * Confirma a ONT (chamado no install). Se a alta já reservou a porta
   * (RESERVED), transiciona direto pra CONFIRMING_ONT. Se ainda está em
   * PENDING_PROVIDE/PROVIDING (técnico chegou rápido), só GRAVA o SN — o
   * `providePoll` avança automaticamente pra CONFIRMING_ONT ao reservar.
   */
  async requestConfirmOnt(
    tenantId: string,
    contractId: string,
    serialNumber: string,
    opts?: { ctoPort?: string | null; dropPort?: string | null; actorUserId?: string | null },
  ): Promise<UfinetService> {
    const actorUserId = opts?.actorUserId ?? null;
    // ctoPort = CAIXA real do técnico → sobrescreve a CTO sugerida na confirmação
    // (vai pra Ufinet). dropPort = porta, só doc interna. null/'' = mantém.
    const ctoOverride = {
      ...(opts?.ctoPort?.trim() ? { ctoPort: opts.ctoPort.trim() } : {}),
      ...(opts?.dropPort?.trim() ? { dropPort: opts.dropPort.trim() } : {}),
    };
    const svc = await this.getByContract(tenantId, contractId);
    if (svc.lifecycle === 'RESERVED' || svc.lifecycle === 'CONFIRMING_ONT') {
      return this.transition(
        svc,
        'CONFIRMING_ONT',
        { serialNumber, ...ctoOverride, currentOrderId: null, error: null, attempts: 0, nextAttemptAt: new Date() },
        actorUserId,
        'ufinet.confirm_ont.requested',
      );
    }
    if (svc.lifecycle === 'PENDING_PROVIDE' || svc.lifecycle === 'PROVIDING') {
      const updated = await this.save(svc.id, { serialNumber, ...ctoOverride });
      await this.audit.log({
        tenantId,
        userId: actorUserId ?? null,
        actor: actorUserId ? undefined : 'system',
        action: 'ufinet.confirm_ont.deferred',
        resource: 'ufinet_services',
        resourceId: svc.id,
        metadata: { serialNumber, lifecycle: svc.lifecycle, ...ctoOverride },
      });
      return updated;
    }
    throw new Error(`Ufinet: confirmar ONT inválido no lifecycle ${svc.lifecycle}`);
  }

  async requestSuspend(tenantId: string, contractId: string, actorUserId?: string | null) {
    const svc = await this.getByContract(tenantId, contractId);
    return this.transition(svc, 'SUSPENDING', this.resetStep(), actorUserId, 'ufinet.suspend.requested');
  }

  async requestReactivate(tenantId: string, contractId: string, actorUserId?: string | null) {
    const svc = await this.getByContract(tenantId, contractId);
    return this.transition(svc, 'REACTIVATING', this.resetStep(), actorUserId, 'ufinet.reactivate.requested');
  }

  /**
   * Encerra o serviço Ufinet. Decide entre:
   *   - Cancelación (CancelServiceOrder) — só funciona enquanto o serviço está
   *     em Reserved/Design (ONT NUNCA confirmada). Estados iniciais.
   *   - Baja (cease) — pra serviço que JÁ foi provisionado (ONT confirmada),
   *     esteja ele active, suspended, swapping ou até FAILED (um swap que
   *     falhou NÃO desfaz a ativação na Ufinet — lá o serviço segue active).
   *
   * Decidir por "já foi provisionado" (e não pelo lifecycle exato) é o robusto:
   * o lifecycle local pode estar FAILED/dessincronizado por uma operação de
   * manutenção que falhou, mas o serviço continua ativo na Ufinet → baja.
   */
  async requestTeardown(tenantId: string, contractId: string, actorUserId?: string | null) {
    const svc = await this.getByContract(tenantId, contractId);
    // Só é cancelável (Cancelación) enquanto NUNCA confirmou a ONT.
    const neverConfirmed =
      (svc.lifecycle === 'PENDING_PROVIDE' ||
        svc.lifecycle === 'PROVIDING' ||
        svc.lifecycle === 'RESERVED') &&
      !svc.resPonAccessServiceId;
    const target = neverConfirmed ? 'CANCELLING' : 'CEASING';
    const action = neverConfirmed ? 'ufinet.cancel.requested' : 'ufinet.cease.requested';
    return this.transition(svc, target, this.resetStep(), actorUserId, action);
  }

  /**
   * Troca de ONT — DECIDE o caminho certo conforme o estado do serviço na Ufinet:
   *
   *  a) Serviço JÁ ativo (ACTIVE/SUSPENDED) → **Cambio de ONT real**
   *     (CHANGE_RESOURCE): a Ufinet aceita trocar a ONT de um serviço no ar.
   *
   *  b) Alta em processo, NUNCA ativou (ex.: ficou em 426 porque o técnico
   *     confirmou com o serial errado) mas já reservou o bundle
   *     (resPonAccessServiceId presente) → **re-confirma a alta** com o serial
   *     novo (volta a CONFIRMING_ONT). A Ufinet RECUSA CHANGE_RESOURCE em
   *     serviço não-ativo ("rejected"); o certo é reenviar o serial na
   *     confirmação da própria alta.
   *
   *  c) Ainda nem reservou a porta → só grava o serial; `providePoll` avança
   *     pra CONFIRMING_ONT sozinho ao reservar.
   *
   * Isso evita o beco "cambio rejeitado" que travava o serviço em SWAPPING_ONT.
   */
  async requestSwapOnt(
    tenantId: string,
    contractId: string,
    newSerial: string,
    actorUserId?: string | null,
  ): Promise<UfinetService> {
    const svc = await this.getByContract(tenantId, contractId);

    // a) Serviço já provisionado/ativo → cambio de ONT real.
    if (svc.lifecycle === 'ACTIVE' || svc.lifecycle === 'SUSPENDED') {
      return this.transition(
        svc,
        'SWAPPING_ONT',
        { ...this.resetStep(), serialNumber: newSerial },
        actorUserId,
        'ufinet.swap_ont.requested',
      );
    }

    // b) Alta não-ativa mas com bundle reservado → re-confirma a alta com o SN
    //    novo (a Ufinet não aceita cambio aqui; reenviar serial na confirmação).
    if (svc.resPonAccessServiceId && svc.parentServiceId) {
      return this.transition(
        svc,
        'CONFIRMING_ONT',
        { ...this.resetStep(), serialNumber: newSerial },
        actorUserId,
        'ufinet.reconfirm_ont.requested',
      );
    }

    // c) Antes de reservar → só grava o serial; o providePoll segue o fluxo.
    return this.save(svc.id, { serialNumber: newSerial });
  }

  /**
   * Ações pontuais de manutenção/diagnóstico na ONT (NÃO mexem no lifecycle do
   * serviço — ele segue ACTIVE):
   *   REFRESH_ONT  — reaplica config na ONT
   *   RESET_ONT    — reinicia a ONT remotamente
   *   STATUS_ONT   — lê níveis ópticos (sinal)
   *
   * ASSÍNCRONO (a cadeia orquestrador→NCS→OLT→ONT é lenta e estoura o timeout
   * de 15s do gateway): `dispatchOntAction` só DISPARA o POST e devolve o
   * orderId na hora; o front consulta o resultado com `pollOntAction(orderId)`
   * (GET rápido) até completar. Cada chamada fica bem abaixo dos 15s.
   */
  async dispatchOntAction(
    tenantId: string,
    contractId: string,
    action: 'REFRESH_ONT' | 'RESET_ONT' | 'STATUS_ONT',
    actorUserId?: string | null,
  ): Promise<{ orderId: string | null; status: 'dispatched' | 'failed'; message?: string }> {
    const conn = await this.connForContract(tenantId, contractId);
    const svc = conn.svc;

    const descriptions: Record<typeof action, string> = {
      REFRESH_ONT: 'REFRESCAR ONT',
      RESET_ONT: 'RESETEAR ONT',
      STATUS_ONT: 'CONSULTA DE NIVELES',
    };
    const payload = {
      Region: conn.region,
      Operator: conn.operator,
      ServiceOrderType: action,
      Description: descriptions[action],
      ExternalId: svc.externalId,
      RequestedStartDate: new Date().toISOString(),
      Priority: '1',
      RelatedParty: [{ name: conn.userName, role: 'requester' }],
      ServiceOrderItem: [
        {
          Action: 'NOCHANGE',
          Service: {
            ExternalServiceId: svc.parentServiceId ?? svc.externalId,
            ServiceType: 'CFS',
            serviceCharacteristic: [],
            ServiceSpecification: { id: 'RES_PON_ACCESS', version: '1.0' },
          },
        },
      ],
    };

    // Roda dentro do contexto de trace pra o client persistir o request/response
    // em ufinet_request_logs (senão a chamada acontece mas o trace fica vazio).
    const resp = await ufinetTrace.run(
      { tenantId: svc.tenantId, externalId: svc.externalId },
      () => this.client.createOrder(conn, payload),
    );
    const orderId = extractOrderId(resp);
    await this.audit.log({
      tenantId,
      userId: actorUserId ?? null,
      actor: actorUserId ? undefined : 'system',
      action: `ufinet.ont.${action.toLowerCase()}`,
      resource: 'ufinet_services',
      resourceId: svc.id,
      metadata: { externalId: svc.externalId, orderId },
    });
    if (!orderId) return { orderId: null, status: 'failed', message: 'sem orderId' };
    return { orderId, status: 'dispatched' };
  }

  /** Consulta o resultado de uma ação de ONT já disparada (GET rápido). */
  async pollOntAction(
    tenantId: string,
    contractId: string,
    orderId: string,
  ): Promise<{
    status: 'completed' | 'failed' | 'pending';
    characteristics: Array<{ name: string; value: string }>;
    message?: string;
  }> {
    const conn = await this.connForContract(tenantId, contractId);
    const order = await ufinetTrace.run(
      { tenantId: conn.svc.tenantId, externalId: conn.svc.externalId },
      () => this.client.getOrder(conn, orderId),
    );
    const state = normalizeUfinetState(order.state);
    if (state === UFINET_STATE.COMPLETED) {
      const characteristics = extractOrderCharacteristics(order);
      // STATUS_ONT (consulta de níveis): persiste a leitura pra exibir no
      // contrato com timestamp. REFRESH/RESET não têm níveis — array vazio.
      if (
        characteristics.length > 0 &&
        (order.serviceOrderType ?? '').toUpperCase() === 'STATUS_ONT'
      ) {
        await this.prisma.ufinetService.update({
          where: { id: conn.svc.id },
          data: {
            lastSignalLevels: characteristics as Prisma.InputJsonValue,
            lastSignalAt: new Date(),
          },
        });
      }
      return { status: 'completed', characteristics };
    }
    if (state === UFINET_STATE.FAILED) {
      return { status: 'failed', characteristics: [], message: this.errText(order) ?? 'falhou' };
    }
    return { status: 'pending', characteristics: [] };
  }

  /** Resolve a conexão Ufinet a partir do contrato (svc + OLT decriptada). */
  private async connForContract(
    tenantId: string,
    contractId: string,
  ): Promise<UfinetConnection & { svc: UfinetService }> {
    const svc = await this.getByContract(tenantId, contractId);
    const olt = await this.prisma.olt.findUnique({ where: { id: svc.oltId } });
    if (!olt) throw new NotFoundException('OLT do serviço Ufinet não encontrada');
    return { ...this.resolveConnection(olt), svc };
  }

  // ===========================================================================
  // API de leitura / retry (controller + UI)
  // ===========================================================================
  async list(
    tenantId: string,
    q: ListUfinetServicesQuery,
  ): Promise<Paginated<UfinetServiceResponse>> {
    const where: Prisma.UfinetServiceWhereInput = {
      tenantId,
      ...(q.lifecycle ? { lifecycle: q.lifecycle } : {}),
      ...(q.oltId ? { oltId: q.oltId } : {}),
      ...(q.search
        ? { OR: [{ externalId: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.ufinetService.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip,
        take: q.pageSize,
        include: { olt: { select: { name: true } } },
      }),
      this.prisma.ufinetService.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toResponse(r)),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async findByContractForApi(
    tenantId: string,
    contractId: string,
  ): Promise<UfinetServiceResponse | null> {
    const row = await this.prisma.ufinetService.findUnique({
      where: { contractId },
      include: { olt: { select: { name: true } } },
    });
    if (!row || row.tenantId !== tenantId) return null;
    return this.toResponse(row);
  }

  /** Re-arma um serviço FAILED pro poller (deriva o passo a retomar). */
  async retry(
    tenantId: string,
    id: string,
    req: RetryUfinetServiceRequest,
  ): Promise<UfinetServiceResponse> {
    const row = await this.prisma.ufinetService.findUnique({
      where: { id },
      include: { olt: { select: { name: true } } },
    });
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException('Serviço Ufinet não encontrado');
    }
    const { lifecycle, currentOrderId } = this.deriveResume(row);
    const updated = await this.prisma.ufinetService.update({
      where: { id },
      data: {
        lifecycle,
        currentOrderId,
        error: null,
        attempts: req.resetAttempts ? 0 : row.attempts,
        nextAttemptAt: new Date(),
      },
      include: { olt: { select: { name: true } } },
    });
    await this.audit.log({
      tenantId,
      action: 'ufinet.service.retry',
      resource: 'ufinet_services',
      resourceId: id,
      beforeState: { lifecycle: row.lifecycle },
      afterState: { lifecycle },
    });
    return this.toResponse(updated);
  }

  /**
   * De um estado FAILED, deriva onde retomar: re-poll da alta se já há ordem,
   * senão re-envia; confirma ONT se já reservado + tem SN; senão volta a
   * RESERVED. Operações PATCH são idempotentes; a alta NÃO é re-enviada se já
   * existe serviceOrderId (evita externalId duplicado).
   */
  private deriveResume(svc: UfinetService): {
    lifecycle: UfinetService['lifecycle'];
    currentOrderId: string | null;
  } {
    const reserved = !!svc.parentServiceId && !!svc.resPonAccessServiceId;
    if (!svc.serviceOrderId) return { lifecycle: 'PENDING_PROVIDE', currentOrderId: null };
    if (!reserved) return { lifecycle: 'PROVIDING', currentOrderId: svc.serviceOrderId };
    if (svc.serialNumber) return { lifecycle: 'CONFIRMING_ONT', currentOrderId: null };
    return { lifecycle: 'RESERVED', currentOrderId: null };
  }

  private toResponse(
    s: UfinetService & { olt?: { name: string } | null },
  ): UfinetServiceResponse {
    return {
      id: s.id,
      contractId: s.contractId,
      oltId: s.oltId,
      oltName: s.olt?.name ?? null,
      externalId: s.externalId,
      labelDrop: s.labelDrop,
      bandwidthProfile: s.bandwidthProfile,
      lifecycle: s.lifecycle,
      ufinetContractId: s.ufinetContractId,
      serviceOrderId: s.serviceOrderId,
      parentServiceId: s.parentServiceId,
      resPonAccessServiceId: s.resPonAccessServiceId,
      ctoPort: s.ctoPort,
      dropPort: s.dropPort,
      serialNumber: s.serialNumber,
      lastSignalLevels:
        (s.lastSignalLevels as Array<{ name: string; value: string }> | null) ?? null,
      lastSignalAt: s.lastSignalAt?.toISOString() ?? null,
      ufinetState: s.ufinetState,
      waitingCode: s.waitingCode,
      attempts: s.attempts,
      nextAttemptAt: s.nextAttemptAt?.toISOString() ?? null,
      error: s.error,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  /**
   * Trace completo (request/response) das chamadas à Ufinet desse serviço —
   * evidência pra abrir chamado com eles. Correlacionado por externalId.
   */
  async getTrace(tenantId: string, serviceId: string): Promise<UfinetTraceEntry[]> {
    const svc = await this.prisma.ufinetService.findFirst({
      where: { id: serviceId, tenantId },
      select: { externalId: true },
    });
    if (!svc) throw new NotFoundException('Serviço Ufinet não encontrado');
    const logs = await this.prisma.ufinetRequestLog.findMany({
      where: { tenantId, externalId: svc.externalId },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    return logs.map((l) => ({
      id: l.id,
      method: l.method,
      path: l.path,
      status: l.status,
      durationMs: l.durationMs,
      requestBody: l.requestBody,
      responseBody: l.responseBody,
      error: l.error,
      createdAt: l.createdAt.toISOString(),
    }));
  }

  // ===========================================================================
  // Poller entrypoint
  // ===========================================================================
  async advance(service: UfinetService): Promise<void> {
    // Propaga tenant+externalId pro cliente HTTP persistir o trace de cada
    // request/response deste serviço (evidência pra chamados com a Ufinet).
    return ufinetTrace.run(
      { tenantId: service.tenantId, externalId: service.externalId },
      () => this.advanceInner(service),
    );
  }

  private async advanceInner(service: UfinetService): Promise<void> {
    const olt = await this.prisma.olt.findUnique({ where: { id: service.oltId } });
    if (!olt) return this.fail(service, 'OLT não encontrada');

    let conn: UfinetConnection;
    try {
      conn = this.resolveConnection(olt);
    } catch (err) {
      return this.fail(service, `config inválida: ${msg(err)}`);
    }

    try {
      switch (service.lifecycle) {
        case 'PENDING_PROVIDE':
          await this.provideSend(service, conn);
          break;
        case 'PROVIDING':
          await this.providePoll(service, conn);
          break;
        case 'CONFIRMING_ONT':
          await this.confirmOnt(service, conn);
          break;
        case 'CONFIRMING_SERVICE':
          await this.confirmService(service, conn);
          break;
        case 'SUSPENDING':
          await this.orderStep(service, conn, 'SUSPEND');
          break;
        case 'REACTIVATING':
          await this.orderStep(service, conn, 'REACTIVATE');
          break;
        case 'SWAPPING_ONT':
          await this.swapStep(service, conn);
          break;
        case 'CEASING':
          await this.orderStep(service, conn, 'CEASE');
          break;
        case 'CANCELLING':
          await this.cancelStep(service, conn);
          break;
        default:
          return; // estado de repouso
      }
      // Passo concluiu sem throw → a Ufinet respondeu (está no ar).
      this.health.recordSuccess();
    } catch (err) {
      // 426 "Tareas pendientes / Aprovisionamiento en proceso": a Ufinet ainda
      // executa trabalho de campo/infra. É ESPERA, não erro — re-tenta calmo,
      // sem marcar erro nem contar pro limite de FAILED.
      if (this.isProvisioningPending(err)) {
        this.health.recordSuccess(); // 426 = Ufinet respondeu, está no ar
        const now = Date.now();
        const pendingSince = service.pendingSince ?? new Date(now);
        const waitedMs = now - pendingSince.getTime();
        // Teto: se a Ufinet não concluir em 1h, desiste (FAILED) em vez de
        // repollar pra sempre — ex.: serialNumber errado ou ONT/OLT inexistente.
        if (waitedMs >= PENDING_MAX_MS) {
          return this.fail(
            service,
            `Ufinet não concluiu o aprovisionamento em ${Math.round(PENDING_MAX_MS / 60_000)}min ` +
              `(426 "tareas pendientes" persistente). Revise o serialNumber e o Res Pon Access e reprocesse.`,
          );
        }
        this.logger.log(
          `[ufinet] ${service.externalId} aguardando Ufinet concluir aprovisionamento ` +
            `(tareas pendientes, ${Math.round(waitedMs / 60_000)}min) — re-tenta em ${PENDING_RETRY_MS / 1000}s`,
        );
        await this.save(service.id, {
          ufinetState: 'aprovisionando',
          error: null,
          pendingSince,
          nextAttemptAt: new Date(now + PENDING_RETRY_MS),
          ...(err instanceof UfinetApiError ? { lastResponse: toJson(err.body) } : {}),
        });
        return;
      }

      // Erro de INFRA (transporte/5xx/429).
      if (isUfinetUnavailable(err)) {
        this.health.recordInfraFailure(service.externalId, msg(err));
        // Ufinet GERAL fora (≥2 serviços falhando): NÃO conta pro FAILED, NÃO
        // mexe no lifecycle. Só backoff — retoma sozinho quando voltar.
        if (this.health.isDegraded()) {
          this.logger.warn(
            `[ufinet] ${service.externalId} Ufinet indisponível (${msg(err)}) — ` +
              'aguardando recuperar (não conta pro FAILED)',
          );
          await this.save(service.id, {
            ufinetState: 'ufinet-indisponivel',
            error: `Ufinet indisponível — retoma sozinho ao recuperar: ${msg(err)}`.slice(0, 2000),
            nextAttemptAt: new Date(Date.now() + INFRA_RETRY_MS),
            ...(err instanceof UfinetApiError ? { lastResponse: toJson(err.body) } : {}),
          });
          return;
        }
        // Ufinet NO AR, mas ESTE pedido dá 5xx/timeout persistente (ex.: ZUX-28
        // com 500 "Error no controlado" numa ordem travada) → é problema dele.
        // Conta pro FAILED com teto curto pra parar de martelar e surgir pro
        // operador (em vez de loop infinito).
        const infraAttempts = service.attempts + 1;
        const fatal = infraAttempts >= INFRA_FAIL_LIMIT;
        this.logger.warn(
          `[ufinet] ${service.externalId} erro persistente (${msg(err)}) com Ufinet no ar ` +
            `(${infraAttempts}/${INFRA_FAIL_LIMIT})`,
        );
        await this.save(service.id, {
          attempts: infraAttempts,
          error: fatal
            ? `Ufinet retorna erro persistente nesta operação (${msg(err)}). ` +
              'Provável ordem travada do lado deles — tratar manualmente (chamado Ufinet) e reprocessar.'
            : msg(err).slice(0, 2000),
          ...(fatal
            ? { lifecycle: 'FAILED' as const }
            : { nextAttemptAt: new Date(Date.now() + INFRA_RETRY_MS) }),
          ...(err instanceof UfinetApiError ? { lastResponse: toJson(err.body) } : {}),
        });
        return;
      }

      // Erro de NEGÓCIO (4xx): a Ufinet respondeu. Backoff + FAILED no limite.
      this.health.recordSuccess();
      const attempts = service.attempts + 1;
      const fatal = attempts >= MAX_ATTEMPTS;
      this.logger.warn(`[ufinet] ${service.id} ${service.lifecycle} erro: ${msg(err)}`);
      await this.save(service.id, {
        attempts,
        error: msg(err).slice(0, 2000),
        ...(fatal ? { lifecycle: 'FAILED' as const } : { nextAttemptAt: this.backoff(attempts) }),
        ...(err instanceof UfinetApiError ? { lastResponse: toJson(err.body) } : {}),
      });
    }
  }

  // ===========================================================================
  // Passos do ciclo de vida
  // ===========================================================================
  // ALTA — envia
  private async provideSend(svc: UfinetService, conn: UfinetConnection): Promise<void> {
    if (svc.currentOrderId) return this.providePoll(svc, conn); // já enviado

    const contract = await this.prisma.contract.findUnique({
      where: { id: svc.contractId },
      include: { customer: { select: { displayName: true, primaryPhone: true } } },
    });
    if (!contract) return this.fail(svc, 'contrato não encontrado');

    const payload = this.buildProvidePayload(svc, conn, contract);
    const resp = await this.client.createOrder(conn, payload);
    const orderId = extractOrderId(resp);
    if (!orderId) return this.fail(svc, `alta sem orderId: ${JSON.stringify(resp).slice(0, 500)}`);

    await this.save(svc.id, {
      lifecycle: 'PROVIDING',
      serviceOrderId: orderId,
      currentOrderId: orderId,
      ufinetState: normalizeUfinetState(extractOrder(resp)?.state),
      ufinetContractId: extractOrder(resp)?.idContrato ?? svc.ufinetContractId,
      lastResponse: toJson(resp),
      attempts: 0,
      nextAttemptAt: new Date(Date.now() + SEND_RETRY_MS),
      error: null,
    });
  }

  // ALTA — poll até reservar a porta (4 sub-serviços aparecem no inventário)
  private async providePoll(svc: UfinetService, conn: UfinetConnection): Promise<void> {
    const order = await this.client.getOrder(conn, svc.currentOrderId!);
    const state = normalizeUfinetState(order.state);
    if (state === UFINET_STATE.FAILED) {
      return this.fail(svc, this.errText(order) ?? 'alta falhou (state=Failed)');
    }
    // O bundle (Datos/Fiber/HSD/Res Pon Access) só aparece no inventário quando
    // a Ufinet COMEÇA a aprovisionar (state=inprogress). Enquanto 'initial', NÃO
    // varremos o ServiceInventory inteiro — a Ufinet não filtra por externalId,
    // então cada varredura baixa o inventário do operador todo (caríssimo em
    // escala). Só a consulta barata da ordem (getOrder) roda no 'initial'.
    if (state === UFINET_STATE.INITIAL) {
      return this.keepPolling(svc, order);
    }
    const ids = await this.resolveBundle(conn, svc.externalId);
    if (ids) {
      // Se o técnico já mandou o SN (confirm-ONT antes de reservar), avança
      // direto pra confirmação; senão, fica RESERVED aguardando o campo.
      const next = svc.serialNumber ? 'CONFIRMING_ONT' : 'RESERVED';
      await this.save(svc.id, {
        lifecycle: next,
        parentServiceId: ids.parent,
        fiberAccessServiceId: ids.fiberAccess,
        hsdServiceId: ids.hsd,
        resPonAccessServiceId: ids.resPonAccess,
        ufinetState: state,
        waitingCode: order.waitingCode ?? null,
        currentOrderId: null,
        nextAttemptAt: next === 'CONFIRMING_ONT' ? new Date() : null,
        attempts: 0,
      });
      this.logger.log(
        `[ufinet] ${svc.externalId} porta reservada → ${next}` +
          (next === 'CONFIRMING_ONT' ? ' (SN já recebido)' : ' (aguarda ONT)'),
      );
      return;
    }
    return this.keepPolling(svc, order);
  }

  // CONFIRMAR ONT — PATCH Res Pon Access (SN) + sync; poll até HSD/Access ativos
  private async confirmOnt(svc: UfinetService, conn: UfinetConnection): Promise<void> {
    if (!svc.resPonAccessServiceId || !svc.parentServiceId) {
      return this.fail(svc, 'confirmar ONT sem ids de sub-serviço (alta incompleta)');
    }
    if (!svc.serialNumber) return this.fail(svc, 'confirmar ONT sem serialNumber');

    if (!svc.currentOrderId) {
      // Paso 1: confirmar ONT no Res Pon Access
      await this.client.patchService(conn, svc.resPonAccessServiceId, {
        operator: conn.operator,
        region: conn.region,
        state: 'completed',
        serviceCharacteristic: [{ name: 'SerialNumber', value: svc.serialNumber }],
      });
      // Paso 2: sincronizar serviço (Datos)
      await this.client.patchService(conn, svc.parentServiceId, {
        Region: conn.region,
        Operator: conn.operator,
        serviceCharacteristic: [],
      });
      await this.save(svc.id, {
        currentOrderId: svc.parentServiceId, // marcador "enviado" + alvo do poll
        nextAttemptAt: new Date(Date.now() + SEND_RETRY_MS),
      });
      return;
    }

    // Poll: HSD e Res Pon Access devem ficar Active. Lê por id (barato) usando
    // os ids já salvos na reserva — evita varrer o inventário inteiro do operador
    // (a Ufinet não filtra a lista por externalId).
    let hsd: string;
    let access: string;
    if (svc.hsdServiceId && svc.resPonAccessServiceId) {
      const [h, a] = await Promise.all([
        this.client.getService(conn, svc.hsdServiceId),
        this.client.getService(conn, svc.resPonAccessServiceId),
      ]);
      hsd = normalizeUfinetState(h?.state);
      access = normalizeUfinetState(a?.state);
    } else {
      const bundle = await this.fetchBundleServices(conn, svc.externalId);
      hsd = normalizeUfinetState(bundle.get(UFINET_SPEC.HSD)?.state);
      access = normalizeUfinetState(bundle.get(UFINET_SPEC.RES_PON_ACCESS)?.state);
    }
    if (hsd === 'active' && access === 'active') {
      await this.save(svc.id, {
        lifecycle: 'CONFIRMING_SERVICE',
        currentOrderId: null,
        nextAttemptAt: new Date(),
        attempts: 0,
        error: null,
      });
      this.logger.log(`[ufinet] ${svc.externalId} ONT confirmada (HSD+Access Active)`);
      return;
    }
    return this.keepPolling(svc, null);
  }

  // CONFIRMAÇÃO FINAL — lê CTO_PORT, PATCH order com CTO_PORT+LABEL_DROP, poll
  private async confirmService(svc: UfinetService, conn: UfinetConnection): Promise<void> {
    if (!svc.serviceOrderId) return this.fail(svc, 'confirmação sem serviceOrderId');

    if (!svc.currentOrderId) {
      // Prioridade do CTO_PORT: caixa já resolvida na confirmação da ONT
      // (técnico/legado) → porta FiberMap vinculada ao contrato (nome do
      // elemento CTO = código completo da caixa) → inventário da Ufinet.
      let ctoPort = svc.ctoPort;
      if (!ctoPort) {
        const ref = await this.fibermapSubscriber.getContractPortRef(
          svc.tenantId,
          svc.contractId,
        );
        ctoPort = ref?.elementName ?? null;
      }
      ctoPort ??= await this.readCtoPort(conn, svc.externalId, svc.parentServiceId);
      if (!ctoPort) return this.keepPolling(svc, null, 'CTO_PORT ainda indisponível');
      await this.client.patchOrder(conn, svc.serviceOrderId, {
        region: conn.region,
        operator: conn.operator,
        state: 'completed',
        serviceOrderItem: [
          {
            service: {
              serviceCharacteristic: [
                { name: 'CTO_PORT', value: ctoPort },
                { name: 'LABEL_DROP', value: svc.labelDrop },
              ],
            },
          },
        ],
      });
      await this.save(svc.id, {
        ctoPort,
        currentOrderId: svc.serviceOrderId,
        nextAttemptAt: new Date(Date.now() + SEND_RETRY_MS),
      });
      return;
    }

    const order = await this.client.getOrder(conn, svc.serviceOrderId);
    const state = normalizeUfinetState(order.state);
    if (state === UFINET_STATE.FAILED) {
      return this.fail(svc, this.errText(order) ?? 'confirmação falhou');
    }
    if (state === UFINET_STATE.COMPLETED) {
      await this.save(svc.id, {
        lifecycle: 'ACTIVE',
        currentOrderId: null,
        nextAttemptAt: null,
        attempts: 0,
        error: null,
        ufinetState: state,
      });
      await this.audit.log({
        tenantId: svc.tenantId,
        actor: 'system',
        action: 'ufinet.service.active',
        resource: 'ufinet_services',
        resourceId: svc.id,
        metadata: { externalId: svc.externalId, ctoPort: svc.ctoPort },
      });
      this.logger.log(`[ufinet] ${svc.externalId} ATIVO`);
      return;
    }
    return this.keepPolling(svc, order);
  }

  // SUSPEND / REACTIVATE / CEASE — criam ordem e fazem poll
  private async orderStep(
    svc: UfinetService,
    conn: UfinetConnection,
    kind: 'SUSPEND' | 'REACTIVATE' | 'CEASE',
  ): Promise<void> {
    if (!svc.currentOrderId) {
      const payload =
        kind === 'CEASE'
          ? this.buildCeasePayload(svc, conn)
          : this.buildSuspendReactivatePayload(svc, conn, kind);
      const resp = await this.client.createOrder(conn, payload);
      const orderId = extractOrderId(resp);
      if (!orderId) return this.fail(svc, `${kind} sem orderId`);
      await this.save(svc.id, {
        currentOrderId: orderId,
        lastResponse: toJson(resp),
        nextAttemptAt: new Date(Date.now() + SEND_RETRY_MS),
      });
      return;
    }
    const order = await this.client.getOrder(conn, svc.currentOrderId);
    const state = normalizeUfinetState(order.state);
    if (state === UFINET_STATE.FAILED) return this.fail(svc, this.errText(order) ?? `${kind} falhou`);
    if (state === UFINET_STATE.COMPLETED) {
      const next = kind === 'SUSPEND' ? 'SUSPENDED' : kind === 'REACTIVATE' ? 'ACTIVE' : 'CEASED';
      await this.save(svc.id, {
        lifecycle: next,
        currentOrderId: null,
        nextAttemptAt: null,
        attempts: 0,
        error: null,
        ufinetState: state,
      });
      this.logger.log(`[ufinet] ${svc.externalId} ${kind} ok → ${next}`);
      return;
    }
    return this.keepPolling(svc, order);
  }

  // CAMBIO DE ONT — POST CHANGE_RESOURCE (Action MODIFY + SERIAL_NUMBER novo) + poll
  private async swapStep(svc: UfinetService, conn: UfinetConnection): Promise<void> {
    if (!svc.currentOrderId) {
      const resp = await this.client.createOrder(conn, this.buildSwapPayload(svc, conn));
      const orderId = extractOrderId(resp);
      if (!orderId) return this.fail(svc, 'swap ONT sem orderId');
      await this.save(svc.id, {
        currentOrderId: orderId,
        lastResponse: toJson(resp),
        nextAttemptAt: new Date(Date.now() + SEND_RETRY_MS),
      });
      return;
    }
    const order = await this.client.getOrder(conn, svc.currentOrderId);
    const state = normalizeUfinetState(order.state);
    if (state === UFINET_STATE.FAILED)
      return this.fail(svc, this.errText(order) ?? 'swap ONT falhou');
    if (state === UFINET_STATE.COMPLETED) {
      await this.save(svc.id, {
        lifecycle: 'ACTIVE',
        currentOrderId: null,
        nextAttemptAt: null,
        attempts: 0,
        error: null,
        ufinetState: state,
      });
      this.logger.log(
        `[ufinet] ${svc.externalId} troca de ONT ok → ACTIVE (SN ${svc.serialNumber})`,
      );
      return;
    }
    return this.keepPolling(svc, order);
  }

  // CANCEL — POST CancelServiceOrder (imediato; sem poll dedicado na Fase 1)
  private async cancelStep(svc: UfinetService, conn: UfinetConnection): Promise<void> {
    if (!svc.serviceOrderId) return this.fail(svc, 'cancelar sem serviceOrderId');
    const resp = await this.client.cancelOrder(conn, {
      Region: conn.region,
      Operator: conn.operator,
      cancellationReason: 'Customer cancellation',
      description: 'Cancelación de servicios',
      serviceOrder: { id: Number(svc.serviceOrderId) },
    });
    await this.save(svc.id, {
      lifecycle: 'CANCELLED',
      currentOrderId: null,
      nextAttemptAt: null,
      error: null,
      lastResponse: toJson(resp),
    });
    this.logger.log(`[ufinet] ${svc.externalId} CANCELADO`);
  }

  // ===========================================================================
  // Payload builders
  // ===========================================================================
  private buildProvidePayload(
    svc: UfinetService,
    conn: UfinetConnection,
    contract: { latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null; customer: { displayName: string; primaryPhone: string | null } },
  ): Record<string, unknown> {
    const now = new Date().toISOString();
    const minimal = conn.minimalProvidePayload;

    // Endereço: polygonAlias é necessário pra Ufinet localizar a porta (mantido
    // sempre). geometry (lat/long) = PII → omitida no modo enxuto.
    const address: Record<string, unknown> = {
      country: conn.country,
      city: conn.city ?? undefined,
    };
    if (!minimal && contract.latitude != null && contract.longitude != null) {
      address.geometry = {
        latitude: String(contract.latitude),
        longitude: String(contract.longitude),
      };
    }
    if (conn.polygonAlias) address.polygonAlias = conn.polygonAlias;

    // Características: NMS + BANDWIDTH_PROFILE sempre. CONTACT_NAME/PHONE = PII →
    // omitidos no modo enxuto (operação que não quer compartilhar dados do cliente).
    const serviceCharacteristic: Array<Record<string, unknown>> = [];
    if (!minimal) {
      serviceCharacteristic.push(
        { id: '110', name: 'CONTACT_NAME', description: 'Nombre contacto', valueType: 'string', value: contract.customer.displayName },
        { id: '111', name: 'CONTACT_PHONE', description: 'Teléfono de contacto', valueType: 'string', value: contract.customer.primaryPhone ?? '0000000000' },
      );
    }
    serviceCharacteristic.push(
      { id: conn.nmsId, name: 'NMS', description: 'NMS', valueType: 'string', value: conn.nms },
      { id: conn.bandwidthProfileId, name: 'BANDWIDTH_PROFILE', description: 'Perfil de ancho de banda', valueType: 'string', value: conn.bandwidthProfile },
    );

    return {
      orderDate: now,
      username: conn.userName,
      serviceOrderType: 'provide',
      requestedStartDate: now,
      operator: conn.operator,
      region: conn.region,
      externalId: svc.externalId,
      description: 'SOLICITUD DE ALTA DE SERVICIO',
      contractId: conn.contractId,
      serviceOrderItem: [
        {
          action: 'ADD',
          service: {
            serviceType: 'CFS',
            serviceName: 'Conectividad',
            externalServiceId: svc.externalId,
            serviceSpecification: { id: 'Datos', version: '1.0' },
            serviceCharacteristic,
            place: [{ address }],
          },
        },
      ],
    };
  }

  private buildCeasePayload(svc: UfinetService, conn: UfinetConnection): Record<string, unknown> {
    return {
      region: conn.region,
      operator: conn.operator,
      serviceOrderType: 'cease',
      description: 'BAJA DE SERVICIO',
      externalId: svc.externalId,
      RequestedStartDate: new Date().toISOString(),
      Priority: '1',
      contractId: conn.contractId,
      relatedParty: [{ name: conn.userName, role: 'requester' }],
      serviceOrderItem: [{ action: 'delete', service: { externalServiceId: svc.externalId } }],
    };
  }

  private buildSuspendReactivatePayload(
    svc: UfinetService,
    conn: UfinetConnection,
    kind: 'SUSPEND' | 'REACTIVATE',
  ): Record<string, unknown> {
    return {
      Region: conn.region,
      Operator: conn.operator,
      ServiceOrderType: kind === 'SUSPEND' ? 'SUSPEND_SERVICE' : 'REACTIVATE_SERVICE',
      Description: kind === 'SUSPEND' ? 'SUSPENCION DE SERVICIO' : 'REACTIVACION DE SERVICIO',
      ExternalId: svc.externalId,
      RequestedStartDate: new Date().toISOString(),
      Priority: '1',
      RelatedParty: [{ name: conn.userName, role: 'requester' }],
      ServiceOrderItem: [
        {
          Action: 'MODIFY',
          Service: {
            ExternalServiceId: svc.parentServiceId ?? svc.externalId,
            ServiceType: 'CFS',
            serviceCharacteristic: [],
            ServiceSpecification: { id: 'RES_PON_ACCESS', version: '1.0' },
          },
        },
      ],
    };
  }

  /** Payload do "Cambio de ONT" (CHANGE_RESOURCE) — SN novo em svc.serialNumber. */
  private buildSwapPayload(
    svc: UfinetService,
    conn: UfinetConnection,
  ): Record<string, unknown> {
    return {
      Region: conn.region,
      Operator: conn.operator,
      ServiceOrderType: 'CHANGE_RESOURCE',
      Description: 'CAMBIO DE ONT',
      ExternalId: svc.externalId,
      RequestedStartDate: new Date().toISOString(),
      Priority: '1',
      RelatedParty: [{ name: conn.userName, role: 'requester' }],
      ServiceOrderItem: [
        {
          Action: 'MODIFY',
          Service: {
            ExternalServiceId: svc.parentServiceId ?? svc.externalId,
            ServiceType: 'CFS',
            serviceCharacteristic: [
              { name: 'SERIAL_NUMBER', value: svc.serialNumber ?? '', valueType: 'string' },
            ],
            ServiceSpecification: { id: 'RES_PON_ACCESS', version: '1.0' },
          },
        },
      ],
    };
  }

  // ===========================================================================
  // Helpers de inventário
  // ===========================================================================
  /** Mapa spec.id → serviço, dos sub-serviços do bundle de um externalId. */
  private async fetchBundleServices(
    conn: UfinetConnection,
    externalId: string,
  ): Promise<Map<string, UfinetInventoryService>> {
    // Filtra no SERVIDOR quando a OLT tem inventoryFilterParam configurado —
    // a Ufinet devolve só este bundle (essencial em escala). Senão, baixa tudo.
    const all = await this.client.listServices(conn, externalId);
    const map = new Map<string, UfinetInventoryService>();
    for (const s of all) {
      // Rede de segurança: mesmo com filtro no servidor, confirma o externalId
      // (caso a Ufinet ignore o param e devolva o inventário inteiro).
      if (s.externalServiceId !== externalId) continue;
      const spec = s.serviceSpecification?.id;
      if (spec) map.set(String(spec), s);
    }
    return map;
  }

  /** Resolve os 4 ids do bundle; null se ainda não apareceu no inventário. */
  private async resolveBundle(
    conn: UfinetConnection,
    externalId: string,
  ): Promise<{ parent: string; fiberAccess: string; hsd: string; resPonAccess: string } | null> {
    const map = await this.fetchBundleServices(conn, externalId);
    const datos = map.get(UFINET_SPEC.DATOS);
    const fiber = map.get(UFINET_SPEC.FIBER_ACCESS);
    const hsd = map.get(UFINET_SPEC.HSD);
    const access = map.get(UFINET_SPEC.RES_PON_ACCESS);
    if (!datos?.id || !fiber?.id || !hsd?.id || !access?.id) return null;
    return {
      parent: String(datos.id),
      fiberAccess: String(fiber.id),
      hsd: String(hsd.id),
      resPonAccess: String(access.id),
    };
  }

  /** Procura o CTO_PORT nas characteristics dos sub-serviços do bundle. */
  private async readCtoPort(
    conn: UfinetConnection,
    externalId: string,
    parentServiceId?: string | null,
  ): Promise<string | null> {
    // Pós-reserva: o CTO_PORT vive no Datos (serviço pai) — lê por id (barato).
    if (parentServiceId) {
      try {
        const datos = await this.client.getService(conn, parentServiceId);
        const ch = datos.serviceCharacteristic?.find((c) => c.name?.toUpperCase() === 'CTO_PORT');
        if (ch?.value) return ch.value;
      } catch {
        /* cai pro fallback (varredura) */
      }
    }
    // Fallback (ex.: adoção, sem ids salvos): varre o inventário.
    const map = await this.fetchBundleServices(conn, externalId);
    for (const s of map.values()) {
      const ch = s.serviceCharacteristic?.find((c) => c.name?.toUpperCase() === 'CTO_PORT');
      if (ch?.value) return ch.value;
    }
    return null;
  }

  // ===========================================================================
  // Persistência / transições
  // ===========================================================================
  private async getByContract(tenantId: string, contractId: string): Promise<UfinetService> {
    const svc = await this.prisma.ufinetService.findUnique({ where: { contractId } });
    if (!svc || svc.tenantId !== tenantId) {
      throw new Error('Serviço Ufinet não encontrado para o contrato');
    }
    return svc;
  }

  private resetStep(): Prisma.UfinetServiceUpdateInput {
    return { currentOrderId: null, error: null, attempts: 0, nextAttemptAt: new Date() };
  }

  private async transition(
    svc: UfinetService,
    lifecycle: UfinetService['lifecycle'],
    extra: Prisma.UfinetServiceUpdateInput,
    actorUserId: string | null | undefined,
    action: string,
  ): Promise<UfinetService> {
    const updated = await this.prisma.ufinetService.update({
      where: { id: svc.id },
      data: { lifecycle, ...extra },
    });
    await this.audit.log({
      tenantId: svc.tenantId,
      userId: actorUserId ?? null,
      actor: actorUserId ? undefined : 'system',
      action,
      resource: 'ufinet_services',
      resourceId: svc.id,
      beforeState: { lifecycle: svc.lifecycle },
      afterState: { lifecycle },
    });
    return updated;
  }

  private save(id: string, data: Prisma.UfinetServiceUpdateInput): Promise<UfinetService> {
    // Reset implícito da âncora de pending: só o branch "aprovisionando" passa
    // `pendingSince`; qualquer avanço/poll/erro normal quebra o streak e zera.
    const patch = 'pendingSince' in data ? data : { ...data, pendingSince: null };
    return this.prisma.ufinetService.update({ where: { id }, data: patch });
  }

  private async fail(svc: UfinetService, error: string): Promise<void> {
    this.logger.error(`[ufinet] ${svc.externalId} FAILED: ${error}`);
    await this.save(svc.id, { lifecycle: 'FAILED', error: error.slice(0, 2000), nextAttemptAt: null });
    await this.audit.log({
      tenantId: svc.tenantId,
      actor: 'system',
      action: 'ufinet.service.failed',
      resource: 'ufinet_services',
      resourceId: svc.id,
      level: 'WARNING',
      metadata: { externalId: svc.externalId, error: error.slice(0, 500) },
    });
  }

  /** Mantém em poll: backoff crescente; FAILED no limite de tentativas. */
  private async keepPolling(svc: UfinetService, order: UfinetOrderResponse | null, note?: string): Promise<void> {
    const attempts = svc.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      return this.fail(svc, note ?? `excedeu ${MAX_ATTEMPTS} tentativas de poll`);
    }
    await this.save(svc.id, {
      attempts,
      nextAttemptAt: this.backoff(attempts),
      ufinetState: order ? normalizeUfinetState(order.state) : svc.ufinetState,
      waitingCode: order?.waitingCode ?? svc.waitingCode,
    });
  }

  private backoff(attempts: number): Date {
    const ms = Math.min(POLL_MIN_MS * Math.max(1, attempts), POLL_MAX_MS);
    return new Date(Date.now() + ms);
  }

  /** 426 / "tareas pendientes" / "en proceso" = aprovisionamento ainda rodando. */
  private isProvisioningPending(err: unknown): boolean {
    if (!(err instanceof UfinetApiError)) return false;
    if (err.status === 426) return true;
    const body = err.body as { reason?: string; message?: string } | null;
    const txt = `${body?.reason ?? ''} ${body?.message ?? ''}`.toLowerCase();
    return /pendiente|en proceso|in process|provisioning/.test(txt);
  }

  private errText(order: UfinetOrderResponse): string | null {
    if (!order.errorMessages?.length) return null;
    return order.errorMessages.map((e) => e.reason ?? e.message ?? e.code).filter(Boolean).join(' | ').slice(0, 2000);
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Próxima marquilla de reativação: `{baseCode}-R{n}`. A Ufinet consome o
 * externalId após baja/cancelación, então cada re-alta precisa de um NOVO.
 * baseCode = Contract.code (ex.: "ZUX-234"). 1ª reativação → "ZUX-234-R2";
 * se o externalId atual já é "...-R3", a próxima é "...-R4".
 *
 * ⚠️ Formato "-R{n}" ainda NÃO validado contra a Ufinet real — validar no box
 * que eles aceitam esse externalId/marquilla (senão trocar pra sequencial novo).
 */
function nextReactivationExternalId(currentExternalId: string, baseCode: string): string {
  const m = /-R(\d+)$/i.exec(currentExternalId);
  const n = m ? Number(m[1]) + 1 : 2;
  return `${baseCode}-R${n}`;
}


/** Extrai serviceCharacteristic do 1º item de uma ordem (ex.: níveis STATUS_ONT). */
function extractOrderCharacteristics(
  order: UfinetOrderResponse,
): Array<{ name: string; value: string }> {
  const chars = order.serviceOrderItem?.[0]?.service?.serviceCharacteristic ?? [];
  return chars
    .filter((c) => c?.name != null)
    .map((c) => ({ name: String(c.name), value: c.value != null ? String(c.value) : '' }));
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? null) as Prisma.InputJsonValue;
}
