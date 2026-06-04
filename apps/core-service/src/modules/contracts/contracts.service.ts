import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractAuthMethod,
  ContractStatus as PrismaContractStatus,
  ContractSuspendReason as PrismaSuspendReason,
  InvoiceKind,
  InvoiceStatus,
  PaymentMode as PrismaPaymentMode,
  Prisma,
} from '@prisma/client';

import {
  paginationMeta,
  pppoeLoginCandidates,
  pppoeLoginWithSuffix,
  normalizeNameToken,
  type CancelContractRequest,
  type ChangeContractPlanRequest,
  type ChangePlanPreviewResponse,
  type ContractResponse,
  type ContractStatus,
  type ContractSuspendReason,
  type ContractWifiStatus,
  type CreateContractRequest,
  type ListContractsQuery,
  type Paginated,
  type PaymentMode,
  type PreviewChangePlanRequest,
  type ReactivateContractRequest,
  type SuspendContractRequest,
  type UpdateContractRequest,
  type UpdateContractWifiRequest,
  type UpdateContractWifiResponse,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { DisconnectService } from '../disconnect/disconnect.service';
import { HUAWEI_EG8145_PATHS, ssid5gFor } from '../provisioning/tr069-paths.huawei';
import { UfinetOrdersService } from '../ufinet/ufinet-orders.service';
import {
  daysBetween,
  InvoiceReference,
  nextDueDateFor,
  previousDueDateFor,
  prorate,
  resolveBlockAfterDays,
} from './billing-period.util';
import { recalcCustomerStatus } from './customer-status';
import { InvoiceGeneratorService } from './invoice-generator.service';
import { RadiusSyncService } from './radius-sync.service';

/**
 * Versão non-throwing de `radiusIdentifier()` — retorna null se identificador
 * não puder ser resolvido. Usada em `update()` para comparar old vs new sem
 * lançar quando algum lado está incompleto durante a transição.
 */
function safeRadiusIdentifier(c: {
  authMethod: ContractAuthMethod;
  pppoeUsername: string | null;
  circuitId: string | null;
  macAddress: string | null;
}): string | null {
  if (c.authMethod === ContractAuthMethod.IPOE) {
    return c.circuitId ?? c.macAddress ?? null;
  }
  return c.pppoeUsername ?? null;
}

const DEFAULT_INCLUDE = {
  customer: {
    select: { id: true, displayName: true, type: true },
  },
  plan: {
    // blockAfterDays é necessário pro effectiveBlockAfterDays na resposta
    // (fallback do override per-contrato).
    select: { id: true, name: true, blockAfterDays: true },
  },
} as const;

type ContractWithRelations = Prisma.ContractGetPayload<{ include: typeof DEFAULT_INCLUDE }>;

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoiceGen: InvoiceGeneratorService,
    private readonly radius: RadiusSyncService,
    private readonly disconnect: DisconnectService,
    private readonly crypto: CryptoService,
    private readonly ufinet: UfinetOrdersService,
  ) {}

  /** Dispara baja/cancelación Ufinet no cancelamento do contrato (best-effort). */
  private async tryUfinetTeardown(tenantId: string, contractId: string, actorUserId: string): Promise<void> {
    try {
      const svc = await this.prisma.ufinetService.findUnique({
        where: { contractId },
        select: { id: true },
      });
      if (!svc) return;
      await this.ufinet.requestTeardown(tenantId, contractId, actorUserId);
      this.logger.log(`[ufinet] teardown (baja/cancel) disparado pra contrato ${contractId}`);
    } catch (err) {
      this.logger.warn(
        `[ufinet] falha no teardown de ${contractId} — cancel mantido. ` +
          `erro: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateContractRequest,
    seqAttempt = 0,
  ): Promise<ContractResponse> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: input.customerId, tenantId, deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');

    const firstDue = input.firstDueDate ? new Date(`${input.firstDueDate}T00:00:00.000Z`) : undefined;

    const now = new Date();

    // Prefixo do tenant pro código sequencial do contrato ({prefix}-{seq}).
    // Null = derivado do slug. O `seq` é gerado dentro da TX (MAX+1).
    const tenantRow = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true, contractPrefix: true },
    });
    const prefix = (
      tenantRow?.contractPrefix?.trim() || deriveContractPrefix(tenantRow?.slug)
    ).toUpperCase();

    let created: ContractWithRelations;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // PPPoE: resolve login (derivado do nome do cliente, único no tenant)
        // + senha (default '1234'). Feito DENTRO da tx pra a checagem de
        // unicidade ver estado consistente.
        let pppoeUsername: string | null = null;
        let pppoePassword: string | null = null;
        if (input.authMethod === 'PPPOE') {
          pppoeUsername = await this.resolvePppoeUsername(
            tx,
            tenantId,
            input.pppoeUsername ?? null,
            customer.displayName,
          );
          pppoePassword = input.pppoePassword?.trim() || '1234';
        }

        // Branch por authMethod — o DTO já garante coerência via discriminated
        // union; aqui só copiamos os campos certos pro Prisma.
        const authData =
          input.authMethod === 'IPOE'
            ? {
                authMethod: 'IPOE' as const,
                pppoeUsername: null,
                pppoePassword: null,
                circuitId: input.circuitId ?? null,
                remoteId: input.remoteId ?? null,
                macAddress: input.macAddress ?? null,
                framedIpAddress: input.framedIpAddress ?? null,
                vlanId: input.vlanId ?? null,
              }
            : {
                authMethod: 'PPPOE' as const,
                pppoeUsername,
                pppoePassword,
                circuitId: null,
                remoteId: null,
                macAddress: null,
                framedIpAddress: null,
                vlanId: null,
              };

        // initialStatus: PENDING_INSTALL (fluxo ZTP padrão — técnico instala
        // em campo) ou ACTIVE (exceção — instalação já realizada). O DTO já
        // aplica default PENDING_INSTALL; o `??` aqui é só defesa.
        const initialStatus =
          (input as { initialStatus?: 'ACTIVE' | 'PENDING_INSTALL' }).initialStatus ??
          'PENDING_INSTALL';
        const isPending = initialStatus === 'PENDING_INSTALL';

        // Sequencial global por tenant (TODO contrato, Ufinet ou não):
        // MAX(seq)+1. O índice único (tenant_id, seq) protege contra corrida;
        // colisão → P2002 → retry recalculando (vide catch).
        const agg = await tx.contract.aggregate({
          where: { tenantId },
          _max: { seq: true },
        });
        const seq = (agg._max.seq ?? 0) + 1;
        const code = `${prefix}-${seq}`;

        const contract = await tx.contract.create({
          data: {
            tenantId,
            customerId: input.customerId,
            code,
            seq,
            ...authData,
            installationAddress: input.installationAddress,
            installationMapsUrl: input.installationMapsUrl ?? null,
            // Plano: referência. Valores (monthlyValue/bandwidth/upload) já
            // vêm preenchidos pelo front a partir do plano — o operador pode
            // ter ajustado o monthlyValue (desconto/acréscimo).
            planId: input.planId ?? null,
            monthlyValue: new Prisma.Decimal(input.monthlyValue),
            bandwidthMbps: input.bandwidthMbps,
            uploadMbps: input.uploadMbps ?? null,
            dueDay: input.dueDay,
            // Cobrança. POSTPAID = default. PREPAID inverte o fluxo de fatura.
            paymentMode: input.paymentMode as PrismaPaymentMode,
            // Override de dias até bloqueio (null = usa plan.blockAfterDays).
            blockAfterDays: input.blockAfterDays ?? null,
            // Geolocalização (módulo Mapeamento).
            latitude: input.latitude ?? null,
            longitude: input.longitude ?? null,
            status: isPending
              ? PrismaContractStatus.PENDING_INSTALL
              : PrismaContractStatus.ACTIVE,
            // activatedAt só preenche quando contrato realmente vai ACTIVE.
            // Em PENDING_INSTALL o ProvisioningService.installCustomer popula
            // depois.
            activatedAt: isPending ? null : now,
            notes: input.notes ?? null,
            createdById: actorUserId,
            updatedById: actorUserId,
          },
          include: DEFAULT_INCLUDE,
        });

        if (!isPending) {
          // Fluxo clássico: gera fatura inicial + enfileira RADIUS sync.
          // generateInitialInvoice escolhe POSTPAID (pro-rata) vs PREPAID
          // (cheia vencendo hoje) com base em contract.paymentMode.
          await this.invoiceGen.generateInitialInvoice(tx, contract, {
            firstDueDate: firstDue,
            activatedAt: now,
          });
          await this.radius.enqueueSync(contract, 'contrato criado', tx);
        }
        // Auto-status do customer baseado em todos os contratos dele.
        await recalcCustomerStatus(tx, tenantId, input.customerId);
        // Em PENDING_INSTALL pulamos AMBOS:
        //   - Invoice: cliente não paga pelo serviço que ainda não tem.
        //     Quando técnico ativar via /provisioning/install, status vira
        //     ACTIVE e o cron diário gera próxima fatura no dueDay.
        //     TODO: se quiser cobrar instalação adiantada, gerar one-time
        //     charge separada (não invoice mensal).
        //   - RADIUS: identificador pode ainda não existir (IPoE sem MAC).
        //     installCustomer enfileira AUTHORIZE quando técnico fechar.
        return contract;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // O alvo do unique varia: pppoe_username, circuit_id, mac_address ou
        // seq/code (sequencial do contrato).
        const target = (err.meta?.target as string[] | string | undefined) ?? '';
        const targetStr = Array.isArray(target) ? target.join(',') : String(target);
        // Colisão do sequencial por corrida (criação simultânea) → recalcula
        // MAX(seq)+1 e re-tenta (até 5x).
        if ((targetStr.includes('seq') || targetStr.includes('code')) && seqAttempt < 5) {
          return this.create(tenantId, actorUserId, input, seqAttempt + 1);
        }
        let field = 'identificador';
        if (targetStr.includes('pppoe')) field = 'PPPoE username';
        else if (targetStr.includes('circuit')) field = 'circuit-id';
        else if (targetStr.includes('mac')) field = 'MAC address';
        else if (targetStr.includes('seq') || targetStr.includes('code')) field = 'código do contrato';
        throw new ConflictException(`${field} já em uso neste tenant`);
      }
      throw err;
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.created',
      resource: 'contracts',
      resourceId: created.id,
      afterState: {
        authMethod: created.authMethod,
        // Identificador efetivo no RADIUS — útil pro audit trail tanto em
        // PPPoE quanto em IPoE (circuit-id ou MAC).
        radiusIdentifier:
          created.authMethod === 'IPOE'
            ? created.circuitId ?? created.macAddress
            : created.pppoeUsername,
        monthlyValue: created.monthlyValue.toString(),
        dueDay: created.dueDay,
        bandwidthMbps: created.bandwidthMbps,
      },
    });

    // Rede neutra Ufinet (PY): a ALTA (reserva de porta) NÃO é mais disparada
    // na criação. Ela sai na INSTALAÇÃO (ProvisioningService.install), quando a
    // OLT real é conhecida — assim cliente em OLT direta nunca consome Ufinet
    // (cara) e evitamos altas indevidas. Decisão da operação 2026-05-30.
    return toContractResponse(created, { includePassword: true });
  }

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------
  async findById(tenantId: string, id: string): Promise<ContractResponse> {
    const contract = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: DEFAULT_INCLUDE,
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    return toContractResponse(contract, { includePassword: true });
  }

  async list(tenantId: string, q: ListContractsQuery): Promise<Paginated<ContractResponse>> {
    const where: Prisma.ContractWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.status && { status: q.status }),
      ...(q.pppoeUsername && { pppoeUsername: q.pppoeUsername }),
      ...(q.search && {
        OR: [
          { code: { contains: q.search, mode: 'insensitive' } },
          { pppoeUsername: { contains: q.search, mode: 'insensitive' } },
          { circuitId: { contains: q.search, mode: 'insensitive' } },
          { macAddress: { contains: q.search, mode: 'insensitive' } },
          { installationAddress: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: DEFAULT_INCLUDE,
        orderBy: { [q.sortBy]: q.sortDir },
        skip,
        take: q.pageSize,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return {
      data: rows.map((r) => toContractResponse(r, { includePassword: false })),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // UPDATE (dados comerciais; não mexe em status)
  // ---------------------------------------------------------------------------
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateContractRequest,
  ): Promise<ContractResponse> {
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');

    // Troca de plano vai por endpoint dedicado (POST /contracts/:id/change-plan)
    // pra cobrir prorate, fatura de ajuste e re-sync RADIUS. Aceitar planId
    // no PATCH genérico abriria buraco: trocar planId sem mexer em
    // monthlyValue/bandwidthMbps deixaria contrato inconsistente, e cobrar
    // delta proporcional fora desse fluxo seria invisível pro operador.
    if (input.planId !== undefined) {
      throw new BadRequestException(
        'Para trocar o plano, use POST /v1/contracts/:id/change-plan ' +
          '(garante cálculo de prorate e atualização de banda/RADIUS).',
      );
    }
    // Pré-pago muda o ciclo de fatura inteiro. Permitir trocar paymentMode
    // depois da criação exigiria reescrever prepaidUntil + cancelar/regenerar
    // faturas futuras. Decisão v1: bloqueia; operador cancela e recria.
    if (
      input.paymentMode !== undefined &&
      input.paymentMode !== (existing.paymentMode as PaymentMode)
    ) {
      throw new BadRequestException(
        'Mudar entre PREPAID/POSTPAID em contrato existente exige ' +
          'cancelar e recriar (afeta histórico de faturas e ciclo).',
      );
    }

    const data: Prisma.ContractUpdateInput = {
      updatedBy: { connect: { id: actorUserId } },
    };
    // PPPoE
    if (input.pppoeUsername !== undefined) data.pppoeUsername = input.pppoeUsername;
    if (input.pppoePassword !== undefined) data.pppoePassword = input.pppoePassword;
    // IPoE
    if (input.authMethod !== undefined) data.authMethod = input.authMethod;
    if (input.circuitId !== undefined) data.circuitId = input.circuitId ?? null;
    if (input.remoteId !== undefined) data.remoteId = input.remoteId ?? null;
    if (input.macAddress !== undefined) data.macAddress = input.macAddress ?? null;
    if (input.framedIpAddress !== undefined) data.framedIpAddress = input.framedIpAddress ?? null;
    if (input.vlanId !== undefined) data.vlanId = input.vlanId ?? null;
    // Comuns
    if (input.installationAddress !== undefined) data.installationAddress = input.installationAddress;
    if (input.installationMapsUrl !== undefined)
      data.installationMapsUrl = input.installationMapsUrl ?? null;
    if (input.monthlyValue !== undefined) data.monthlyValue = new Prisma.Decimal(input.monthlyValue);
    if (input.bandwidthMbps !== undefined) data.bandwidthMbps = input.bandwidthMbps;
    if (input.uploadMbps !== undefined) data.uploadMbps = input.uploadMbps ?? null;
    if (input.dueDay !== undefined) data.dueDay = input.dueDay;
    // Override de dias até bloqueio. `null` explícito limpa o override
    // (volta a usar plan.blockAfterDays).
    if (input.blockAfterDays !== undefined) data.blockAfterDays = input.blockAfterDays ?? null;
    // Geolocalização (módulo Mapeamento) — operador marca via LocationPicker.
    // null explícito limpa o pino do mapa.
    if (input.latitude !== undefined) data.latitude = input.latitude ?? null;
    if (input.longitude !== undefined) data.longitude = input.longitude ?? null;
    if (input.notes !== undefined) data.notes = input.notes ?? null;

    // Coerência: se trocar pra PPPOE, exige user+pass (existente ou novo).
    // Se trocar pra IPOE, exige circuit OU mac (existente ou novo).
    const targetMethod = input.authMethod ?? existing.authMethod;
    const willHaveUser =
      input.pppoeUsername ?? existing.pppoeUsername ?? null;
    const willHavePass =
      input.pppoePassword ?? existing.pppoePassword ?? null;
    const willHaveCircuit = input.circuitId ?? existing.circuitId ?? null;
    const willHaveMac = input.macAddress ?? existing.macAddress ?? null;
    if (targetMethod === 'PPPOE' && (!willHaveUser || !willHavePass)) {
      throw new BadRequestException('PPPoE exige usuário e senha.');
    }
    if (targetMethod === 'IPOE' && !willHaveCircuit && !willHaveMac) {
      throw new BadRequestException('IPoE exige circuitId ou macAddress.');
    }

    const updated = await this.prisma.contract.update({
      where: { id: existing.id },
      data,
      include: DEFAULT_INCLUDE,
    });

    // Re-sync RADIUS se QUALQUER campo de identidade mudou. Antes só checava
    // pppoeUsername — bug: trocar authMethod, circuitId, macAddress ou
    // framedIpAddress não disparava sync, e radcheck/radusergroup ficavam stale.
    // Pior: o identificador antigo continuava "autorizado" pra sempre (vazamento).
    //
    // Strategy:
    //   1. Se identificador efetivo mudou (oldId vs newId), enfileira um CANCEL
    //      pro oldId pra limpar radcheck/radreply/radusergroup do antigo.
    //   2. Sempre re-enfileira AUTHORIZE com o novo identificador pra refletir
    //      a config atualizada (Auth-Type, Cleartext-Password, Framed-IP, pool).
    const changed = (
      key: 'authMethod' | 'pppoeUsername' | 'pppoePassword' | 'circuitId' | 'macAddress' | 'framedIpAddress',
    ): boolean => {
      const inputVal = (input as Record<string, unknown>)[key];
      if (inputVal === undefined) return false;
      const existingVal = (existing as unknown as Record<string, unknown>)[key];
      // Trata null/undefined como equivalentes (Prisma null === input não setado).
      return (inputVal ?? null) !== (existingVal ?? null);
    };
    const identityChanged =
      changed('authMethod') ||
      changed('pppoeUsername') ||
      changed('pppoePassword') ||
      changed('circuitId') ||
      changed('macAddress') ||
      changed('framedIpAddress');

    if (identityChanged) {
      // PENDING_INSTALL ainda não existe no RADIUS — não há nada pra sync nem
      // cleanup. Quando técnico ativar via /provisioning/install, o
      // ProvisioningService enfileira AUTHORIZE com os identificadores finais.
      if (updated.status === PrismaContractStatus.PENDING_INSTALL) {
        this.logger.log(
          `[contracts.update] contrato ${updated.id} em PENDING_INSTALL — ` +
            'skipando enqueue RADIUS (será feito por ProvisioningService.install)',
        );
      } else {
        const oldId = safeRadiusIdentifier(existing);
        const newId = safeRadiusIdentifier(updated);

        if (oldId && newId && oldId !== newId) {
          // Limpa o identificador antigo ANTES de re-autorizar o novo. Ordem importa
          // porque o applier processa eventos em createdAt ASC.
          await this.radius.enqueueCleanupOldIdentifier(
            existing,
            oldId,
            `identificador alterado: ${oldId} -> ${newId}`,
          );
        }
        await this.radius.enqueueSync(
          updated,
          oldId === newId
            ? 'config RADIUS alterada (mesmo identificador)'
            : `identificador alterado: ${oldId ?? '?'} -> ${newId ?? '?'}`,
        );
      }
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.updated',
      resource: 'contracts',
      resourceId: updated.id,
    });
    return toContractResponse(updated, { includePassword: true });
  }

  // ---------------------------------------------------------------------------
  // TRANSIÇÕES DE ESTADO
  // ---------------------------------------------------------------------------
  async suspend(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: SuspendContractRequest,
  ): Promise<ContractResponse> {
    const reason: ContractSuspendReason = input.reason;
    return this.applySuspend(tenantId, id, reason, { actorUserId, manual: true, note: input.note });
  }

  /**
   * Versão interna usada pelo cron (sem actor humano).
   * Pública porque o OverdueScanService precisa chamá-la.
   */
  async applySuspend(
    tenantId: string,
    id: string,
    reason: ContractSuspendReason,
    opts: { actorUserId?: string; manual?: boolean; note?: string } = {},
  ): Promise<ContractResponse> {
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');
    if (existing.status === PrismaContractStatus.CANCELLED) {
      throw new BadRequestException('Contrato cancelado não pode ser suspenso');
    }
    if (existing.status === PrismaContractStatus.PENDING_INSTALL) {
      throw new BadRequestException(
        'Contrato aguardando instalação não está ativo — não há o que suspender. ' +
          'Pra desistir antes de instalar, use cancelar.',
      );
    }
    if (existing.status === PrismaContractStatus.SUSPENDED) {
      return toContractResponse(
        (await this.prisma.contract.findFirstOrThrow({
          where: { id },
          include: DEFAULT_INCLUDE,
        })),
        { includePassword: true },
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.update({
        where: { id: existing.id },
        data: {
          status: PrismaContractStatus.SUSPENDED,
          suspendReason: reason as PrismaSuspendReason,
          suspendedAt: new Date(),
          updatedById: opts.actorUserId ?? null,
        },
        include: DEFAULT_INCLUDE,
      });
      await this.radius.enqueueSync(c, opts.note ?? `suspensão (${reason})`, tx);
      await this.radius.enqueueDisconnect(c, `suspensão (${reason})`, tx);
      await recalcCustomerStatus(tx, tenantId, c.customerId);
      return c;
    });

    // CoA real DEPOIS do commit — radcheck/radreply já refletem o novo estado.
    // Não-bloqueante: se cliente já estava offline, retorna 0 NAS e segue.
    const coaResults = await this.fireCoADisconnect(updated, `suspensão (${reason})`);

    await this.audit.log({
      tenantId,
      userId: opts.actorUserId ?? null,
      action: 'contracts.suspended',
      resource: 'contracts',
      resourceId: updated.id,
      metadata: {
        reason,
        manual: opts.manual ?? false,
        note: opts.note ?? null,
        coaKicked: coaResults.kicked,
      },
    });
    return toContractResponse(updated, { includePassword: true });
  }

  async reactivate(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: ReactivateContractRequest,
  ): Promise<ContractResponse> {
    return this.applyReactivate(tenantId, id, { actorUserId, note: input.note });
  }

  async applyReactivate(
    tenantId: string,
    id: string,
    opts: { actorUserId?: string; note?: string } = {},
  ): Promise<ContractResponse> {
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');
    if (existing.status === PrismaContractStatus.CANCELLED) {
      throw new BadRequestException('Contrato cancelado não pode ser reativado');
    }
    if (existing.status === PrismaContractStatus.PENDING_INSTALL) {
      throw new BadRequestException(
        'Contrato aguardando instalação — use /provisioning/install pra ativar.',
      );
    }
    if (existing.status === PrismaContractStatus.ACTIVE) {
      return toContractResponse(
        (await this.prisma.contract.findFirstOrThrow({ where: { id }, include: DEFAULT_INCLUDE })),
        { includePassword: true },
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.update({
        where: { id: existing.id },
        data: {
          status: PrismaContractStatus.ACTIVE,
          suspendReason: null,
          suspendedAt: null,
          activatedAt: existing.activatedAt ?? new Date(),
          updatedById: opts.actorUserId ?? null,
        },
        include: DEFAULT_INCLUDE,
      });
      await this.radius.enqueueSync(c, opts.note ?? 'reativação', tx);
      await recalcCustomerStatus(tx, tenantId, c.customerId);
      return c;
    });

    await this.audit.log({
      tenantId,
      userId: opts.actorUserId ?? null,
      action: 'contracts.reactivated',
      resource: 'contracts',
      resourceId: updated.id,
      metadata: { note: opts.note ?? null },
    });
    return toContractResponse(updated, { includePassword: true });
  }

  // ---------------------------------------------------------------------------
  // REABRIR CONTRATO CANCELADO (cancelou por engano)
  // ---------------------------------------------------------------------------
  /**
   * Reabre um contrato cancelado por engano. Volta pra ACTIVE (se já tinha
   * ativação) ou PENDING_INSTALL (se nunca foi instalado). Re-sincroniza o
   * RADIUS quando volta ACTIVE. NÃO descancela as faturas que o cancelamento
   * cancelou — o operador re-gera as que precisar.
   */
  async reopen(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<ContractResponse> {
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');
    if (existing.status !== PrismaContractStatus.CANCELLED) {
      throw new BadRequestException('Só dá pra reabrir um contrato cancelado');
    }

    const nextStatus = existing.activatedAt
      ? PrismaContractStatus.ACTIVE
      : PrismaContractStatus.PENDING_INSTALL;

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          cancelledAt: null,
          updatedById: actorUserId,
        },
        include: DEFAULT_INCLUDE,
      });
      if (nextStatus === PrismaContractStatus.ACTIVE) {
        await this.radius.enqueueSync(c, 'reabertura de contrato', tx);
      }
      await recalcCustomerStatus(tx, tenantId, c.customerId);
      return c;
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.reopened',
      resource: 'contracts',
      resourceId: updated.id,
      beforeState: { status: 'CANCELLED' },
      afterState: { status: nextStatus },
    });
    return toContractResponse(updated, { includePassword: true });
  }

  // ---------------------------------------------------------------------------
  // RELIGUE DE CONFIANÇA
  // ---------------------------------------------------------------------------
  /**
   * Reativa contrato suspenso por inadimplência sem que o cliente tenha
   * pagado, concedendo um prazo de N dias. O `trustExtensionUntil` é o
   * deadline; o OverdueScan diário verifica e re-suspende ao expirar.
   *
   * Não exige pagamento. Audit fica como SECURITY-relevant: operadores
   * podem abusar disso pra esconder inadimplência.
   */
  async trustExtend(
    tenantId: string,
    actorUserId: string,
    id: string,
    opts: { days: number; note?: string },
  ): Promise<ContractResponse> {
    const days = Math.max(1, Math.min(30, Math.floor(opts.days)));
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');
    if (existing.status !== PrismaContractStatus.SUSPENDED) {
      throw new BadRequestException(
        'Religue de confiança só vale pra contratos suspensos',
      );
    }
    if (existing.suspendReason !== 'OVERDUE_PAYMENT') {
      throw new BadRequestException(
        'Contrato suspenso manualmente — use Reativar normal',
      );
    }

    const until = new Date();
    until.setUTCHours(0, 0, 0, 0);
    until.setUTCDate(until.getUTCDate() + days);

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.update({
        where: { id: existing.id },
        data: {
          status: PrismaContractStatus.ACTIVE,
          suspendReason: null,
          suspendedAt: null,
          trustExtensionUntil: until,
          updatedById: actorUserId,
        },
        include: DEFAULT_INCLUDE,
      });
      await this.radius.enqueueSync(c, `religue de confiança (${days}d)`, tx);
      await recalcCustomerStatus(tx, tenantId, c.customerId);
      return c;
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.trust_extended',
      // Reusa WARNING porque CRITICAL é o mais alto disponível e queremos
      // diferenciar de erros de sistema.
      level: 'WARNING',
      resource: 'contracts',
      resourceId: updated.id,
      metadata: {
        days,
        until: until.toISOString().slice(0, 10),
        note: opts.note ?? null,
      },
    });

    return toContractResponse(updated, { includePassword: true });
  }

  // ---------------------------------------------------------------------------
  // CHANGE PLAN (com prorate)
  // ---------------------------------------------------------------------------
  /**
   * Preview do impacto financeiro de uma troca de plano. Não persiste nada,
   * só calcula crédito/débito. UI usa pra confirmar com o operador antes do
   * POST /change-plan.
   *
   * Fórmula (POSTPAID, applyProration=true):
   *   cycleStart  = previousDueDateFor(dueDay, today)
   *   cycleEnd    = nextDueDateFor(dueDay, today)
   *   totalDays   = cycleEnd - cycleStart
   *   remainDays  = cycleEnd - today
   *   creditOld   = prorate(oldMonthly, remainDays, totalDays)
   *   chargeNew   = prorate(newMonthly, remainDays, totalDays)
   *   delta       = chargeNew - creditOld
   */
  async previewChangePlan(
    tenantId: string,
    contractId: string,
    input: PreviewChangePlanRequest,
  ): Promise<ChangePlanPreviewResponse> {
    const { contract, newPlan, today, math } = await this.prepareChangePlan(
      tenantId,
      contractId,
      input,
    );
    return {
      newPlanId: newPlan.id,
      newPlanName: newPlan.name,
      newMonthlyValue: Number(newPlan.monthlyPrice),
      cycleStart: math.cycleStart.toISOString().slice(0, 10),
      cycleEnd: math.cycleEnd.toISOString().slice(0, 10),
      totalDays: math.totalDays,
      remainDays: math.remainDays,
      creditOld: Number(math.creditOld),
      chargeNew: Number(math.chargeNew),
      delta: Number(math.delta),
      willCreate: !input.applyProration
        ? 'NONE'
        : math.delta.isPositive()
          ? 'PRORATION'
          : math.delta.isNegative()
            ? 'CREDIT'
            : 'NONE',
    };
  }

  /**
   * Troca o plano de um contrato. Em ACTIVE com applyProration=true gera
   * PRORATION (delta > 0) ou CREDIT (delta < 0). Em PENDING_INSTALL apenas
   * troca a referência sem fatura (contrato ainda não cobrou nada).
   *
   * Bloqueado em PREPAID na v1 — exige cancelar e recriar (decisão do owner).
   *
   * Side-effects fora da TX (idem cancel/suspend):
   *   - Re-enqueue RADIUS pra refletir nova banda em Mikrotik-Rate-Limit.
   */
  async changePlan(
    tenantId: string,
    actorUserId: string,
    contractId: string,
    input: ChangeContractPlanRequest,
  ): Promise<ContractResponse> {
    const { contract, newPlan, today, math, oldMonthlyValue } =
      await this.prepareChangePlan(tenantId, contractId, input);

    // Caso PENDING_INSTALL: contrato nunca cobrou nada, então só troca a
    // referência + valores denormalizados, sem fatura de ajuste. Mais rápido
    // e barato pro operador que está montando o cadastro.
    const isPending = contract.status === PrismaContractStatus.PENDING_INSTALL;

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.update({
        where: { id: contract.id },
        data: {
          planId: newPlan.id,
          monthlyValue: new Prisma.Decimal(newPlan.monthlyPrice),
          bandwidthMbps: newPlan.downloadMbps,
          uploadMbps: newPlan.uploadMbps,
          updatedById: actorUserId,
        },
        include: DEFAULT_INCLUDE,
      });

      // Em ACTIVE com applyProration: cria fatura PRORATION ou CREDIT.
      // Idempotência fraca: usamos reference baseada em data; rodar duas
      // vezes no mesmo dia gera 2 ajustes (controlado por UI, não banco).
      if (!isPending && input.applyProration) {
        if (math.delta.isPositive()) {
          await tx.contractInvoice.create({
            data: {
              tenantId,
              contractId: c.id,
              amount: math.delta,
              dueDate: math.cycleEnd,
              kind: InvoiceKind.PRORATION,
              periodStart: today,
              periodEnd: math.cycleEnd,
              status: InvoiceStatus.OPEN,
              reference: InvoiceReference.proration(today),
            },
          });
        } else if (math.delta.isNegative()) {
          // CREDIT: amount NEGATIVO. Operador aplica como desconto na próxima
          // REGULAR (manual na v1 — vide "Fora de escopo" no plano).
          await tx.contractInvoice.create({
            data: {
              tenantId,
              contractId: c.id,
              amount: math.delta,
              dueDate: math.cycleEnd,
              kind: InvoiceKind.CREDIT,
              periodStart: today,
              periodEnd: math.cycleEnd,
              status: InvoiceStatus.OPEN,
              reference: InvoiceReference.credit(today),
            },
          });
        }
      }
      return c;
    });

    // Fora da TX: re-sync RADIUS pra refletir nova banda. Em PENDING_INSTALL
    // pula (RADIUS ainda não foi aplicado).
    if (!isPending) {
      try {
        await this.radius.enqueueSync(
          updated,
          `troca de plano: ${contract.planId ?? '(sem)'} -> ${newPlan.id}`,
        );
      } catch (err) {
        this.logger.warn(
          `[changePlan] enqueueSync falhou pra ${updated.id} — ` +
            'reconciler vai corrigir em ≤5min. ' +
            `erro: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.plan_changed',
      resource: 'contracts',
      resourceId: updated.id,
      beforeState: {
        planId: contract.planId,
        monthlyValue: oldMonthlyValue.toString(),
        bandwidthMbps: contract.bandwidthMbps,
        uploadMbps: contract.uploadMbps,
      },
      afterState: {
        planId: newPlan.id,
        planName: newPlan.name,
        monthlyValue: newPlan.monthlyPrice.toString(),
        bandwidthMbps: newPlan.downloadMbps,
        uploadMbps: newPlan.uploadMbps,
        delta: math.delta.toString(),
        applyProration: input.applyProration,
        note: input.note ?? null,
      },
    });

    return toContractResponse(updated, { includePassword: true });
  }

  /**
   * Núcleo compartilhado entre preview e apply. Carrega contrato + plano,
   * valida regras (status, mesmo plano, PREPAID), calcula o math de prorate.
   */
  private async prepareChangePlan(
    tenantId: string,
    contractId: string,
    input: { planId: string; effectiveDate?: string; applyProration?: boolean },
  ): Promise<{
    contract: ContractWithRelations;
    newPlan: {
      id: string;
      name: string;
      monthlyPrice: Prisma.Decimal;
      downloadMbps: number;
      uploadMbps: number;
    };
    today: Date;
    oldMonthlyValue: Prisma.Decimal;
    math: {
      cycleStart: Date;
      cycleEnd: Date;
      totalDays: number;
      remainDays: number;
      creditOld: Prisma.Decimal;
      chargeNew: Prisma.Decimal;
      delta: Prisma.Decimal;
    };
  }> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId, deletedAt: null },
      include: DEFAULT_INCLUDE,
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    if (contract.status === PrismaContractStatus.CANCELLED) {
      throw new BadRequestException('Contrato cancelado não pode trocar de plano');
    }
    if (contract.paymentMode === PrismaPaymentMode.PREPAID) {
      throw new BadRequestException(
        'Troca de plano em pré-pago não é suportada na v1 — cancele e recrie.',
      );
    }
    if (input.planId === contract.planId) {
      throw new BadRequestException('Plano informado é o mesmo do contrato atual');
    }

    const newPlan = await this.prisma.plan.findFirst({
      where: { id: input.planId, tenantId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        monthlyPrice: true,
        downloadMbps: true,
        uploadMbps: true,
      },
    });
    if (!newPlan) throw new NotFoundException('Plano informado não encontrado ou inativo');

    const today = input.effectiveDate
      ? new Date(`${input.effectiveDate}T00:00:00.000Z`)
      : utcMidnight(new Date());

    const cycleStart = previousDueDateFor(contract.dueDay, today);
    const cycleEnd = nextDueDateFor(contract.dueDay, today);
    const totalDays = daysBetween(cycleStart, cycleEnd);
    const remainDays = Math.max(0, daysBetween(today, cycleEnd));
    const oldMonthlyValue = new Prisma.Decimal(contract.monthlyValue);
    const newMonthlyValue = new Prisma.Decimal(newPlan.monthlyPrice);
    const creditOld = prorate(oldMonthlyValue, remainDays, totalDays);
    const chargeNew = prorate(newMonthlyValue, remainDays, totalDays);
    const delta = chargeNew.minus(creditOld);

    return {
      contract,
      newPlan: { ...newPlan, monthlyPrice: newMonthlyValue },
      today,
      oldMonthlyValue,
      math: { cycleStart, cycleEnd, totalDays, remainDays, creditOld, chargeNew, delta },
    };
  }

  async cancel(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CancelContractRequest,
  ): Promise<ContractResponse> {
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');
    if (existing.status === PrismaContractStatus.CANCELLED) {
      return toContractResponse(
        (await this.prisma.contract.findFirstOrThrow({ where: { id }, include: DEFAULT_INCLUDE })),
        { includePassword: true },
      );
    }

    // Cliente desistiu antes da instalação (PENDING_INSTALL → CANCELLED):
    // não há RADIUS aplicado nem sessão ativa, então skipamos enqueueSync,
    // enqueueDisconnect e CoA. ONT pode existir como placeholder mas a
    // desautorização na OLT é responsabilidade futura (ProvisioningService).
    const wasPendingInstall = existing.status === PrismaContractStatus.PENDING_INSTALL;

    // Transação MINIMAL: só o que NÃO PODE FALHAR (atualizar status + invoices).
    // RADIUS sync/disconnect e CoA ficam FORA — se um deles falhar, contrato
    // já está CANCELLED e admin pode resync depois via cron reconciler.
    //
    // Antes (bug observado): tudo numa tx só → enqueueSync lançava pra IPoE
    // sem identifier, rollback inteiro e 500 sem feedback claro.
    const isPrepaid = existing.paymentMode === PrismaPaymentMode.PREPAID;

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contract.update({
        where: { id: existing.id },
        data: {
          status: PrismaContractStatus.CANCELLED,
          cancelledAt: new Date(),
          updatedById: actorUserId,
        },
        include: DEFAULT_INCLUDE,
      });
      if (!isPrepaid) {
        // POSTPAID: cancela faturas pendentes/vencidas — não faz sentido
        // continuar cobrando contrato encerrado.
        await tx.contractInvoice.updateMany({
          where: {
            tenantId,
            contractId: c.id,
            status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE] },
          },
          data: { status: InvoiceStatus.CANCELLED },
        });
      } else {
        // PREPAID: cliente pagou adiantado — não há cobrança pendente a
        // cancelar. Se existir uma INITIAL OPEN (ativou e não recebeu
        // pagamento ainda), também não cancelamos: operador precisa decidir
        // (cobrar fora do sistema ou marcar CANCELLED manualmente). Vide
        // política "no cancelamento cliente não deve a última".
        // OverdueScan.suspendExpiredPrepaid desativa quando prepaidUntil
        // chega — fluxo: cliente usa até o fim do período pago, daí PERDE
        // o serviço; sem dívida.
      }
      await recalcCustomerStatus(tx, tenantId, c.customerId);
      return c;
    });

    // Pós-commit: side effects RADIUS e CoA. Falha aqui NÃO reverte cancel.
    let coaResults: { kicked: number; total: number } = { kicked: 0, total: 0 };
    if (!wasPendingInstall) {
      const hasIdentifier = !!safeRadiusIdentifier(updated);
      if (hasIdentifier) {
        try {
          await this.radius.enqueueSync(updated, input.note ?? 'cancelamento');
          await this.radius.enqueueDisconnect(updated, input.note ?? 'cancelamento');
        } catch (err) {
          this.logger.warn(
            `[cancel] enqueueSync/Disconnect falhou pra ${updated.id} — ` +
              'cancel mantido. Reconciler vai corrigir RADIUS em ≤5min. ' +
              `erro: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        try {
          coaResults = await this.fireCoADisconnect(updated, 'cancelamento');
        } catch (err) {
          this.logger.warn(
            `[cancel] CoA disconnect falhou pra ${updated.id} — cancel ok. ` +
              `erro: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        this.logger.log(
          `[cancel] contrato ${updated.id} sem identificador RADIUS — ` +
            'pulando enqueueSync/CoA (não estava aplicado).',
        );
      }
    }

    // Ufinet: dispara baja (se ativo) ou cancelación (se ONT não confirmada).
    await this.tryUfinetTeardown(tenantId, updated.id, actorUserId);

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.cancelled',
      resource: 'contracts',
      resourceId: updated.id,
      metadata: { note: input.note ?? null, coaKicked: coaResults.kicked },
    });
    return toContractResponse(updated, { includePassword: true });
  }

  // ---------------------------------------------------------------------------
  // CoA — Disconnect-Request automático após suspend/cancel
  // ---------------------------------------------------------------------------
  /**
   * Manda Disconnect-Request pro CoA e nunca lança. Atualiza o evento
   * RadiusEvent (último PENDING DISCONNECT pra esse contrato) pra APPLIED/FAILED
   * com o resultado consolidado. Chamado em fluxos automáticos (suspend,
   * cancel) — não é o caminho do botão manual, que é `kick()`.
   *
   * IMPORTANTE: chame DEPOIS de comitar o update do contrato + radcheck/
   * radreply. Senão o cliente reconecta na mesma sessão e fica autorizado
   * com as credenciais antigas. Aqui assumimos que `radius.enqueueSync`
   * já rodou na transação.
   */
  // Dispara disconnect (multi-vendor: CoA / Mikrotik API / SSH) — vide DisconnectService.
  private async fireCoADisconnect(
    contract: ContractWithRelations,
    reason: string,
  ): Promise<{ kicked: number; total: number }> {
    // Cobre PPPoE (pppoeUsername) E IPoE (macAddress / circuitId).
    if (
      !contract.pppoeUsername &&
      !contract.macAddress &&
      !contract.circuitId
    ) {
      return { kicked: 0, total: 0 };
    }

    try {
      const results = await this.disconnect.disconnectContract({
        tenantId: contract.tenantId,
        authType: contract.authMethod,
        pppoeUsername: contract.pppoeUsername,
        macAddress: contract.macAddress,
        circuitId: contract.circuitId,
      });
      const kicked = results.filter((r) => r.ok).length;

      // Atualiza o último evento DISCONNECT PENDING desse contrato pra APPLIED
      // ou FAILED — assim a tela de eventos RADIUS mostra o resultado real.
      const lastEvent = await this.prisma.radiusEvent.findFirst({
        where: {
          contractId: contract.id,
          action: 'DISCONNECT',
          status: 'PENDING',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (lastEvent) {
        await this.prisma.radiusEvent.update({
          where: { id: lastEvent.id },
          data: {
            status: kicked > 0 ? 'APPLIED' : 'FAILED',
            appliedAt: new Date(),
            error:
              kicked === 0 && results.length > 0
                ? results.find((r) => !r.ok)?.message ?? 'No NAS responded'
                : null,
          },
        });
      }
      this.logger.log(
        `[CoA] disconnect contract=${contract.id} reason="${reason}" kicked=${kicked}/${results.length}`,
      );
      return { kicked, total: results.length };
    } catch (err) {
      // Nunca derruba o fluxo principal — só loga
      this.logger.warn(
        `[CoA] disconnect FAILED contract=${contract.id}: ${(err as Error).message}`,
      );
      return { kicked: 0, total: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // KICK — força CoA-Disconnect ao vivo (manual, via UI)
  // ---------------------------------------------------------------------------
  /**
   * Manda Disconnect-Request pra todos os NASes onde o `pppoeUsername` tem
   * sessão ativa. Não muda estado do contrato — é "kick" mesmo.
   *
   * Casos de uso:
   *   - operador quer derrubar cliente pra forçar reconexão (debug);
   *   - troca de plano em que o speed-rate só atualiza após nova sessão;
   *   - cliente reclamando de IP travado.
   *
   * Idempotente: se não há sessão ativa, retorna `{ kicked: 0 }` sem erro.
   */
  async kick(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<{ kicked: number; results: Array<{ nasIp: string; ok: boolean; error?: string }> }> {
    const contract = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    if (
      !contract.pppoeUsername &&
      !contract.macAddress &&
      !contract.circuitId
    ) {
      throw new BadRequestException(
        'Contrato sem identificador RADIUS (pppoeUsername, macAddress ou circuitId) — nada pra desconectar',
      );
    }

    const results = await this.disconnect.disconnectContract({
      tenantId,
      authType: contract.authMethod,
      pppoeUsername: contract.pppoeUsername,
      macAddress: contract.macAddress,
      circuitId: contract.circuitId,
    });
    const kicked = results.filter((r) => r.ok).length;

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.kicked',
      resource: 'contracts',
      resourceId: contract.id,
      metadata: {
        identifier:
          contract.pppoeUsername ?? contract.macAddress ?? contract.circuitId,
        authType: contract.authMethod,
        totalAttempts: results.length,
        kicked,
        results: results.map((r) => ({
          nasIp: r.nasIp,
          ok: r.ok,
          strategy: r.strategy,
          reason: r.reason ?? null,
          message: r.message ?? null,
        })),
      },
    });

    return {
      kicked,
      results: results.map((r) => ({
        nasIp: r.nasIp,
        equipmentName: r.equipmentName,
        strategy: r.strategy,
        ok: r.ok,
        reason: r.reason ?? null,
        message: r.message ?? null,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // DELETE (soft)
  // ---------------------------------------------------------------------------
  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.prisma.contract.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Contrato não encontrado');
    if (existing.status !== PrismaContractStatus.CANCELLED) {
      throw new BadRequestException('Cancele o contrato antes de excluí-lo');
    }

    // Libera os uniques REUTILIZÁVEIS (pppoe_username, circuit_id, mac_address)
    // pra que um novo contrato do mesmo cliente possa reusá-los. O unique do
    // Postgres conta linhas soft-deletadas, então sem o sufixo o re-cadastro do
    // mesmo PPPoE/MAC dá P2002. O `code`/`seq` NÃO são liberados — são a
    // identidade sequencial permanente do contrato (nunca reusada).
    // Convenção: `<original>__deleted_<timestamp>` — preserva legibilidade
    // pra debug/auditoria, e o `__` é improvável colidir com username real.
    const stamp = Date.now().toString(36);
    const suffix = `__del_${stamp}`;
    const sufx = (v: string | null) => (v ? `${v}${suffix}`.slice(0, 64) : null);

    await this.prisma.contract.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        updatedById: actorUserId,
        // null fica null; só sufixa quando havia valor.
        pppoeUsername: sufx(existing.pppoeUsername),
        circuitId: existing.circuitId
          ? `${existing.circuitId}${suffix}`.slice(0, 128)
          : null,
        macAddress: existing.macAddress
          ? `${existing.macAddress}${suffix}`.slice(0, 32)
          : null,
      },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.deleted',
      resource: 'contracts',
      resourceId: id,
      // Audit guarda o original pra rastreio.
      beforeState: {
        pppoeUsername: existing.pppoeUsername,
        circuitId: existing.circuitId,
        macAddress: existing.macAddress,
        code: existing.code,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // PPPoE LOGIN — geração + resolução de unicidade
  // ---------------------------------------------------------------------------

  /**
   * Resolve o login PPPoE final, garantido único no tenant.
   *
   * Ordem de tentativa:
   *   1. Se o operador enviou um username explícito → tenta ele primeiro.
   *   2. Variações derivadas do nome do cliente (charlesbarreto,
   *      charlesmacedo, barretomacedo — vide pppoe-login.ts).
   *   3. Se TODAS colidem → sufixo numérico no primeiro candidato
   *      (charlesbarreto2, charlesbarreto3, ...).
   *
   * Roda dentro da transação de criação do contrato — a checagem de
   * unicidade vê estado consistente. O unique constraint
   * @@unique([tenantId, pppoeUsername]) é o backstop final.
   */
  private async resolvePppoeUsername(
    tx: Prisma.TransactionClient,
    tenantId: string,
    requested: string | null,
    customerName: string,
  ): Promise<string> {
    const isFree = async (u: string): Promise<boolean> =>
      (await tx.contract.count({
        where: { tenantId, pppoeUsername: u, deletedAt: null },
      })) === 0;

    // Monta lista de candidatos: explícito (se houver) + derivados do nome.
    const candidates: string[] = [];
    const add = (c: string | null | undefined): void => {
      if (c && c.length >= 3 && !candidates.includes(c)) candidates.push(c);
    };
    if (requested?.trim()) add(normalizeNameToken(requested));
    for (const c of pppoeLoginCandidates(customerName)) add(c);
    // Fallback final caso o nome do cliente não produza nada utilizável.
    if (candidates.length === 0) add('cliente');

    // 1ª passada — candidatos base
    for (const cand of candidates) {
      if (await isFree(cand)) return cand;
    }
    // 2ª passada — sufixo numérico no primeiro candidato
    const root = candidates[0];
    for (let n = 2; n < 1000; n++) {
      const withSuffix = pppoeLoginWithSuffix(root, n);
      if (await isFree(withSuffix)) return withSuffix;
    }
    // Praticamente impossível chegar aqui (1000 colisões pro mesmo nome).
    throw new ConflictException(
      `Não foi possível gerar um login PPPoE único pra "${customerName}"`,
    );
  }

  // ---------------------------------------------------------------------------
  // WI-FI MANAGEMENT (pós-instalação via TR-069)
  // ---------------------------------------------------------------------------

  /**
   * Status atual do Wi-Fi do contrato + última task TR-069. UI mostra no card
   * "/contracts/:id" pra operador saber se a última mudança aplicou.
   */
  async getWifiStatus(tenantId: string, contractId: string): Promise<ContractWifiStatus> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId, deletedAt: null },
      select: {
        ssid: true,
        wifiPasswordEnc: true,
        ont: {
          select: {
            tr069Device: {
              select: {
                id: true,
                lastInformAt: true,
              },
            },
          },
        },
      },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');

    const deviceId = contract.ont?.tr069Device?.id ?? null;
    const lastInformAt = contract.ont?.tr069Device?.lastInformAt ?? null;

    const lastTask = await this.prisma.tr069Task.findFirst({
      where: { tenantId, contractId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        status: true,
        createdAt: true,
        completedAt: true,
        error: true,
      },
    });

    return {
      ssid: contract.ssid,
      hasWifiPassword: !!contract.wifiPasswordEnc,
      hasTr069Device: !!deviceId,
      lastTask: lastTask
        ? {
            id: lastTask.id,
            action: lastTask.action,
            status: lastTask.status,
            createdAt: lastTask.createdAt.toISOString(),
            completedAt: lastTask.completedAt?.toISOString() ?? null,
            error: lastTask.error,
          }
        : null,
      lastInformAt: lastInformAt?.toISOString() ?? null,
    };
  }

  /**
   * Atualiza SSID/senha Wi-Fi e enfileira Tr069Task SET_PARAMS (+ Reboot
   * opcional). Aplicação real depende do CPE fazer próximo Inform (≤60s
   * típico). Operador vê status via getWifiStatus.
   *
   * Pre-req: contrato precisa ter ONT vinculada + Tr069Device pré-existente.
   * Sem isso (ex.: contrato ainda PENDING_INSTALL), retorna erro orientando
   * a usar /provisioning/install primeiro.
   */
  async updateWifi(
    tenantId: string,
    actorUserId: string,
    contractId: string,
    input: UpdateContractWifiRequest,
  ): Promise<UpdateContractWifiResponse> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId, deletedAt: null },
      include: {
        ont: {
          include: {
            tr069Device: true,
          },
        },
      },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    if (!contract.ont) {
      throw new BadRequestException(
        'Contrato sem ONT vinculada. Ative o cliente em /provisioning/install primeiro.',
      );
    }

    // Tr069Device pode ainda não existir se o CPE nunca fez Inform. Criamos
    // placeholder usando padrão "<OUI>-<SN_GPON>" (mesmo do enqueueSetWifi).
    // Quando CPE realmente conectar, o session matchupa pelo SN.
    let deviceDbId = contract.ont.tr069Device?.id;
    if (!deviceDbId) {
      const placeholder = `00259E-${contract.ont.snGpon.toUpperCase()}`;
      const created = await this.prisma.tr069Device.upsert({
        where: { deviceId: placeholder },
        create: {
          tenantId,
          ontId: contract.ont.id,
          deviceId: placeholder,
          manufacturer: 'Huawei',
          oui: '00259E',
          status: 'UNKNOWN',
        },
        update: { ontId: contract.ont.id },
      });
      deviceDbId = created.id;
    }

    // Persiste SSID em plaintext + senha encrypted no Contract.
    await this.prisma.contract.update({
      where: { id: contract.id },
      data: {
        ssid: input.ssid,
        wifiPasswordEnc: this.crypto.encrypt(input.wifiPassword),
        updatedById: actorUserId,
      },
    });

    // Enfileira SET_PARAMS — aplica SSID + senha em 2.4G e 5G + reduz
    // PeriodicInformInterval pra 60s pra próxima sessão.
    const setParams = await this.prisma.tr069Task.create({
      data: {
        tenantId,
        deviceId: deviceDbId,
        contractId,
        action: 'SET_PARAMS',
        status: 'PENDING',
        payload: {
          params: [
            { name: HUAWEI_EG8145_PATHS.ssid24, value: input.ssid, type: 'xsd:string' },
            { name: HUAWEI_EG8145_PATHS.pwd24, value: input.wifiPassword, type: 'xsd:string' },
            // 5GHz: SSID único (band steering) ou nome+"-5G" (dual band),
            // conforme o modelo da ONT registrado no install.
            {
              name: HUAWEI_EG8145_PATHS.ssid50,
              value: ssid5gFor(input.ssid, contract.ont.wifiBandMode),
              type: 'xsd:string',
            },
            { name: HUAWEI_EG8145_PATHS.pwd50, value: input.wifiPassword, type: 'xsd:string' },
            { name: HUAWEI_EG8145_PATHS.informInterval, value: '60', type: 'xsd:unsignedInt' },
          ],
        },
      },
    });

    let rebootTaskId: string | null = null;
    if (input.reboot) {
      const reboot = await this.prisma.tr069Task.create({
        data: {
          tenantId,
          deviceId: deviceDbId,
          contractId,
          action: 'REBOOT',
          status: 'PENDING',
          payload: {},
        },
      });
      rebootTaskId = reboot.id;
    }

    this.logger.log(
      `[contracts.updateWifi] contract=${contractId} ssid="${input.ssid}" ` +
        `setParamsTask=${setParams.id.slice(0, 8)} reboot=${input.reboot}`,
    );

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'contracts.wifi.updated',
      resource: 'contracts',
      resourceId: contractId,
      // Senha NUNCA vai no audit. SSID OK (não é PII).
      afterState: { ssid: input.ssid, reboot: input.reboot },
    });

    return {
      setParamsTaskId: setParams.id,
      rebootTaskId,
      etaSeconds: 60, // PeriodicInformInterval esperado pós primeira sessão
    };
  }
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Prefixo default do código de contrato quando o tenant ainda não configurou
 * um `contractPrefix`: 3 primeiros caracteres alfanuméricos do slug, em
 * maiúsculas. Fallback "NTX" se o slug não render 3 chars.
 */
function deriveContractPrefix(slug?: string | null): string {
  const base = (slug ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return base.slice(0, 3) || 'NTX';
}

// ---------------------------------------------------------------------------
// MAPPER
// ---------------------------------------------------------------------------
function toContractResponse(
  c: ContractWithRelations,
  opts: { includePassword: boolean },
): ContractResponse {
  return {
    id: c.id,
    tenantId: c.tenantId,
    customerId: c.customerId,
    code: c.code,
    authMethod: c.authMethod as 'PPPOE' | 'IPOE',
    pppoeUsername: c.pppoeUsername,
    ...(opts.includePassword ? { pppoePassword: c.pppoePassword } : {}),
    circuitId: c.circuitId,
    remoteId: c.remoteId,
    macAddress: c.macAddress,
    framedIpAddress: c.framedIpAddress,
    vlanId: c.vlanId,
    installationAddress: c.installationAddress,
    installationMapsUrl: c.installationMapsUrl,
    latitude: c.latitude != null ? Number(c.latitude) : null,
    longitude: c.longitude != null ? Number(c.longitude) : null,
    planId: c.planId,
    planName: c.plan?.name ?? null,
    monthlyValue: Number(c.monthlyValue),
    bandwidthMbps: c.bandwidthMbps,
    uploadMbps: c.uploadMbps,
    dueDay: c.dueDay,
    paymentMode: c.paymentMode as PaymentMode,
    blockAfterDays: c.blockAfterDays,
    effectiveBlockAfterDays: resolveBlockAfterDays(
      { blockAfterDays: c.blockAfterDays },
      c.plan ? { blockAfterDays: c.plan.blockAfterDays } : null,
    ),
    prepaidUntil: c.prepaidUntil?.toISOString() ?? null,
    cycleAnchorDay: c.cycleAnchorDay,
    status: c.status as ContractStatus,
    suspendReason: (c.suspendReason as ContractSuspendReason | null) ?? null,
    activatedAt: c.activatedAt?.toISOString() ?? null,
    suspendedAt: c.suspendedAt?.toISOString() ?? null,
    cancelledAt: c.cancelledAt?.toISOString() ?? null,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    customer: c.customer
      ? {
          id: c.customer.id,
          displayName: c.customer.displayName,
          type: c.customer.type as 'INDIVIDUAL' | 'COMPANY',
        }
      : null,
  };
}
