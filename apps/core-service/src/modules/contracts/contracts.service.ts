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
  InvoiceStatus,
  Prisma,
} from '@prisma/client';

import {
  paginationMeta,
  type CancelContractRequest,
  type ContractResponse,
  type ContractStatus,
  type ContractSuspendReason,
  type CreateContractRequest,
  type ListContractsQuery,
  type Paginated,
  type ReactivateContractRequest,
  type SuspendContractRequest,
  type UpdateContractRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DisconnectService } from '../disconnect/disconnect.service';
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
  ) {}

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateContractRequest,
  ): Promise<ContractResponse> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: input.customerId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');

    const firstDue = input.firstDueDate ? new Date(`${input.firstDueDate}T00:00:00.000Z`) : undefined;

    const now = new Date();
    let created: ContractWithRelations;
    try {
      created = await this.prisma.$transaction(async (tx) => {
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
                pppoeUsername: input.pppoeUsername,
                pppoePassword: input.pppoePassword,
                circuitId: null,
                remoteId: null,
                macAddress: null,
                framedIpAddress: null,
                vlanId: null,
              };

        // initialStatus: comercial pode criar contrato já ACTIVE (fluxo
        // clássico) ou PENDING_INSTALL (fluxo ZTP — técnico ainda vai instalar
        // em campo via /provisioning/install/:contractId).
        const initialStatus =
          (input as { initialStatus?: 'ACTIVE' | 'PENDING_INSTALL' }).initialStatus ?? 'ACTIVE';
        const isPending = initialStatus === 'PENDING_INSTALL';

        const contract = await tx.contract.create({
          data: {
            tenantId,
            customerId: input.customerId,
            code: input.code ?? null,
            ...authData,
            installationAddress: input.installationAddress,
            installationMapsUrl: input.installationMapsUrl ?? null,
            monthlyValue: new Prisma.Decimal(input.monthlyValue),
            bandwidthMbps: input.bandwidthMbps,
            dueDay: input.dueDay,
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
          await this.invoiceGen.generateInitialInvoice(tx, contract, firstDue);
          await this.radius.enqueueSync(contract, 'contrato criado', tx);
        }
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
        // O alvo do unique varia: pppoe_username, circuit_id ou mac_address.
        const target = (err.meta?.target as string[] | string | undefined) ?? '';
        const targetStr = Array.isArray(target) ? target.join(',') : String(target);
        let field = 'identificador';
        if (targetStr.includes('pppoe')) field = 'PPPoE username';
        else if (targetStr.includes('circuit')) field = 'circuit-id';
        else if (targetStr.includes('mac')) field = 'MAC address';
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
    if (input.dueDay !== undefined) data.dueDay = input.dueDay;
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
      // Cancela todas as faturas abertas
      await tx.contractInvoice.updateMany({
        where: { tenantId, contractId: c.id, status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE] } },
        data: { status: InvoiceStatus.CANCELLED },
      });
      if (!wasPendingInstall) {
        await this.radius.enqueueSync(c, input.note ?? 'cancelamento', tx);
        await this.radius.enqueueDisconnect(c, input.note ?? 'cancelamento', tx);
      }
      return c;
    });

    // CoA real após commit — só pra contratos que estavam aplicados em RADIUS.
    const coaResults = wasPendingInstall
      ? { kicked: 0, total: 0 }
      : await this.fireCoADisconnect(updated, 'cancelamento');

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

    // Libera os uniques (pppoe_username, circuit_id, mac_address, code) pra
    // que um novo contrato com o mesmo identificador possa ser criado. O
    // unique constraint do Postgres conta linhas soft-deletadas, então sem
    // esse sufixo o re-cadastro do mesmo PPPoE/MAC dá P2002.
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
        code: existing.code ? `${existing.code}${suffix}`.slice(0, 32) : null,
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
    monthlyValue: Number(c.monthlyValue),
    bandwidthMbps: c.bandwidthMbps,
    dueDay: c.dueDay,
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
