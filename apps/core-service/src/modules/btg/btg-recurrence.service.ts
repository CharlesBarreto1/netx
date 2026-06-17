import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BtgRecurrenceStatus as PrismaBtgRecurrenceStatus,
  Prisma,
  type BtgRecurrence,
} from '@prisma/client';
import {
  paginationMeta,
  type BtgRecurrenceResponse,
  type CreateBtgRecurrenceRequest,
  type ListBtgRecurrencesQuery,
  type Paginated,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { BtgClientService } from './btg-client.service';
import { BtgConfigService } from './btg-config.service';
import type { BtgWebhookEvent } from './btg.types';

const RETRY_POLICY = 'ACCEPT_3R_7D';
/** Estados ainda "vivos" — reaproveitados em vez de recriar. */
const LIVE_STATUSES: PrismaBtgRecurrenceStatus[] = [
  PrismaBtgRecurrenceStatus.PENDING,
  PrismaBtgRecurrenceStatus.PROCESSING,
  PrismaBtgRecurrenceStatus.CREATED,
  PrismaBtgRecurrenceStatus.APPROVED,
];

/** Mapeia o status textual do BTG → enum local. */
function mapStatus(s: string | undefined): PrismaBtgRecurrenceStatus {
  switch ((s ?? '').toUpperCase()) {
    case 'PROCESSING':
      return PrismaBtgRecurrenceStatus.PROCESSING;
    case 'CREATED':
      return PrismaBtgRecurrenceStatus.CREATED;
    case 'APPROVED':
      return PrismaBtgRecurrenceStatus.APPROVED;
    case 'REJECTED':
      return PrismaBtgRecurrenceStatus.REJECTED;
    case 'EXPIRED':
      return PrismaBtgRecurrenceStatus.EXPIRED;
    case 'CANCELED':
    case 'CANCELING':
      return PrismaBtgRecurrenceStatus.CANCELED;
    case 'FINISHED':
      return PrismaBtgRecurrenceStatus.FINISHED;
    default:
      return PrismaBtgRecurrenceStatus.CREATED;
  }
}

@Injectable()
export class BtgRecurrenceService {
  private readonly logger = new Logger(BtgRecurrenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: BtgConfigService,
    private readonly client: BtgClientService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // CRIAÇÃO
  // ===========================================================================
  async createForContract(
    tenantId: string,
    actorUserId: string,
    contractId: string,
    input: CreateBtgRecurrenceRequest,
  ): Promise<BtgRecurrenceResponse> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId },
      include: { customer: true },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado');

    const doc = (contract.customer.taxId ?? '').replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) {
      throw new BadRequestException('Cliente sem CPF/CNPJ válido — exigido para Pix Automático');
    }

    // Reaproveita recorrência viva, salvo `force`.
    const live = await this.prisma.btgRecurrence.findFirst({
      where: { tenantId, contractId, status: { in: LIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    if (live && !input.force) return this.toResponse(live);
    if (live && input.force && live.authorizationId) {
      const cfgForCancel = await this.config.resolve(tenantId);
      try {
        await this.client.cancelRecurrence(
          cfgForCancel,
          this.config.makePersistRefresh(tenantId),
          live.authorizationId,
        );
      } catch (e) {
        this.logger.warn(`Falha ao cancelar recorrência anterior ${live.id}: ${String(e)}`);
      }
      await this.prisma.btgRecurrence.update({
        where: { id: live.id },
        data: { status: PrismaBtgRecurrenceStatus.CANCELED, canceledAt: new Date() },
      });
    }

    const cfg = await this.config.resolve(tenantId);
    if (!cfg.companyId || !cfg.accountNumber || !cfg.accountBranch) {
      throw new BadRequestException('Conta BTG incompleta (companyId/agência/número)');
    }

    const period = input.period ?? 'MONTHLY';
    const amount = input.amount != null ? Number(input.amount) : Number(contract.monthlyValue);
    // Primeira cobrança: respeitar mínimo de 3 dias; default = hoje + 4.
    const initial = input.initialDate
      ? new Date(`${input.initialDate}T00:00:00.000Z`)
      : (() => {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() + 4);
          return d;
        })();
    const finalDate = input.finalDate ? new Date(`${input.finalDate}T00:00:00.000Z`) : null;
    // ref único e estável por contrato (max 35).
    const contractRef = `NETX-${(contract.code ?? contract.id).replace(/-/g, '')}`.slice(0, 35);

    const row = await this.prisma.btgRecurrence.create({
      data: {
        tenantId,
        contractId,
        status: PrismaBtgRecurrenceStatus.PENDING,
        contractRef,
        period,
        retryPolicy: RETRY_POLICY,
        amount: amount != null ? new Prisma.Decimal(amount) : null,
        minimumAmount: input.minimumAmount != null ? new Prisma.Decimal(input.minimumAmount) : null,
        initialDate: initial,
        finalDate,
        installments: input.installments ?? null,
      },
    });

    try {
      const personType = doc.length === 11 ? 'F' : 'J';
      const payload = {
        initialDate: initial.toISOString().slice(0, 10),
        account: { number: cfg.accountNumber, branch: cfg.accountBranch },
        retryPolicy: RETRY_POLICY,
        period,
        ...(input.amount != null || contract.monthlyValue != null ? { amount: Number(amount.toFixed(2)) } : {}),
        ...(input.installments != null ? { totalInstallments: input.installments } : {}),
        ...(finalDate ? { finalDate: finalDate.toISOString().slice(0, 10) } : {}),
        ...(input.minimumAmount != null ? { minimumAmountPayee: Number(input.minimumAmount) } : {}),
        link: {
          contract: contractRef,
          description: `Mensalidade ${contract.code ?? ''}`.slice(0, 35),
          debtor: { taxId: doc, name: contract.customer.displayName.slice(0, 140), personType },
        },
      };
      const res = await this.client.createRecurrence(
        cfg,
        this.config.makePersistRefresh(tenantId),
        payload,
      );
      const updated = await this.prisma.btgRecurrence.update({
        where: { id: row.id },
        data: {
          status: mapStatus(res.status),
          authorizationId: res.authorizationId ?? null,
          emv: res.qrCodeInfo?.emv ?? null,
          lastError: null,
          lastPayload: res as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'btg.recurrence.created',
        resource: 'btg_recurrences',
        resourceId: updated.id,
        metadata: { contractId, period, amount },
      });
      return this.toResponse(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.btgRecurrence.update({
        where: { id: row.id },
        data: { status: PrismaBtgRecurrenceStatus.ERROR, lastError: msg.slice(0, 2000) },
      });
      this.logger.warn(`Falha ao criar recorrência BTG contrato=${contractId}: ${msg}`);
      throw new BadRequestException(`Falha ao criar recorrência no BTG: ${msg}`);
    }
  }

  // ===========================================================================
  // CANCELAR
  // ===========================================================================
  async cancel(tenantId: string, actorUserId: string, id: string): Promise<BtgRecurrenceResponse> {
    const row = await this.prisma.btgRecurrence.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Recorrência não encontrada');
    if (row.authorizationId) {
      const cfg = await this.config.resolve(tenantId);
      try {
        await this.client.cancelRecurrence(
          cfg,
          this.config.makePersistRefresh(tenantId),
          row.authorizationId,
        );
      } catch (e) {
        throw new BadRequestException(`Falha ao cancelar no BTG: ${String(e)}`);
      }
    }
    const updated = await this.prisma.btgRecurrence.update({
      where: { id: row.id },
      data: { status: PrismaBtgRecurrenceStatus.CANCELED, canceledAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'btg.recurrence.canceled',
      resource: 'btg_recurrences',
      resourceId: id,
    });
    return this.toResponse(updated);
  }

  // ===========================================================================
  // WEBHOOK (atualização de status da autorização)
  // ===========================================================================
  async handleWebhook(tenantId: string, event: BtgWebhookEvent): Promise<{ ok: boolean }> {
    const data = event.data ?? {};
    const authId =
      typeof data.authorizationId === 'string' ? data.authorizationId : undefined;
    if (!authId) return { ok: true };
    const row = await this.prisma.btgRecurrence.findFirst({
      where: { tenantId, authorizationId: authId },
    });
    if (!row) return { ok: true };
    const newStatus = mapStatus(typeof data.status === 'string' ? data.status : undefined);
    await this.prisma.btgRecurrence.update({
      where: { id: row.id },
      data: {
        status: newStatus,
        ...(newStatus === PrismaBtgRecurrenceStatus.APPROVED && !row.approvedAt
          ? { approvedAt: new Date() }
          : {}),
        ...(newStatus === PrismaBtgRecurrenceStatus.CANCELED && !row.canceledAt
          ? { canceledAt: new Date() }
          : {}),
        lastPayload: event as unknown as Prisma.InputJsonValue,
      },
    });
    this.logger.log(`BTG recorrência ${row.id} → ${newStatus}`);
    return { ok: true };
  }

  // ===========================================================================
  // LEITURA
  // ===========================================================================
  async list(
    tenantId: string,
    q: ListBtgRecurrencesQuery,
  ): Promise<Paginated<BtgRecurrenceResponse>> {
    const where = {
      tenantId,
      ...(q.contractId && { contractId: q.contractId }),
      ...(q.status && { status: q.status as PrismaBtgRecurrenceStatus }),
    };
    const skip = (q.page - 1) * q.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.btgRecurrence.findMany({
        where,
        orderBy: { [q.sortBy]: q.sortDir },
        skip,
        take: q.pageSize,
      }),
      this.prisma.btgRecurrence.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toResponse(r)),
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  async getForContract(
    tenantId: string,
    contractId: string,
  ): Promise<BtgRecurrenceResponse | null> {
    const row = await this.prisma.btgRecurrence.findFirst({
      where: { tenantId, contractId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return row ? this.toResponse(row) : null;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================
  private toResponse(r: BtgRecurrence): BtgRecurrenceResponse {
    return {
      id: r.id,
      tenantId: r.tenantId,
      contractId: r.contractId,
      status: r.status,
      contractRef: r.contractRef,
      authorizationId: r.authorizationId,
      period: r.period as BtgRecurrenceResponse['period'],
      retryPolicy: r.retryPolicy,
      amount: r.amount != null ? Number(r.amount) : null,
      minimumAmount: r.minimumAmount != null ? Number(r.minimumAmount) : null,
      initialDate: r.initialDate.toISOString(),
      finalDate: r.finalDate?.toISOString() ?? null,
      installments: r.installments,
      emv: r.emv,
      qrImage: r.qrImage,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      canceledAt: r.canceledAt?.toISOString() ?? null,
      lastError: r.lastError,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
