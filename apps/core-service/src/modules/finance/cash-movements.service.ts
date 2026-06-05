import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  CashMovementType as PrismaMovementType,
  CashMovementSource as PrismaMovementSource,
} from '@prisma/client';
import { randomUUID } from 'crypto';

import {
  paginationMeta,
  type CashMovementAttachmentPresignRequest,
  type CashMovementAttachmentPresignResponse,
  type CashMovementAttachmentResponse,
  type CashMovementResponse,
  type CashMovementSource,
  type CashMovementType,
  type CashRegisterBalanceResponse,
  type CreateMovementRequest,
  type CreateTransferRequest,
  type ListMovementsQuery,
  type Paginated,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { CashRegistersService } from './cash-registers.service';

/**
 * CashMovement — extrato dos caixas.
 *
 * Sinais por type pra calcular saldo:
 *   INCOME, TRANSFER_IN, ADJUSTMENT  → +amount
 *   OUTCOME, TRANSFER_OUT             → -amount
 *
 * Transferência sempre cria 2 rows numa transação atomica, com mesmo
 * transferGroupId. Se algo falhar (caixa origem sem saldo, destino inativo)
 * a transação é revertida — nunca fica meia transferência.
 */
@Injectable()
export class CashMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registers: CashRegistersService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------------------
  // RECORD INCOME (interno — chamado por pay() de fatura/cobrança)
  // ---------------------------------------------------------------------------
  async recordIncome(opts: {
    tenantId: string;
    cashRegisterId: string;
    amount: number;
    source: CashMovementSource;
    sourceId: string;
    description?: string;
    actorUserId: string;
    occurredAt?: Date;
  }): Promise<void> {
    if (opts.amount <= 0) return;
    await this.prisma.cashMovement.create({
      data: {
        tenantId: opts.tenantId,
        cashRegisterId: opts.cashRegisterId,
        type: PrismaMovementType.INCOME,
        source: opts.source as PrismaMovementSource,
        sourceId: opts.sourceId,
        amount: new Prisma.Decimal(opts.amount),
        description: opts.description ?? null,
        occurredAt: opts.occurredAt ?? new Date(),
        createdById: opts.actorUserId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // RECORD EXPENSE (interno — saída de caixa por despesa de frota)
  // Aceita um tx opcional pra rodar dentro da transação de quem chamou.
  // Retorna o id do movimento criado.
  // ---------------------------------------------------------------------------
  async recordExpense(opts: {
    tenantId: string;
    cashRegisterId: string;
    amount: number;
    sourceId: string;
    /** Origem do movimento. Default FLEET_EXPENSE (despesa de frota). RH usa PAYROLL. */
    source?: CashMovementSource;
    description?: string | null;
    actorUserId: string;
    occurredAt?: Date;
    tx?: Prisma.TransactionClient;
  }): Promise<string> {
    const client = opts.tx ?? this.prisma;
    const m = await client.cashMovement.create({
      data: {
        tenantId: opts.tenantId,
        cashRegisterId: opts.cashRegisterId,
        type: PrismaMovementType.OUTCOME,
        source: (opts.source ?? 'FLEET_EXPENSE') as PrismaMovementSource,
        sourceId: opts.sourceId,
        amount: new Prisma.Decimal(opts.amount),
        description: opts.description ?? null,
        occurredAt: opts.occurredAt ?? new Date(),
        createdById: opts.actorUserId,
      },
    });
    return m.id;
  }

  // ---------------------------------------------------------------------------
  // REMOVE MOVEMENT (interno — reverte um movimento automático, ex. despesa
  // de frota apagada/editada). Hard-delete: CashMovement é linha de extrato sem
  // soft-delete; removê-la reverte o saldo. Aceita tx opcional.
  // ---------------------------------------------------------------------------
  async removeMovement(
    tenantId: string,
    movementId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.cashMovement.deleteMany({
      where: { id: movementId, tenantId },
    });
  }

  /**
   * Reverte um lançamento MANUAL (sangria/entrada/ajuste) ou uma TRANSFERÊNCIA
   * (remove os 2 lados de uma vez). Bloqueia movimentos que vêm de outra
   * operação (fatura/cobrança/folha/frota): esses devem ser estornados PELA
   * ORIGEM, pra não deixar a origem "paga" sem o dinheiro no caixa.
   */
  async reverseManual(
    tenantId: string,
    actorUserId: string,
    movementId: string,
  ): Promise<void> {
    const mov = await this.prisma.cashMovement.findFirst({
      where: { id: movementId, tenantId },
      select: { id: true, source: true, transferGroupId: true, amount: true },
    });
    if (!mov) throw new NotFoundException('Movimento não encontrado');

    if (mov.source === PrismaMovementSource.MANUAL) {
      await this.prisma.cashMovement.delete({ where: { id: mov.id } });
    } else if (
      mov.source === PrismaMovementSource.TRANSFER &&
      mov.transferGroupId
    ) {
      await this.prisma.cashMovement.deleteMany({
        where: { tenantId, transferGroupId: mov.transferGroupId },
      });
    } else {
      throw new BadRequestException(
        'Esse movimento veio de uma fatura, cobrança, folha ou despesa — ' +
          'estorne pela origem (não dá pra excluir direto no caixa).',
      );
    }

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'cash_movement.reversed',
      resource: 'cash_movements',
      resourceId: movementId,
      beforeState: { source: mov.source, amount: Number(mov.amount) },
    });
  }

  // ---------------------------------------------------------------------------
  // CREATE MANUAL (sangria, ajuste)
  // ---------------------------------------------------------------------------
  async createManual(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    cashRegisterId: string,
    input: CreateMovementRequest,
  ): Promise<CashMovementResponse> {
    await this.registers.assertOperator(
      tenantId,
      cashRegisterId,
      actorUserId,
      isManager,
    );

    // Se veio anexo (NF), confere que o upload realmente chegou no storage
    // antes de persistir — pega o tamanho/mime reais.
    let attachmentData: {
      storageKey: string;
      fileName: string;
      contentType: string | null;
      sizeBytes: number | null;
    } | null = null;
    if (input.attachment) {
      const head = await this.storage.headObject(input.attachment.storageKey);
      if (!head) {
        throw new BadRequestException(
          'Anexo não encontrado no storage. Refaça o upload antes de lançar.',
        );
      }
      attachmentData = {
        storageKey: input.attachment.storageKey,
        fileName: input.attachment.fileName,
        contentType: input.attachment.contentType ?? head.contentType ?? null,
        sizeBytes: input.attachment.sizeBytes ?? head.size ?? null,
      };
    }

    const m = await this.prisma.$transaction(async (tx) => {
      const mov = await tx.cashMovement.create({
        data: {
          tenantId,
          cashRegisterId,
          type: input.type as PrismaMovementType,
          source: PrismaMovementSource.MANUAL,
          amount: new Prisma.Decimal(input.amount),
          description: input.description ?? null,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          createdById: actorUserId,
        },
        include: { attachments: true },
      });
      if (attachmentData) {
        await tx.cashMovementAttachment.create({
          data: {
            tenantId,
            cashMovementId: mov.id,
            storageKey: attachmentData.storageKey,
            fileName: attachmentData.fileName,
            contentType: attachmentData.contentType,
            sizeBytes: attachmentData.sizeBytes,
            createdById: actorUserId,
          },
        });
      }
      return tx.cashMovement.findUniqueOrThrow({
        where: { id: mov.id },
        include: { attachments: true },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'cash_movement.manual',
      resource: 'cash_movements',
      resourceId: m.id,
      afterState: {
        type: input.type,
        amount: input.amount,
        hasAttachment: !!attachmentData,
      },
    });
    return toResponse(m);
  }

  // ---------------------------------------------------------------------------
  // ANEXO — URL presigned pra subir a NF/recibo da sangria antes de lançar.
  // ---------------------------------------------------------------------------
  async presignAttachment(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    cashRegisterId: string,
    input: CashMovementAttachmentPresignRequest,
  ): Promise<CashMovementAttachmentPresignResponse> {
    await this.registers.assertOperator(
      tenantId,
      cashRegisterId,
      actorUserId,
      isManager,
    );
    if (!this.storage.isEnabled()) {
      throw new BadRequestException('Storage (MinIO) não configurado');
    }
    const key = this.storage.buildKey(
      tenantId,
      `cash-registers/${cashRegisterId}/attachments`,
      input.fileName,
    );
    const { url, expiresIn } = await this.storage.presignUpload(
      key,
      input.contentType,
    );
    return { uploadUrl: url, storageKey: key, expiresIn };
  }

  // ---------------------------------------------------------------------------
  // TRANSFER (atomic — 2 movements com mesmo transferGroupId)
  // ---------------------------------------------------------------------------
  async transfer(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    fromCashRegisterId: string,
    input: CreateTransferRequest,
  ): Promise<{ outId: string; inId: string; transferGroupId: string }> {
    if (fromCashRegisterId === input.toCashRegisterId) {
      throw new BadRequestException(
        'Caixa de origem e destino não podem ser o mesmo',
      );
    }
    if (input.amount <= 0) {
      throw new BadRequestException('Valor deve ser positivo');
    }

    // O user precisa operar AMBOS os caixas (origem pra debitar, destino
    // pra creditar). Admin com cash_registers.manage bypassa.
    await this.registers.assertOperator(
      tenantId,
      fromCashRegisterId,
      actorUserId,
      isManager,
    );
    await this.registers.assertOperator(
      tenantId,
      input.toCashRegisterId,
      actorUserId,
      isManager,
    );

    const transferGroupId = randomUUID();
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    const description = input.description ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      const out = await tx.cashMovement.create({
        data: {
          tenantId,
          cashRegisterId: fromCashRegisterId,
          type: PrismaMovementType.TRANSFER_OUT,
          source: PrismaMovementSource.TRANSFER,
          amount: new Prisma.Decimal(input.amount),
          description,
          occurredAt,
          transferGroupId,
          createdById: actorUserId,
        },
      });
      const incoming = await tx.cashMovement.create({
        data: {
          tenantId,
          cashRegisterId: input.toCashRegisterId,
          type: PrismaMovementType.TRANSFER_IN,
          source: PrismaMovementSource.TRANSFER,
          amount: new Prisma.Decimal(input.amount),
          description,
          occurredAt,
          transferGroupId,
          createdById: actorUserId,
        },
      });
      return { outId: out.id, inId: incoming.id };
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'cash_movement.transfer',
      resource: 'cash_movements',
      resourceId: transferGroupId,
      afterState: {
        from: fromCashRegisterId,
        to: input.toCashRegisterId,
        amount: input.amount,
      },
    });
    return { ...result, transferGroupId };
  }

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------
  async list(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    cashRegisterId: string,
    q: ListMovementsQuery,
  ): Promise<Paginated<CashMovementResponse>> {
    // Verifica visibilidade do caixa (membership ou admin).
    const cr = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId, deletedAt: null },
      include: {
        memberships: { where: { userId: actorUserId } },
      },
    });
    if (!cr) throw new NotFoundException('Caixa não encontrado');
    if (!isManager && cr.memberships.length === 0) {
      throw new ForbiddenException('Sem acesso a este caixa');
    }

    const where: Prisma.CashMovementWhereInput = {
      tenantId,
      cashRegisterId,
      ...(q.type ? { type: q.type as PrismaMovementType } : {}),
      ...(q.source ? { source: q.source as PrismaMovementSource } : {}),
      ...(q.from || q.to
        ? {
            occurredAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.cashMovement.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { attachments: true },
      }),
      this.prisma.cashMovement.count({ where }),
    ]);

    // Pra cada TRANSFER, busca o "outro lado" pra mostrar destino/origem na UI.
    const groupIds = rows
      .filter((r) => r.transferGroupId)
      .map((r) => r.transferGroupId!) as string[];
    const peers =
      groupIds.length > 0
        ? await this.prisma.cashMovement.findMany({
            where: {
              transferGroupId: { in: groupIds },
              cashRegisterId: { not: cashRegisterId },
            },
            include: { cashRegister: { select: { id: true, name: true } } },
          })
        : [];

    const peerByGroup = new Map(peers.map((p) => [p.transferGroupId!, p]));

    const data = await Promise.all(
      rows.map(async (r) => {
        const peer = r.transferGroupId
          ? peerByGroup.get(r.transferGroupId)
          : undefined;
        const resp = toResponse(
          r,
          peer
            ? {
                cashRegisterId: peer.cashRegisterId,
                cashRegisterName: (peer as any).cashRegister.name,
              }
            : null,
        );
        resp.attachments = await this.attachmentsWithUrls(
          (r as any).attachments ?? [],
        );
        return resp;
      }),
    );

    return {
      data,
      pagination: paginationMeta(total, q.page, q.pageSize),
    };
  }

  /** Mapeia anexos pra resposta, gerando URL presigned de download em cada. */
  private async attachmentsWithUrls(
    atts: Array<{
      id: string;
      fileName: string;
      contentType: string | null;
      sizeBytes: number | null;
      createdAt: Date;
      storageKey: string;
    }>,
  ): Promise<CashMovementAttachmentResponse[]> {
    return Promise.all(
      atts.map(async (a) => {
        let url: string | undefined;
        if (this.storage.isEnabled()) {
          try {
            const signed = await this.storage.presignDownload(a.storageKey, a.fileName);
            url = signed.url;
          } catch {
            // sem url — UI mostra o anexo sem link clicável
          }
        }
        return {
          id: a.id,
          fileName: a.fileName,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          createdAt: a.createdAt.toISOString(),
          url,
        };
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // BALANCE
  // ---------------------------------------------------------------------------
  async balance(
    tenantId: string,
    actorUserId: string,
    isManager: boolean,
    cashRegisterId: string,
  ): Promise<CashRegisterBalanceResponse> {
    const cr = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId, deletedAt: null },
      include: {
        memberships: { where: { userId: actorUserId } },
      },
    });
    if (!cr) throw new NotFoundException('Caixa não encontrado');
    if (!isManager && cr.memberships.length === 0) {
      throw new ForbiddenException('Sem acesso a este caixa');
    }

    // Agrega por tipo numa única query.
    const grouped = await this.prisma.cashMovement.groupBy({
      by: ['type'],
      where: { tenantId, cashRegisterId },
      _sum: { amount: true },
    });

    const byType = {
      income: 0,
      outcome: 0,
      transferIn: 0,
      transferOut: 0,
      adjustment: 0,
    };
    for (const g of grouped) {
      const v = Number(g._sum.amount ?? 0);
      switch (g.type) {
        case 'INCOME':
          byType.income = v;
          break;
        case 'OUTCOME':
          byType.outcome = v;
          break;
        case 'TRANSFER_IN':
          byType.transferIn = v;
          break;
        case 'TRANSFER_OUT':
          byType.transferOut = v;
          break;
        case 'ADJUSTMENT':
          byType.adjustment = v;
          break;
      }
    }
    const movementsTotal =
      byType.income +
      byType.transferIn +
      byType.adjustment -
      byType.outcome -
      byType.transferOut;
    const opening = Number(cr.openingBalance);

    return {
      cashRegisterId,
      openingBalance: opening,
      movementsTotal,
      currentBalance: opening + movementsTotal,
      byType,
    };
  }
}

// =============================================================================
// MAPPER
// =============================================================================
function toResponse(
  m: any,
  counterpart?: { cashRegisterId: string; cashRegisterName: string } | null,
): CashMovementResponse {
  return {
    id: m.id,
    tenantId: m.tenantId,
    cashRegisterId: m.cashRegisterId,
    type: m.type as CashMovementType,
    source: m.source as CashMovementSource,
    amount: Number(m.amount),
    description: m.description,
    occurredAt: m.occurredAt.toISOString(),
    sourceId: m.sourceId,
    transferGroupId: m.transferGroupId,
    createdById: m.createdById,
    createdAt: m.createdAt.toISOString(),
    counterpart: counterpart ?? null,
    attachments: (m.attachments ?? []).map((a: any) => ({
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
