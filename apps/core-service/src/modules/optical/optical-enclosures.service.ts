/**
 * OpticalEnclosuresService — CRUD de caixas ópticas (CTO/NAP/Splitter/Emenda)
 * + atribuição de portas a contratos. R2 do roadmap OSP.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc de visão: docs/architecture/osp-network.md
 *
 * Regra crítica: ao criar uma enclosure, geramos imediatamente N OpticalPorts
 * (1..capacity) com status=FREE. Isso evita race quando o operador clica
 * "atribuir porta 7" sem nunca ter criado as portas individualmente.
 *
 * Audit: toda mutação de porta gera log (operador X ocupou porta Y com
 * contrato Z em data D). Histórico fica em audit_logs — não criamos tabela
 * dedicada de "port_history" pra não duplicar.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateOpticalEnclosureRequest,
  ListOpticalEnclosuresQuery,
  OpticalEnclosureResponse,
  OpticalPortResponse,
  Paginated,
  UpdateOpticalEnclosureRequest,
  UpdateOpticalPortRequest,
} from '@netx/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

type EnclosureRow = Prisma.OpticalEnclosureGetPayload<{
  include: {
    ports: { select: { status: true } };
  };
}>;

type PortRow = Prisma.OpticalPortGetPayload<{
  include: {
    contract: {
      include: {
        customer: { select: { id: true; displayName: true } };
      };
    };
  };
}>;

function toEnclosureResponse(e: EnclosureRow): OpticalEnclosureResponse {
  // Stats agregados pra cor por ocupação no mapa.
  const portsTotal = e.ports.length;
  const portsFree = e.ports.filter((p) => p.status === 'FREE').length;
  const portsReserved = e.ports.filter((p) => p.status === 'RESERVED').length;
  const portsUsed = e.ports.filter((p) => p.status === 'USED').length;
  const portsDamaged = e.ports.filter((p) => p.status === 'DAMAGED').length;
  const occupancyPct =
    e.capacity > 0
      ? Math.round(((portsUsed + portsReserved) / e.capacity) * 100)
      : 0;

  return {
    id: e.id,
    tenantId: e.tenantId,
    code: e.code,
    type: e.type,
    parentId: e.parentId,
    latitude: Number(e.latitude),
    longitude: Number(e.longitude),
    mountType: e.mountType,
    splitterRatio: e.splitterRatio,
    capacity: e.capacity,
    locationLabel: e.locationLabel,
    notes: e.notes,
    isActive: e.isActive,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    stats: {
      portsTotal,
      portsFree,
      portsReserved,
      portsUsed,
      portsDamaged,
      occupancyPct,
    },
  };
}

function toPortResponse(p: PortRow): OpticalPortResponse {
  return {
    id: p.id,
    tenantId: p.tenantId,
    enclosureId: p.enclosureId,
    number: p.number,
    status: p.status,
    contractId: p.contractId,
    contract: p.contract
      ? {
          id: p.contract.id,
          code: p.contract.code,
          customer: {
            id: p.contract.customer.id,
            displayName: p.contract.customer.displayName,
          },
        }
      : null,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

@Injectable()
export class OpticalEnclosuresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // READ
  // ───────────────────────────────────────────────────────────────────────────
  async list(
    tenantId: string,
    q: ListOpticalEnclosuresQuery,
  ): Promise<Paginated<OpticalEnclosureResponse>> {
    const where: Prisma.OpticalEnclosureWhereInput = {
      tenantId,
      deletedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.parentId ? { parentId: q.parentId } : {}),
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { locationLabel: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.opticalEnclosure.count({ where }),
      this.prisma.opticalEnclosure.findMany({
        where,
        include: { ports: { select: { status: true } } },
        orderBy: { code: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      data: rows.map(toEnclosureResponse),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      },
    };
  }

  async findById(tenantId: string, id: string): Promise<OpticalEnclosureResponse> {
    const e = await this.prisma.opticalEnclosure.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { ports: { select: { status: true } } },
    });
    if (!e) throw new NotFoundException('Caixa óptica não encontrada');
    return toEnclosureResponse(e);
  }

  async listPorts(
    tenantId: string,
    enclosureId: string,
  ): Promise<OpticalPortResponse[]> {
    // Garante que a enclosure existe + pertence ao tenant
    await this.findById(tenantId, enclosureId);
    const ports = await this.prisma.opticalPort.findMany({
      where: { tenantId, enclosureId },
      include: {
        contract: {
          include: { customer: { select: { id: true, displayName: true } } },
        },
      },
      orderBy: { number: 'asc' },
    });
    return ports.map(toPortResponse);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CREATE
  // ───────────────────────────────────────────────────────────────────────────
  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateOpticalEnclosureRequest,
  ): Promise<OpticalEnclosureResponse> {
    // Valida parent (mesmo tenant + não-deletado) se preenchido
    if (input.parentId) {
      const parent = await this.prisma.opticalEnclosure.findFirst({
        where: { id: input.parentId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw new BadRequestException('parentId inválido');
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const enclosure = await tx.opticalEnclosure.create({
          data: {
            tenantId,
            code: input.code.trim(),
            type: input.type,
            parentId: input.parentId ?? null,
            latitude: input.latitude,
            longitude: input.longitude,
            mountType: input.mountType ?? null,
            splitterRatio: input.splitterRatio ?? null,
            capacity: input.capacity,
            locationLabel: input.locationLabel ?? null,
            notes: input.notes ?? null,
            isActive: input.isActive ?? true,
            createdById: actorUserId,
            updatedById: actorUserId,
          },
        });

        // Gera N portas FREE imediatamente — evita race no fluxo "atribuir
        // porta X" quando operador nunca criou portas explicitamente.
        await tx.opticalPort.createMany({
          data: Array.from({ length: input.capacity }, (_, i) => ({
            tenantId,
            enclosureId: enclosure.id,
            number: i + 1,
            status: 'FREE' as const,
          })),
        });

        return enclosure;
      });

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'optical.enclosure.created',
        resource: 'optical_enclosures',
        resourceId: created.id,
        afterState: {
          code: created.code,
          type: created.type,
          capacity: created.capacity,
        },
      });

      return this.findById(tenantId, created.id);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Já existe caixa com esse código');
      }
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // UPDATE
  // ───────────────────────────────────────────────────────────────────────────
  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateOpticalEnclosureRequest,
  ): Promise<OpticalEnclosureResponse> {
    const existing = await this.prisma.opticalEnclosure.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Caixa óptica não encontrada');

    if (input.parentId !== undefined && input.parentId) {
      if (input.parentId === id) {
        throw new BadRequestException('Caixa não pode ser pai de si mesma');
      }
      const parent = await this.prisma.opticalEnclosure.findFirst({
        where: { id: input.parentId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw new BadRequestException('parentId inválido');
    }

    // capacity NÃO pode diminuir abaixo do nº de portas em uso. Verificação
    // explícita pra evitar Prisma cascade silencioso.
    if (input.capacity !== undefined && input.capacity < existing.capacity) {
      const portsAcima = await this.prisma.opticalPort.count({
        where: {
          enclosureId: id,
          number: { gt: input.capacity },
          status: { in: ['USED', 'RESERVED'] },
        },
      });
      if (portsAcima > 0) {
        throw new BadRequestException(
          `Não dá pra reduzir capacity: ${portsAcima} porta(s) ocupada(s) acima do novo limite`,
        );
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.opticalEnclosure.update({
          where: { id },
          data: {
            code: input.code?.trim(),
            type: input.type,
            parentId: input.parentId === undefined ? undefined : input.parentId ?? null,
            latitude: input.latitude,
            longitude: input.longitude,
            mountType:
              input.mountType === undefined ? undefined : input.mountType ?? null,
            splitterRatio:
              input.splitterRatio === undefined
                ? undefined
                : input.splitterRatio ?? null,
            capacity: input.capacity,
            locationLabel:
              input.locationLabel === undefined
                ? undefined
                : input.locationLabel ?? null,
            notes: input.notes === undefined ? undefined : input.notes ?? null,
            isActive: input.isActive,
            updatedById: actorUserId,
          },
        });

        // Sincroniza portas se capacity mudou.
        if (input.capacity !== undefined && input.capacity !== existing.capacity) {
          if (input.capacity > existing.capacity) {
            // Cria as novas portas FREE.
            await tx.opticalPort.createMany({
              data: Array.from(
                { length: input.capacity - existing.capacity },
                (_, i) => ({
                  tenantId,
                  enclosureId: id,
                  number: existing.capacity + i + 1,
                  status: 'FREE' as const,
                }),
              ),
            });
          } else {
            // Deleta portas acima do novo limite (todas FREE, já validamos).
            await tx.opticalPort.deleteMany({
              where: {
                enclosureId: id,
                number: { gt: input.capacity },
              },
            });
          }
        }
      });

      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'optical.enclosure.updated',
        resource: 'optical_enclosures',
        resourceId: id,
      });

      return this.findById(tenantId, id);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Já existe caixa com esse código');
      }
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DELETE (soft)
  // ───────────────────────────────────────────────────────────────────────────
  async remove(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const existing = await this.prisma.opticalEnclosure.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { ports: { where: { status: { in: ['USED', 'RESERVED'] } } } },
    });
    if (!existing) throw new NotFoundException('Caixa óptica não encontrada');

    if (existing.ports.length > 0) {
      throw new BadRequestException(
        `Não dá pra excluir: ${existing.ports.length} porta(s) ainda em uso`,
      );
    }

    await this.prisma.opticalEnclosure.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actorUserId },
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'optical.enclosure.deleted',
      resource: 'optical_enclosures',
      resourceId: id,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PORTS — atribuir / reservar / liberar / marcar dano
  // ───────────────────────────────────────────────────────────────────────────
  async updatePort(
    tenantId: string,
    actorUserId: string,
    portId: string,
    input: UpdateOpticalPortRequest,
  ): Promise<OpticalPortResponse> {
    const port = await this.prisma.opticalPort.findFirst({
      where: { id: portId, tenantId },
    });
    if (!port) throw new NotFoundException('Porta não encontrada');

    // Validar transição. Diagrama no DTO. USED requer contractId; outros
    // estados liberam contractId.
    const next = input.status;
    let contractId: string | null = null;
    if (next === 'USED') {
      if (!input.contractId) {
        throw new BadRequestException('Porta USED exige contractId');
      }
      // Verifica contrato existe + mesmo tenant
      const contract = await this.prisma.contract.findFirst({
        where: { id: input.contractId, tenantId, deletedAt: null },
        select: { id: true, opticalPort: { select: { id: true } } },
      });
      if (!contract) throw new BadRequestException('contractId inválido');
      // Esse contrato já está em outra porta?
      if (contract.opticalPort && contract.opticalPort.id !== portId) {
        throw new ConflictException(
          'Contrato já está atribuído a outra porta óptica',
        );
      }
      contractId = input.contractId;
    }

    const updated = await this.prisma.opticalPort.update({
      where: { id: portId },
      data: {
        status: next,
        contractId,
        notes: input.notes === undefined ? undefined : input.notes ?? null,
      },
      include: {
        contract: {
          include: { customer: { select: { id: true, displayName: true } } },
        },
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'optical.port.updated',
      resource: 'optical_ports',
      resourceId: portId,
      afterState: { status: next, contractId },
    });

    return toPortResponse(updated);
  }
}
