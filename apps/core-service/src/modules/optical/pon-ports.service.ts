/**
 * PonPortsService — CRUD de portas PON da OLT (R8.3 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Cria/atualiza com unique compounds — banco rejeita (olt, ponIndex) ou
 * (cable, fiber) duplicados. Service traduz pra mensagem amigável.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_POWER_BUDGET_COEFFICIENTS,
  type CreatePonPortRequest,
  type PonPortResponse,
  type UpdatePonPortRequest,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

type Row = Prisma.PonPortGetPayload<{
  include: {
    olt: { select: { id: true; name: true } };
    cable: { select: { id: true; code: true; fiberCount: true } };
  };
}>;

const INCLUDE = {
  olt: { select: { id: true, name: true } },
  cable: { select: { id: true, code: true, fiberCount: true } },
} satisfies Prisma.PonPortInclude;

function toResponse(p: Row): PonPortResponse {
  const tx = p.txPowerDbm != null ? Number(p.txPowerDbm) : null;
  return {
    id: p.id,
    tenantId: p.tenantId,
    oltId: p.oltId,
    oltName: p.olt.name,
    ponIndex: p.ponIndex,
    cableId: p.cableId,
    cable: p.cable,
    fiberIndex: p.fiberIndex,
    txPowerDbm: tx,
    effectiveTxPowerDbm:
      tx ?? DEFAULT_POWER_BUDGET_COEFFICIENTS.oltTxDbm,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

@Injectable()
export class PonPortsService {
  constructor(private readonly prisma: PrismaService) {}

  async listByOlt(tenantId: string, oltId: string): Promise<PonPortResponse[]> {
    const rows = await this.prisma.ponPort.findMany({
      where: { tenantId, oltId },
      include: INCLUDE,
      orderBy: { ponIndex: 'asc' },
    });
    return rows.map(toResponse);
  }

  async findById(tenantId: string, id: string): Promise<PonPortResponse> {
    const r = await this.prisma.ponPort.findFirst({
      where: { id, tenantId },
      include: INCLUDE,
    });
    if (!r) throw new NotFoundException('Porta PON não encontrada');
    return toResponse(r);
  }

  private async validateCableFiber(
    tenantId: string,
    cableId: string | null | undefined,
    fiberIndex: number | null | undefined,
  ): Promise<void> {
    if (cableId == null && fiberIndex == null) return;
    if (cableId == null || fiberIndex == null) {
      throw new BadRequestException(
        'cableId e fiberIndex devem ser informados juntos (ou ambos null)',
      );
    }
    const cable = await this.prisma.fiberCable.findFirst({
      where: { id: cableId, tenantId, deletedAt: null },
      select: { fiberCount: true },
    });
    if (!cable) throw new BadRequestException('Cabo inválido');
    if (fiberIndex > cable.fiberCount) {
      throw new BadRequestException(
        `Fibra ${fiberIndex} > capacidade do cabo (${cable.fiberCount})`,
      );
    }
  }

  async create(
    tenantId: string,
    input: CreatePonPortRequest,
  ): Promise<PonPortResponse> {
    // Confirma que a OLT pertence ao tenant.
    const olt = await this.prisma.olt.findFirst({
      where: { id: input.oltId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!olt) throw new BadRequestException('OLT inválida');

    await this.validateCableFiber(tenantId, input.cableId, input.fiberIndex);

    try {
      const created = await this.prisma.ponPort.create({
        data: {
          tenantId,
          oltId: input.oltId,
          ponIndex: input.ponIndex,
          cableId: input.cableId ?? null,
          fiberIndex: input.fiberIndex ?? null,
          txPowerDbm: input.txPowerDbm ?? null,
          notes: input.notes ?? null,
        },
        include: INCLUDE,
      });
      return toResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = (err.meta?.target as string[] | undefined)?.join(',') ?? '';
        if (target.includes('cable_id')) {
          throw new ConflictException(
            'Essa fibra já está atribuída a outra porta PON',
          );
        }
        throw new ConflictException('Já existe porta PON nesta posição');
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdatePonPortRequest,
  ): Promise<PonPortResponse> {
    const existing = await this.prisma.ponPort.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Porta PON não encontrada');

    const nextCableId =
      input.cableId === undefined ? existing.cableId : input.cableId;
    const nextFiberIndex =
      input.fiberIndex === undefined ? existing.fiberIndex : input.fiberIndex;
    await this.validateCableFiber(tenantId, nextCableId, nextFiberIndex);

    try {
      const updated = await this.prisma.ponPort.update({
        where: { id },
        data: {
          cableId:
            input.cableId === undefined ? undefined : input.cableId ?? null,
          fiberIndex:
            input.fiberIndex === undefined
              ? undefined
              : input.fiberIndex ?? null,
          txPowerDbm:
            input.txPowerDbm === undefined
              ? undefined
              : input.txPowerDbm ?? null,
          notes: input.notes === undefined ? undefined : input.notes ?? null,
        },
        include: INCLUDE,
      });
      return toResponse(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Essa fibra já está atribuída a outra porta PON',
        );
      }
      throw err;
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const existing = await this.prisma.ponPort.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Porta PON não encontrada');
    await this.prisma.ponPort.delete({ where: { id } });
  }
}
