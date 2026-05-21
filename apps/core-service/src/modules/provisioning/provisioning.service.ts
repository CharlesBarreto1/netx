/**
 * ProvisioningService — orquestra o fluxo de ativação ZTP em campo.
 *
 * Endpoint principal: POST /v1/provisioning/install/:contractId
 *   1. Valida que contrato existe + está PENDING_INSTALL (ou ACTIVE pra
 *      re-provisionar troca de ONT)
 *   2. Valida OLT existe + active
 *   3. Resolve driver (OltDriverFactory) baseado em vendor/providerMode
 *   4. Decrypta credenciais → monta ConnectionContext
 *   5. Chama driver.authorizeOnt() → cria/atualiza Ont row
 *   6. Atualiza Contract: status=ACTIVE, salva ssid + wifiPasswordEnc, MAC, etc.
 *   7. Enfileira Tr069Task SET_PARAMS (Wi-Fi) — Fase 3 ACS aplica
 *   8. Enfileira radius_event AUTHORIZE via RadiusSyncService
 *   9. Persiste ProvisioningEvent pra auditoria de cada passo
 *  10. Retorna timeline pro front mostrar progresso
 *
 * Tudo em transação Prisma? **Não** — chamadas de driver são externas e podem
 * levar segundos. Estratégia:
 *   - Cria Ont em PENDING_AUTH ANTES de chamar driver (idempotência: re-run
 *     vê Ont existente)
 *   - Chama driver (fora da TX)
 *   - Em sucesso: TX atômica que atualiza Ont status, Contract, enfileira
 *     radius_event + tr069_task
 *   - Em falha: marca Ont status=FAULT, lastError. Contract continua PENDING.
 *
 * Auditoria: cada chamada de driver vira um ProvisioningEvent (sucesso ou
 * falha) — rastreável em /contracts/:id timeline.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type InstallCustomerRequest,
  type InstallCustomerResponse,
  type InstallTimelineEvent,
  type ListPendingInstallsQuery,
  type Paginated,
  type PendingInstallItem,
  paginationMeta,
} from '@netx/shared';
import {
  type Contract,
  ContractStatus as PrismaContractStatus,
  type Olt,
  type Ont,
  Prisma,
  type ProvisioningEventAction,
  type ProvisioningEventStatus,
} from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { RadiusSyncService } from '../contracts/radius-sync.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

import { OltDriverFactory } from './drivers/olt-driver.factory';
import { buildConnectionContext } from './olt-context.util';
import { Tr069TasksService } from './tr069-tasks.service';

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly radius: RadiusSyncService,
    private readonly tr069: Tr069TasksService,
    private readonly drivers: OltDriverFactory,
  ) {}

  /**
   * Lista contratos aguardando provisionamento (status=PENDING_INSTALL).
   * UI: /provisioning/pending.
   */
  async listPending(
    tenantId: string,
    q: ListPendingInstallsQuery,
  ): Promise<Paginated<PendingInstallItem>> {
    const where: Prisma.ContractWhereInput = {
      tenantId,
      deletedAt: null,
      status: PrismaContractStatus.PENDING_INSTALL,
      ...(q.search && {
        OR: [
          { code: { contains: q.search, mode: 'insensitive' } },
          { installationAddress: { contains: q.search, mode: 'insensitive' } },
          {
            customer: {
              displayName: { contains: q.search, mode: 'insensitive' },
            },
          },
        ],
      }),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          customer: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: q.pageSize,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return {
      data: rows.map((c) => ({
        contractId: c.id,
        contractCode: c.code,
        customerId: c.customerId,
        customerName: c.customer.displayName,
        installationAddress: c.installationAddress,
        bandwidthMbps: c.bandwidthMbps,
        monthlyValue: c.monthlyValue.toString(),
        createdAt: c.createdAt.toISOString(),
      })),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  /**
   * Orquestrador principal. Idempotente: se já tem Ont vinculada ao contrato,
   * faz retry do passo que falhou.
   */
  async installCustomer(
    tenantId: string,
    actorUserId: string,
    contractId: string,
    input: InstallCustomerRequest,
  ): Promise<InstallCustomerResponse> {
    const timeline: InstallTimelineEvent[] = [];
    const pushEvent = (
      action: ProvisioningEventAction,
      status: ProvisioningEventStatus,
      message: string,
      durationMs: number | null = null,
      error: string | null = null,
    ): void => {
      timeline.push({
        action,
        status,
        message,
        durationMs,
        at: new Date().toISOString(),
        error,
      });
    };

    // ── 1. Carrega Contract + OLT ──────────────────────────────────────────
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId, deletedAt: null },
      include: { ont: true },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    if (
      contract.status !== PrismaContractStatus.PENDING_INSTALL &&
      contract.status !== PrismaContractStatus.ACTIVE
    ) {
      throw new BadRequestException(
        `Contrato em status ${contract.status} — só PENDING_INSTALL ou ACTIVE (re-provision) podem ser instalados`,
      );
    }

    const olt = await this.prisma.olt.findFirst({
      where: { id: input.oltId, tenantId, deletedAt: null },
    });
    if (!olt) throw new NotFoundException('OLT não encontrada');

    // ── 2. Cria ou re-aproveita Ont row em PENDING_AUTH ───────────────────
    let ont: Ont;
    if (contract.ont) {
      // Re-provisionamento: usa Ont existente, atualiza SN se mudou
      if (contract.ont.snGpon !== input.snGpon) {
        throw new ConflictException(
          `Contrato já tem ONT com SN ${contract.ont.snGpon}. Pra trocar, ` +
            'desautorize a antiga via /v1/provisioning/onts/:id antes.',
        );
      }
      ont = contract.ont;
    } else {
      // Verifica que SN não está vinculado a outro contrato na mesma OLT
      const collision = await this.prisma.ont.findFirst({
        where: { oltId: input.oltId, snGpon: input.snGpon },
      });
      if (collision) {
        throw new ConflictException(
          `SN ${input.snGpon} já vinculado a outro contrato nessa OLT`,
        );
      }
      ont = await this.prisma.ont.create({
        data: {
          tenantId,
          contractId,
          oltId: input.oltId,
          snGpon: input.snGpon,
          macAddress: input.macAddress ?? null,
          serialPhysical: input.serialPhysical ?? null,
          ponFrame: input.ponFrame ?? null,
          ponSlot: input.ponSlot ?? null,
          status: 'PENDING_AUTH',
          notes: input.notes ?? null,
        },
      });
    }

    // ── 3. Chama driver.authorizeOnt() ─────────────────────────────────────
    const driver = this.drivers.resolve(olt.vendor, olt.providerMode);
    const ctx = buildConnectionContext(olt, this.crypto);
    pushEvent('OLT_AUTHORIZE', 'PENDING', `Autorizando SN ${input.snGpon} na OLT ${olt.name}`);

    const authResult = await driver.authorizeOnt(ctx, {
      snGpon: input.snGpon,
      macAddress: input.macAddress ?? null,
      ponFrame: input.ponFrame ?? null,
      ponSlot: input.ponSlot ?? null,
      bandwidthMbps: contract.bandwidthMbps,
      vlanId: olt.serviceVlanId,
      contractRef: contract.code ?? contract.id,
    });

    await this.persistEvent({
      tenantId,
      contractId,
      ontId: ont.id,
      oltId: olt.id,
      action: 'OLT_AUTHORIZE',
      status: authResult.success ? 'SUCCESS' : 'FAILED',
      payload: authResult.success
        ? { sn: input.snGpon, result: authResult.data }
        : { sn: input.snGpon },
      error: authResult.success ? null : authResult.error,
      durationMs: authResult.durationMs,
      actorUserId,
    });

    if (!authResult.success) {
      // Marca Ont em FAULT — operador pode retry depois
      await this.prisma.ont.update({
        where: { id: ont.id },
        data: { status: 'FAULT', lastError: authResult.error },
      });
      pushEvent(
        'OLT_AUTHORIZE',
        'FAILED',
        `Falha ao autorizar: ${authResult.error}`,
        authResult.durationMs,
        authResult.error,
      );
      return {
        contractId,
        ontId: ont.id,
        status: 'FAILED',
        timeline,
      };
    }
    pushEvent(
      'OLT_AUTHORIZE',
      'SUCCESS',
      `ONT autorizada em ${authResult.data.ponFrame ?? '?'}/` +
        `${authResult.data.ponSlot ?? '?'}/${authResult.data.ponOnuIndex ?? '?'}`,
      authResult.durationMs,
    );

    // ── 4. TX atômica: atualiza Ont + Contract + radius + tr069 task ───────
    const effectiveMac = authResult.data.macAddress ?? input.macAddress ?? null;
    let updatedContract: Contract | null = null;
    try {
      updatedContract = await this.prisma.$transaction(async (tx) => {
        // 4.1 Atualiza Ont com resultado do driver
        await tx.ont.update({
          where: { id: ont.id },
          data: {
            status: 'AUTHORIZED',
            macAddress: effectiveMac,
            ponFrame: authResult.data.ponFrame,
            ponSlot: authResult.data.ponSlot,
            ponOnuIndex: authResult.data.ponOnuIndex,
            authorizedAt: new Date(),
            lastError: null,
          },
        });

        // 4.2 Atualiza Contract: status ACTIVE, salva Wi-Fi (encrypted)
        const c = await tx.contract.update({
          where: { id: contract.id },
          data: {
            status: PrismaContractStatus.ACTIVE,
            activatedAt: contract.activatedAt ?? new Date(),
            ssid: input.ssid,
            wifiPasswordEnc: this.crypto.encrypt(input.wifiPassword),
            // Se IPoE e MAC veio do driver, atualiza identificador RADIUS
            ...(contract.authMethod === 'IPOE' && effectiveMac
              ? { macAddress: effectiveMac }
              : {}),
            updatedById: actorUserId,
          },
        });

        // 4.3 Enfileira radius_event AUTHORIZE (já reativa se SUSPENDED)
        if (c.authMethod === 'IPOE' || c.authMethod === 'PPPOE') {
          const hasIdentifier =
            c.authMethod === 'IPOE'
              ? !!(c.circuitId ?? c.macAddress)
              : !!c.pppoeUsername;
          if (hasIdentifier) {
            await this.radius.enqueueSync(c, 'instalação concluída via provisioning', tx);
          } else {
            // IPoE sem MAC ainda (driver não retornou) — radius vai ser
            // sincronizado depois quando Inform/Accounting popular o MAC.
            this.logger.warn(
              `[PROV] contrato ${c.id} IPoE sem identificador — RADIUS sync ` +
                'adiado até MAC chegar via Accounting',
            );
          }
        }

        return c;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushEvent('CONTRACT_ACTIVATE', 'FAILED', 'Falha ao ativar contrato', null, message);
      throw err;
    }

    pushEvent(
      'CONTRACT_ACTIVATE',
      'SUCCESS',
      `Contrato ${updatedContract.code ?? updatedContract.id.slice(0, 8)} ativado`,
    );
    pushEvent('RADIUS_ENQUEUE', 'SUCCESS', 'RADIUS sync enfileirado (applier processa em ≤30s)');

    // ── 5. Enfileira Tr069Task SET_PARAMS (Wi-Fi) ─────────────────────────
    // Fora da TX porque a tabela tr069_tasks tem cascade no device, e device
    // upsert lê do mesmo DB. Mantemos sequencial — falha aqui não rola back
    // a ativação RADIUS (Wi-Fi é nice-to-have, técnico pode config manual).
    try {
      const { taskId } = await this.tr069.enqueueSetWifi(
        tenantId,
        ont.id,
        contractId,
        input.snGpon,
        { ssid: input.ssid, password: input.wifiPassword, bothBands: true },
      );
      await this.persistEvent({
        tenantId,
        contractId,
        ontId: ont.id,
        oltId: olt.id,
        action: 'TR069_TASK_ENQUEUE',
        status: 'SUCCESS',
        payload: { taskId, ssid: input.ssid, bands: ['2.4', '5'] },
        actorUserId,
      });
      pushEvent(
        'TR069_TASK_ENQUEUE',
        'SUCCESS',
        'Wi-Fi enfileirado pro ACS aplicar (Fase 3) — task ' + taskId.slice(0, 8),
      );
    } catch (err) {
      // TR-069 falha NÃO impede ativação — só loga
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[PROV] TR-069 enqueue falhou: ${msg}`);
      pushEvent('TR069_TASK_ENQUEUE', 'FAILED', 'Wi-Fi não enfileirado', null, msg);
    }

    // Audit log de alto nível
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'provisioning.installed',
      resource: 'contracts',
      resourceId: contractId,
      metadata: {
        ontId: ont.id,
        oltId: olt.id,
        snGpon: input.snGpon,
        bandwidthMbps: contract.bandwidthMbps,
      },
    });

    return {
      contractId,
      ontId: ont.id,
      status: 'OK',
      timeline,
      pollUrl: `/v1/provisioning/onts/${ont.id}/status`,
    };
  }

  /** Status atual da ONT (UI faz poll). */
  async getOntStatus(tenantId: string, ontId: string): Promise<Ont & { oltName: string }> {
    const ont = await this.prisma.ont.findFirst({
      where: { id: ontId, tenantId },
      include: { olt: { select: { name: true } } },
    });
    if (!ont) throw new NotFoundException('ONT não encontrada');
    return { ...ont, oltName: ont.olt.name };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async persistEvent(opts: {
    tenantId: string;
    contractId: string | null;
    ontId: string | null;
    oltId: string | null;
    action: ProvisioningEventAction;
    status: ProvisioningEventStatus;
    payload?: Prisma.JsonValue;
    error?: string | null;
    durationMs?: number;
    actorUserId?: string;
  }): Promise<void> {
    await this.prisma.provisioningEvent.create({
      data: {
        tenantId: opts.tenantId,
        contractId: opts.contractId,
        ontId: opts.ontId,
        oltId: opts.oltId,
        action: opts.action,
        status: opts.status,
        payload: (opts.payload ?? null) as Prisma.InputJsonValue,
        error: opts.error ?? null,
        durationMs: opts.durationMs ?? null,
        actorUserId: opts.actorUserId ?? null,
        actorKind: opts.actorUserId ? 'user' : 'system',
      },
    });
  }
}

/** Sanity helper pra type narrowing em Olt sem expor o tipo Prisma. */
export type OltDbRow = Olt;
